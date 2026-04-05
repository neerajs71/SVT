/**
 * manifoldSolid.js
 *
 * Builds manifold geological-block solids from dgeo horizon rails.
 *
 * Algorithm (mirrors pyenthu/dlis src/geo/geocube/mfgoms.ts):
 *  1. For each horizon, deform a subdivided BoxGeometry so its top face
 *     matches the horizon surface (arc-length bilinear interpolation).
 *     Bottom stays flat at y = –WY (cube floor).
 *  2. Merge duplicate vertices → hand to manifold-3d as a Manifold.
 *  3. Sort horizons shallowest-first; subtract consecutive manifolds to
 *     carve out inter-horizon layer blocks.
 *
 * Usage:
 *   import { buildLayerSolids } from './manifoldSolid.js';
 *   const blocks = await buildLayerSolids({ horizons, getRails,
 *                    WX, WY, strikeW, sampleArcLength, nx, ny, nz_km });
 *   // blocks: [{ geo: BufferGeometry, color, name, id }]
 */

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── Lazy manifold-3d init (WASM) ─────────────────────────────────────────────
let _mf = null;
async function getMF() {
  if (_mf) return _mf;
  const Module = (await import('manifold-3d')).default;
  _mf = await Module();
  _mf.setup();
  return _mf;
}

// ── Three.js BufferGeometry ↔ manifold Mesh ───────────────────────────────────
function geoToManifold(mf, geo) {
  // geo must be non-indexed-duplicate — use mergeVertices first
  const pos = geo.attributes.position.array;
  const idx = geo.index ? geo.index.array : null;
  if (!idx) throw new Error('Geometry must be indexed');

  const mesh = new mf.Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(pos),
    triVerts: Uint32Array.from(idx),
  });
  return new mf.Manifold(mesh);
}

function manifoldToGeo(mf, manifold) {
  const mesh = manifold.getMesh();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), mesh.numProp)
  );
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geo.computeVertexNormals();
  return geo;
}

// ── Build a closed solid for one horizon ──────────────────────────────────────
//
// Creates a BoxGeometry spanning [0..WX, -WY..0, 0..strikeW] then deforms
// each vertex so that when wy == 0 (top face) it moves to the horizon surface
// height surfY(wx, wz), while wy == -WY (bottom face) stays fixed.
//
// Deformation formula (adapted from pyenthu mfgoms.ts):
//   newY = -WY + (wy + WY) * (surfY + WY) / WY
//
//  • wy = 0   → newY = surfY  (top maps to surface)
//  • wy = -WY → newY = -WY   (bottom stays flat)
//
export function buildClosedSolid(
  rails,
  { WX, WY, strikeW, sampleArcLength, nx, ny, nz_km, nX = 40 }
) {
  const sr = [...rails].sort((a, b) => a.z - b.z);
  if (sr.length < 2) return null;
  const nR = sr.length;

  // Sample the surface on a (nR × nX) arc-length grid in world space
  const surfGrid = sr.map(rail => {
    const pts = sampleArcLength(rail.points, nX);
    return pts.map(p => ({ wx: nx(p.x), wy: ny(p.y) }));
  });

  // Subdivided box centred at origin; translate into cube space
  const nBX = 50, nBY = 8, nBZ = 20;
  const geo = new THREE.BoxGeometry(WX, WY, strikeW, nBX, nBY, nBZ);
  geo.translate(WX / 2, -WY / 2, strikeW / 2);

  // Deform vertex Y according to bilinear interpolation of the surface grid
  const pos = geo.attributes.position.array;
  for (let i = 0; i < pos.length; i += 3) {
    const wx = pos[i];
    const wy = pos[i + 1]; // ∈ [-WY, 0]
    const wz = pos[i + 2]; // ∈ [0, strikeW]

    // Rail (Z) fraction → bilinear r0, rt
    const zFrac = Math.max(0, Math.min(nR - 1, (wz / strikeW) * (nR - 1)));
    const r0 = Math.min(nR - 2, Math.floor(zFrac));
    const rt = zFrac - r0;

    // Column (X arc-length approximation) fraction → x0, xt
    const xFrac = Math.max(0, Math.min(nX - 1, (wx / WX) * (nX - 1)));
    const x0 = Math.min(nX - 2, Math.floor(xFrac));
    const xt = xFrac - x0;

    // Bilinear surface Y
    const y00 = surfGrid[r0][x0].wy;
    const y10 = surfGrid[r0][x0 + 1].wy;
    const y01 = surfGrid[r0 + 1][x0].wy;
    const y11 = surfGrid[r0 + 1][x0 + 1].wy;
    const surfY = y00 * (1 - rt) * (1 - xt)
                + y10 * (1 - rt) * xt
                + y01 * rt * (1 - xt)
                + y11 * rt * xt;

    // Deform: top (wy=0) → surfY, bottom (wy=-WY) → -WY
    pos[i + 1] = -WY + (wy + WY) * (surfY + WY) / WY;
  }

  geo.attributes.position.needsUpdate = true;

  // Merge identical vertices so edges are shared (required for manifold)
  const merged = mergeVertices(geo, 1e-4);
  merged.computeVertexNormals();
  return merged;
}

// ── Build all layer solids from a set of horizons ─────────────────────────────
//
// Returns Promise<Array<{ geo, color, name, id }>>
//
export async function buildLayerSolids({
  horizons,
  getRails,
  WX,
  WY,
  strikeW,
  sampleArcLength,
  nx,
  ny,
  nz_km,
}) {
  const mf = await getMF();

  const opts = { WX, WY, strikeW, sampleArcLength, nx, ny, nz_km };

  // Keep only horizons with enough rails
  const valid = horizons.filter(h => getRails(h).length >= 2);
  if (valid.length === 0) return [];

  // Sort shallowest first (least negative ny average → highest wy)
  const sorted = [...valid].sort((a, b) => {
    const avgWY = h => {
      const rails = getRails(h);
      let sum = 0, cnt = 0;
      for (const r of rails) {
        for (const p of r.points) { sum += ny(p.y); cnt++; }
      }
      return cnt ? sum / cnt : 0;
    };
    return avgWY(b) - avgWY(a); // descending (least negative = shallowest first)
  });

  // Build Manifold for each horizon solid
  const manifolds = sorted.map(h => {
    const rails = getRails(h);
    const geo = buildClosedSolid(rails, opts);
    if (!geo) return null;
    try {
      return geoToManifold(mf, geo);
    } catch (e) {
      console.warn('[manifoldSolid] Manifold create failed for', h.name, e);
      return null;
    }
  });

  // Boolean subtraction to produce per-layer blocks
  const blocks = [];
  for (let i = 0; i < sorted.length; i++) {
    if (!manifolds[i]) continue;

    let result = manifolds[i];
    if (i > 0 && manifolds[i - 1]) {
      try {
        result = manifolds[i].subtract(manifolds[i - 1]);
      } catch (e) {
        console.warn('[manifoldSolid] subtract failed at layer', i, e);
        // Fall back to un-subtracted solid
      }
    }

    try {
      const geo = manifoldToGeo(mf, result);
      blocks.push({
        geo,
        color: sorted[i].colour ?? '#8b7355',
        name: sorted[i].name,
        id: sorted[i].id,
      });
    } catch (e) {
      console.warn('[manifoldSolid] meshToGeo failed at layer', i, e);
    }
  }

  return blocks;
}
