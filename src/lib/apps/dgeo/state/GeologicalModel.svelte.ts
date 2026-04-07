/**
 * GeologicalModel.svelte.ts
 *
 * Owns the full ordered stack of LayerAssembly objects.
 *
 * Depositional algorithm — user-defined order, no sort, no reverse:
 *   Array[0] = first deposited = oldest = deepest (basement)
 *   Array[1] = deposited on top of [0], etc.
 *
 * For each horizon i in order:
 *   1. Build its base block (solid from NURBS surface down to WY floor)
 *   2. Subtract ALL previously accumulated display layers from the base block
 *   3. The result is the display layer for horizon i
 *   4. Append display layer to the accumulator for future subtractions
 *   5. Decompose the result to handle multi-body outputs (pinch-outs etc.)
 *
 * A geometric discrepancy warning is emitted if the user places a horizon
 * later in the list (younger) but it is geometrically deeper than an earlier
 * one — but we do NOT reorder, that is the user's problem.
 */

import * as THREE from 'three';
import { LayerAssembly } from './LayerAssembly.svelte.ts';
import { HorizonState }  from './HorizonState.svelte.ts';
import type { WorldDimensions } from '../types.ts';

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

// ── Shared mesh → Three.js converter ─────────────────────────────────────────
function manifoldMeshToGeo(mesh: { vertProperties: ArrayLike<number>; numProp: number; triVerts: ArrayLike<number> }): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), mesh.numProp));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geo.computeVertexNormals();
  return geo;
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

      // Use user-defined array order — NO sort, NO reverse
      const ordered = horizons.filter(h => getRails(h).length >= 2);
      if (ordered.length === 0) { this.gridBuilding = false; return; }

      this._warnOrderDiscrepancy(ordered);
      this._syncLayers(ordered);

      // Depositional accumulator: display manifolds built so far
      const displayManifolds: unknown[] = [];

      for (let i = 0; i < ordered.length; i++) {
        const h = ordered[i];

        // Build base block for this horizon
        let mBase: any;
        try {
          mBase = buildSolidManifold(mf, getRails(h), opts);
          if (!mBase) {
            console.warn(`[GeologicalModel] grid base null for ${h.name}`);
            continue;
          }
          if (mBase.status() !== 'NoError') {
            const msg = `${h.name}: base block status=${mBase.status()}`;
            this.errors = [...this.errors, msg];
            continue;
          }
        } catch (e: unknown) {
          const msg = `${h.name}: ${e instanceof Error ? e.message : String(e)}`;
          this.errors = [...this.errors, msg];
          console.warn('[GeologicalModel] grid base failed for', h.name, e);
          continue;
        }

        // Subtract all previously displayed layers
        let mDisplay: any = mBase;
        let failed = false;
        for (const prev of displayManifolds) {
          mDisplay = mDisplay.subtract(prev as any);
          if (mDisplay.status() !== 'NoError') {
            const msg = `${h.name}: subtraction status=${mDisplay.status()}`;
            console.warn('[GeologicalModel]', msg);
            this.errors = [...this.errors, msg];
            failed = true;
            break;
          }
        }
        if (failed) continue;

        console.log(`[GeologicalModel] grid[${i}] ${h.name} vol=${mDisplay.volume().toFixed(2)}`);
        displayManifolds.push(mDisplay);
        this.layers[i].setGridGeos(this._decompose(mDisplay));
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
    this.errors = [];

    try {
      const mf = await getMF() as any;
      const { WX, WY, strikeW } = dims;

      // Use user-defined array order — NO sort, NO reverse
      const ordered = horizons.filter(h => h.nurbsPositions && h.nurbsResolution > 0);
      if (ordered.length === 0) { this.nurbsBuilding = false; return; }

      this._warnOrderDiscrepancy(ordered);
      this._syncLayers(ordered);

      // Depositional accumulator: display manifolds built so far
      const displayManifolds: unknown[] = [];

      for (let i = 0; i < ordered.length; i++) {
        const h = ordered[i];
        if (!h.nurbsPositions) continue;

        // Build base block for this horizon
        let mBase: any;
        try {
          mBase = buildNurbsSolidDirect(mf, h.nurbsPositions, h.nurbsResolution, WY, WX, strikeW);
          if (mBase.status() !== 'NoError') {
            const msg = `${h.name}: base block status=${mBase.status()}`;
            console.warn('[GeologicalModel]', msg);
            this.errors = [...this.errors, msg];
            continue;
          }
          console.log(`[GeologicalModel] nurbs[${i}] ${h.name} base vol=${mBase.volume().toFixed(2)}`);
        } catch (e: unknown) {
          const msg = `${h.name}: ${e instanceof Error ? e.message : String(e)}`;
          this.errors = [...this.errors, msg];
          continue;
        }

        // Subtract all previously displayed layers
        let mDisplay: any = mBase;
        let failed = false;
        for (const prev of displayManifolds) {
          mDisplay = mDisplay.subtract(prev as any);
          if (mDisplay.status() !== 'NoError') {
            const msg = `${h.name}: subtraction status=${mDisplay.status()}`;
            console.warn('[GeologicalModel]', msg);
            this.errors = [...this.errors, msg];
            failed = true;
            break;
          }
        }
        if (failed) continue;

        console.log(`[GeologicalModel] nurbs[${i}] ${h.name} display vol=${mDisplay.volume().toFixed(2)}`);
        displayManifolds.push(mDisplay);
        this.layers[i].setNurbsGeos(this._decompose(mDisplay));
      }
    } finally {
      this.nurbsBuilding = false;
    }
  }

  // ── Decompose result into BufferGeometry[] ────────────────────────────────
  // Handles the rare case where subtraction produces multiple disconnected bodies.

  private _decompose(m: any): THREE.BufferGeometry[] {
    try {
      const parts: any[] = m.decompose();
      const geos: THREE.BufferGeometry[] = [];
      for (const p of parts) {
        if (p.status() !== 'NoError') continue;
        const mesh = p.getMesh();
        if (!mesh || mesh.triVerts.length === 0) continue;
        geos.push(manifoldMeshToGeo(mesh));
      }
      return geos;
    } catch {
      // decompose not available or failed — fall back to direct getMesh
      try {
        const mesh = m.getMesh();
        if (mesh && mesh.triVerts.length > 0) return [manifoldMeshToGeo(mesh)];
      } catch { /* ignore */ }
      return [];
    }
  }

  // ── Order validation ──────────────────────────────────────────────────────
  // ordered[0] = first deposited = deepest; each subsequent should be shallower.
  // Warn if ordered[i].avgDepth < ordered[i-1].avgDepth (i is geometrically
  // deeper than i-1, but comes later in the list → likely wrong ordering).

  private _warnOrderDiscrepancy(ordered: HorizonState[]): void {
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const curr = ordered[i];
      if (curr.avgDepth < prev.avgDepth) {
        const msg = `⚠ Order discrepancy: "${curr.name}" (index ${i}) is geometrically deeper than "${prev.name}" (index ${i-1}) but comes later in the depositional list. Check horizon order.`;
        console.warn('[GeologicalModel]', msg);
        this.errors = [...this.errors, msg];
      }
    }
  }

  // ── Layer array management ────────────────────────────────────────────────

  private _syncLayers(ordered: HorizonState[]): void {
    // Dispose layers that no longer exist
    const ids = new Set(ordered.map(h => h.id));
    for (const layer of this.layers) {
      if (!ids.has(layer.horizonId)) layer.dispose();
    }

    // Rebuild layers array matching ordered list
    this.layers = ordered.map(h => {
      const existing = this.layers.find(l => l.horizonId === h.id);
      if (existing) return existing;
      return new LayerAssembly(h.id, h.colour, h.name);
    });
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
