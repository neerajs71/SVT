/**
 * GeologicalModel.svelte.ts
 *
 * Owns the full ordered stack of LayerAssembly objects.
 *
 * Horizons are sorted DEEPEST FIRST (largest avgDepth).
 * Layer[0] = basement solid (deepest horizon, no subtraction)
 * Layer[i] = solid[i].subtract(solid[i-1])  for i > 0
 *
 * This mirrors the deposition operator in pyenthu/dlis geostore.ts.
 */

import * as THREE from 'three';
import { LayerAssembly } from './LayerAssembly.svelte.ts';
import { HorizonState }  from './HorizonState.svelte.ts';
import type { WorldDimensions, CoordMappers, NurbsEvalResult } from '../types.ts';

// ── Lazy manifold-3d WASM singleton ──────────────────────────────────────────
let _mf: unknown = null;
async function getMF(): Promise<unknown> {
  if (_mf) return _mf;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Module = (await import('manifold-3d')).default as any;
  _mf = await Module();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_mf as any).setup();
  return _mf;
}

// ── Build options ─────────────────────────────────────────────────────────────
export interface ModelBuildOptions extends WorldDimensions {
  domX: { min: number; max: number };
  sampleArcLength: (pts: { x: number; y: number }[], n: number) => { x: number; y: number }[];
  nX: (x: number) => number;
  nDepth: (y: number) => number;
  nXsamp?: number;
  refineN?: number;
}

// ── GeologicalModel ───────────────────────────────────────────────────────────
export class GeologicalModel {
  layers:       LayerAssembly[] = $state([]);
  gridBuilding: boolean         = $state(false);
  nurbsBuilding:boolean         = $state(false);
  errors:       string[]        = $state([]);

  // ── Grid solid rebuild (cube-warp approach) ───────────────────────────────

  async rebuildGrid(
    horizons: HorizonState[],
    opts: ModelBuildOptions,
    getRails: (h: HorizonState) => { z: number; points: { x: number; y: number }[] }[],
  ): Promise<void> {
    if (this.gridBuilding) return;
    this.gridBuilding = true;
    this.errors = [];

    try {
      const mf = await getMF() as any;

      // Sort deepest first
      const sorted = [...horizons]
        .filter(h => getRails(h).length >= 2)
        .sort((a, b) => b.avgDepth - a.avgDepth);

      if (sorted.length === 0) { this.gridBuilding = false; return; }

      // Ensure layers array has a slot per sorted horizon
      this._syncLayers(sorted);

      // Build individual manifolds for each horizon
      const manifolds: (unknown | null)[] = sorted.map(h => {
        try {
          return buildSolidManifold(mf, getRails(h), opts);
        } catch (e: unknown) {
          const msg = `${h.name}: ${e instanceof Error ? e.message : String(e)}`;
          this.errors = [...this.errors, msg];
          console.warn('[GeologicalModel] grid build failed for', h.name, e);
          return null;
        }
      });

      // CSG per layer — deepest has no subtraction
      for (let i = 0; i < sorted.length; i++) {
        const layer = this.layers[i];
        if (!manifolds[i]) {
          layer.gridError  = 'Manifold build failed';
          layer.gridStatus = 'error';
          continue;
        }
        await layer.buildGrid(manifolds[i], i > 0 ? (manifolds[i - 1] ?? null) : null);
      }
    } finally {
      this.gridBuilding = false;
    }
  }

  // ── NURBS solid rebuild (ear-clip direct approach) ────────────────────────

  async rebuildNurbs(
    horizons: HorizonState[],
    dims: WorldDimensions,
  ): Promise<void> {
    if (this.nurbsBuilding) return;
    this.nurbsBuilding = true;

    try {
      const mf = await getMF() as any;
      const { WX, WY, strikeW } = dims;

      // Horizons with evaluated NURBS positions
      const ready = horizons.filter(h => h.nurbsPositions && h.nurbsResolution > 0);
      const sorted = [...ready].sort((a, b) => b.avgDepth - a.avgDepth);

      if (sorted.length === 0) { this.nurbsBuilding = false; return; }

      this._syncLayers(sorted);

      const manifolds: (unknown | null)[] = sorted.map((h, i) => {
        if (!h.nurbsPositions) return null;
        try {
          const m = buildNurbsSolidDirect(mf, h.nurbsPositions, h.nurbsResolution, WY, WX, strikeW);
          const st = (m as any).status();
          if (st !== 'NoError') {
            console.warn(`[GeologicalModel] nurbs[${i}] ${h.name} status=${st}`);
            return null;
          }
          console.log(`[GeologicalModel] nurbs[${i}] ${h.name} vol=${(m as any).volume().toFixed(2)} status=${st}`);
          return m;
        } catch (e: unknown) {
          const msg = `${h.name}: ${e instanceof Error ? e.message : String(e)}`;
          this.errors = [...this.errors, msg];
          return null;
        }
      });

      for (let i = 0; i < sorted.length; i++) {
        const layer = this.layers[i];
        if (!manifolds[i]) {
          layer.nurbsError  = 'Manifold build failed';
          layer.nurbsStatus = 'error';
          continue;
        }
        await layer.buildNurbs(manifolds[i], i > 0 ? (manifolds[i - 1] ?? null) : null);
      }
    } finally {
      this.nurbsBuilding = false;
    }
  }

  // ── Layer array management ────────────────────────────────────────────────

  private _syncLayers(sorted: HorizonState[]): void {
    // Dispose layers that no longer exist
    const ids = new Set(sorted.map(h => h.id));
    for (const layer of this.layers) {
      if (!ids.has(layer.horizonId)) layer.dispose();
    }

    // Rebuild layers array matching sorted order
    this.layers = sorted.map(h => {
      const existing = this.layers.find(l => l.horizonId === h.id);
      if (existing) return existing;
      return new LayerAssembly(h.id, h.colour, h.name);
    });
  }

  getLayer(horizonId: string): LayerAssembly | undefined {
    return this.layers.find(l => l.horizonId === horizonId);
  }

  dispose(): void {
    for (const layer of this.layers) layer.dispose();
    this.layers = [];
  }
}

// ── buildSolidManifold (grid/cube-warp) — ported from manifoldSolid.js ────────
function buildSolidManifold(
  mf: any,
  rails: { z: number; points: { x: number; y: number }[] }[],
  opts: ModelBuildOptions,
): unknown | null {
  const { WX, WY, strikeW, sampleArcLength, nX, nDepth, domX, nXsamp = 40, refineN = 5 } = opts;

  const sr = [...rails].sort((a, b) => a.z - b.z);
  if (sr.length < 2) return null;
  const nR  = sr.length;
  const nXn = nXsamp;

  const surfGrid: number[][] = sr.map(rail => {
    const rawPts = [...rail.points];
    if (domX && rawPts.length > 0) {
      rawPts[0]                  = { ...rawPts[0],                  x: domX.min };
      rawPts[rawPts.length - 1]  = { ...rawPts[rawPts.length - 1],  x: domX.max };
    }
    const pts = sampleArcLength(rawPts, nXn);
    return pts.map(p => Math.max(0.01, Math.min(WY * 0.99, nDepth(p.y))));
  });

  function horizonDepth(cx: number, cy: number): number {
    const xFrac = Math.max(0, Math.min(nXn - 1, (cx / WX) * (nXn - 1)));
    const x0    = Math.min(nXn - 2, Math.floor(xFrac));
    const xt    = xFrac - x0;
    const yFrac = Math.max(0, Math.min(nR - 1, (cy / strikeW) * (nR - 1)));
    const r0    = Math.min(nR - 2, Math.floor(yFrac));
    const rt    = yFrac - r0;
    return surfGrid[r0][x0]     * (1-rt)*(1-xt)
         + surfGrid[r0][x0+1]   * (1-rt)* xt
         + surfGrid[r0+1][x0]   *  rt   *(1-xt)
         + surfGrid[r0+1][x0+1] *  rt   * xt;
  }

  const cube    = mf.Manifold.cube([WX, strikeW, WY], false);
  const refined = cube.refine(refineN);
  return refined.warp((vert: number[]) => {
    const hz = horizonDepth(vert[0], vert[1]);
    vert[2]  = hz + (WY - hz) * vert[2] / WY;
  });
}

// ── buildNurbsSolidDirect (ear-clip) — ported from manifoldSolid.js ───────────
//
// BOUNDARY-SNAP FIX applied here:
//   After copying NURBS Float32 positions into verts, we snap:
//     left edge (c=0)           x → 0
//     right edge (c=resolution) x → WX
//     front row (r=0)           y → 0
//     back row  (r=resolution)  y → strikeW
//   This closes microscopic floating-point gaps between walls that would
//   otherwise make the mesh non-manifold.
//
function buildNurbsSolidDirect(
  mf: any,
  positions: Float32Array,
  resolution: number,
  WY: number,
  WX: number,
  strikeW: number,
): unknown {
  const R = resolution + 1;
  const N = R * R;

  if (!positions || positions.length < N * 3) {
    throw new Error(`positions too short: got ${positions?.length}, need ${N * 3}`);
  }

  const verts = new Float32Array(N * 2 * 3);

  // Top vertices: copy x,y; clamp z to (0.01, WY*0.99)
  for (let i = 0; i < N; i++) {
    verts[i * 3]     = positions[i * 3];
    verts[i * 3 + 1] = positions[i * 3 + 1];
    verts[i * 3 + 2] = Math.max(0.01, Math.min(WY * 0.99, positions[i * 3 + 2]));
  }
  // Bottom vertices: same x,y; z = WY
  for (let i = 0; i < N; i++) {
    verts[(N + i) * 3]     = positions[i * 3];
    verts[(N + i) * 3 + 1] = positions[i * 3 + 1];
    verts[(N + i) * 3 + 2] = WY;
  }

  // ── Boundary-snap fix ────────────────────────────────────────────────────
  // Close any Float32 gaps from NURBS evaluation at u=0/1 and v=0/1
  for (let r = 0; r < R; r++) {
    // Left edge (c=0): x → 0
    verts[r * R * 3]         = 0;
    verts[(N + r * R) * 3]   = 0;
    // Right edge (c=resolution): x → WX
    verts[(r * R + resolution) * 3]         = WX;
    verts[(N + r * R + resolution) * 3]     = WX;
  }
  for (let c = 0; c < R; c++) {
    // Front row (r=0): y → 0
    verts[c * 3 + 1]         = 0;
    verts[(N + c) * 3 + 1]   = 0;
    // Back row (r=resolution): y → strikeW
    verts[(resolution * R + c) * 3 + 1]         = strikeW;
    verts[(N + resolution * R + c) * 3 + 1]     = strikeW;
  }

  const tris: number[] = [];

  // TOP face — reversed winding → normal upward
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = r * R + c, b = a + 1, d = a + R, e = d + 1;
      tris.push(a, e, b);
      tris.push(a, d, e);
    }
  }

  // BOTTOM face — normal downward
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = N + r * R + c, b = a + 1, d = a + R, e = d + 1;
      tris.push(a, b, e);
      tris.push(a, e, d);
    }
  }

  // FRONT wall (r=0) — ear-clip concave polygon
  {
    const poly: [number, number][] = [];
    const idx: number[] = [];
    for (let c = 0; c <= resolution; c++) {
      idx.push(c);
      poly.push([positions[c * 3], positions[c * 3 + 2]]);
    }
    for (let c = resolution; c >= 0; c--) {
      idx.push(N + c);
      poly.push([positions[c * 3], WY]);
    }
    for (const [a, b, c] of earClip2D(poly)) tris.push(idx[a], idx[b], idx[c]);
  }

  // BACK wall (r=resolution) — ear-clip concave polygon
  {
    const poly: [number, number][] = [];
    const idx: number[] = [];
    const row = resolution * R;
    for (let c = resolution; c >= 0; c--) {
      idx.push(row + c);
      poly.push([positions[(row + c) * 3], positions[(row + c) * 3 + 2]]);
    }
    for (let c = 0; c <= resolution; c++) {
      idx.push(N + row + c);
      poly.push([positions[(row + c) * 3], WY]);
    }
    for (const [a, b, c] of earClip2D(poly)) tris.push(idx[a], idx[b], idx[c]);
  }

  // LEFT wall (c=0) — quad strips
  for (let r = 0; r < resolution; r++) {
    const t0 = r * R, t1 = (r + 1) * R;
    const b0 = N + r * R, b1 = N + (r + 1) * R;
    tris.push(t0, b0, t1);
    tris.push(t1, b0, b1);
  }

  // RIGHT wall (c=resolution) — quad strips
  for (let r = 0; r < resolution; r++) {
    const t0 = r * R + resolution, t1 = (r + 1) * R + resolution;
    const b0 = N + r * R + resolution, b1 = N + (r + 1) * R + resolution;
    tris.push(t0, t1, b0);
    tris.push(t1, b1, b0);
  }

  return new mf.Manifold({ numProp: 3, vertProperties: verts, triVerts: new Int32Array(tris) });
}

// ── earClip2D — 2D concave polygon triangulation ──────────────────────────────
function earClip2D(poly: [number, number][]): [number, number, number][] {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  const ccw = area > 0;

  function cross(a: [number,number], b: [number,number], c: [number,number]): number {
    return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  }
  function inTriangle(p: [number,number], a: [number,number], b: [number,number], c: [number,number]): boolean {
    const d1=cross(a,b,p), d2=cross(b,c,p), d3=cross(c,a,p);
    return !((d1<0||d2<0||d3<0) && (d1>0||d2>0||d3>0));
  }

  const rem = Array.from({ length: n }, (_, i) => i);
  const result: [number,number,number][] = [];

  while (rem.length > 3) {
    let cut = false;
    for (let i = 0; i < rem.length; i++) {
      const pi=(i-1+rem.length)%rem.length, ni=(i+1)%rem.length;
      const prev=rem[pi], curr=rem[i], next=rem[ni];
      const c=cross(poly[prev], poly[curr], poly[next]);
      if (ccw ? c<=0 : c>=0) continue;
      let inside=false;
      for (let j=0; j<rem.length; j++) {
        if (j===pi||j===i||j===ni) continue;
        if (inTriangle(poly[rem[j]], poly[prev], poly[curr], poly[next])) { inside=true; break; }
      }
      if (inside) continue;
      result.push([prev,curr,next]); rem.splice(i,1); cut=true; break;
    }
    if (!cut) { result.push([rem[0],rem[1],rem[2]]); rem.splice(1,1); }
  }
  result.push([rem[0],rem[1],rem[2]]);
  return result;
}
