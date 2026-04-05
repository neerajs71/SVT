/**
 * manifoldSolid.js
 *
 * Builds manifold geological-block solids from dgeo horizon rails.
 *
 * Coordinate system (matches Dgeo3DScene):
 *   X = horizontal cross-section distance  [0 .. WX]
 *   Y = along-strike                       [0 .. strikeW]
 *   Z = depth (positive downward)          [0 .. WY]
 *
 * Algorithm (mirrors pyenthu/dlis mfgoms.ts + geostore.ts):
 *  1. Use manifold-3d's own `Manifold.cube([WX, strikeW, WY])` — guaranteed manifold.
 *  2. Subdivide with `.refine(n)` for smooth surface approximation.
 *  3. Warp vertices IN-PLACE (void, not return):
 *       Z=0 (surface) → stays 0  (ground surface)
 *       Z=WY (base)   → hz(x,y)  (horizon depth, ∈ [0, WY])
 *     Formula: vert[2] = hz * vert[2] / WY
 *  4. Sort horizons shallowest first (smallest hz → thinnest block).
 *  5. Block[0] = mfMan[0] directly.
 *     Block[i>0] = mfMan[i].subtract(mfMan[i-1])  (deeper minus shallower = layer).
 */

import * as THREE from 'three';

// ── Lazy manifold-3d init (WASM) ─────────────────────────────────────────────
let _mf = null;
async function getMF() {
  if (_mf) return _mf;
  const Module = (await import('manifold-3d')).default;
  _mf = await Module();
  _mf.setup();
  return _mf;
}

// ── Manifold Mesh → Three.js BufferGeometry ───────────────────────────────────
function manifoldMeshToGeo(mesh) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), mesh.numProp)
  );
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  geo.computeVertexNormals();
  return geo;
}

// ── Build a closed Manifold solid for one horizon ─────────────────────────────
//
// Parameters from Dgeo3DScene: WX, WY, strikeW, nX, nDepth, nStrike, sampleArcLength
// nDepth(p.y) maps geological depth → world Z ∈ [0, WY]
//
function buildSolidManifold(mf, rails, { WX, WY, strikeW, sampleArcLength, nX, nDepth, nXsamp = 40, refineN = 5 }) {
  const sr = [...rails].sort((a, b) => a.z - b.z);
  if (sr.length < 2) return null;
  const nR  = sr.length;
  const nXn = nXsamp;

  // Surface grid: surfGrid[r][col] = depth in world Z for (rail r, arc-col col)
  // nDepth() maps geological depth Y → Z ∈ [0, WY]; clamp to avoid self-intersection
  const surfGrid = sr.map(rail => {
    const pts = sampleArcLength(rail.points, nXn);
    return pts.map(p => Math.max(0.01, Math.min(WY * 0.99, nDepth(p.y))));
  });

  // Bilinear horizon depth at cube-space (cx ∈ [0,WX], cy ∈ [0,strikeW])
  function horizonDepth(cx, cy) {
    const xFrac = Math.max(0, Math.min(nXn - 1, (cx / WX) * (nXn - 1)));
    const x0    = Math.min(nXn - 2, Math.floor(xFrac));
    const xt    = xFrac - x0;

    const yFrac = Math.max(0, Math.min(nR - 1, (cy / strikeW) * (nR - 1)));
    const r0    = Math.min(nR - 2, Math.floor(yFrac));
    const rt    = yFrac - r0;

    return surfGrid[r0][x0]   * (1-rt)*(1-xt)
         + surfGrid[r0][x0+1] * (1-rt)* xt
         + surfGrid[r0+1][x0] *  rt   *(1-xt)
         + surfGrid[r0+1][x0+1]*rt    * xt;
  }

  // cube([WX, strikeW, WY]): X=horizontal, Y=strike, Z=depth
  // Warp: Z=0 (surface face) stays; Z=WY (base face) moves to hz
  const cube    = mf.Manifold.cube([WX, strikeW, WY], /* center= */ false);
  const refined = cube.refine(refineN);
  const warped  = refined.warp(vert => {
    // vert[0]=x, vert[1]=strike, vert[2]=depth (cube space)
    const hz = horizonDepth(vert[0], vert[1]);   // ∈ [0, WY]
    // surface (z=0) → 0; base (z=WY) → hz
    vert[2] = hz * vert[2] / WY;
  });

  return warped; // Manifold
}

// ── Build all layer solids ─────────────────────────────────────────────────────
//
// Returns Promise<Array<{ geo: BufferGeometry, color, name, id }>>
//
export async function buildLayerSolids({
  horizons,
  getRails,
  WX,
  WY,
  strikeW,
  sampleArcLength,
  nX,
  nDepth,
  nStrike,
}) {
  const mf = await getMF();

  const opts = { WX, WY, strikeW, sampleArcLength, nX, nDepth };

  // Keep only horizons that have enough rails
  const valid = horizons.filter(h => getRails(h).length >= 2);
  if (valid.length === 0) return [];

  // Sort shallowest first: smallest average nDepth → thinnest block at top
  const sorted = [...valid].sort((a, b) => {
    const avgHz = h => {
      const rails = getRails(h);
      let sum = 0, cnt = 0;
      for (const r of rails) for (const p of r.points) { sum += nDepth(p.y); cnt++; }
      return cnt ? sum / cnt : 0;
    };
    return avgHz(a) - avgHz(b); // ascending (shallowest = smallest hz first)
  });

  // Build Manifold per horizon
  const manifolds = sorted.map(h => {
    try {
      return buildSolidManifold(mf, getRails(h), opts);
    } catch (e) {
      console.warn('[manifoldSolid] build failed for', h.name, e);
      return null;
    }
  });

  // ── Operator clipping (RA / RAI) ─────────────────────────────────────────
  // RA  on H[k]: clip ALL shallower manifolds[j<k] to not extend below H[k]
  //              (handles erosion unconformities that cut up through shallower layers)
  // RAI on H[k]: same but only the immediate shallower neighbour (j = k-1)
  // RB / RBI: no manifold modification needed — the standard subtract already
  //           produces the correct channel body when H[k] dips below H[k-1].
  // Implementation: manifolds[j].intersect(manifolds[k]) clips j's solid to only
  //   the portion that is also inside k's solid (safe no-op for non-crossing horizons).
  for (let k = 1; k < sorted.length; k++) {
    const op = sorted[k].operator ?? 'none';
    if (op === 'RA') {
      for (let j = 0; j < k; j++) {
        if (manifolds[j] && manifolds[k]) {
          try { manifolds[j] = manifolds[j].intersect(manifolds[k]); }
          catch (e) { console.warn('[manifoldSolid] RA intersect failed j=', j, 'k=', k, e); }
        }
      }
    } else if (op === 'RAI') {
      const j = k - 1;
      if (manifolds[j] && manifolds[k]) {
        try { manifolds[j] = manifolds[j].intersect(manifolds[k]); }
        catch (e) { console.warn('[manifoldSolid] RAI intersect failed j=', j, 'k=', k, e); }
      }
    }
  }

  // Boolean subtraction: deeper.subtract(shallower) = inter-horizon layer
  const blocks = [];
  for (let i = 0; i < sorted.length; i++) {
    if (!manifolds[i]) continue;

    let result = manifolds[i];
    if (i > 0 && manifolds[i - 1]) {
      try {
        result = manifolds[i].subtract(manifolds[i - 1]);
      } catch (e) {
        console.warn('[manifoldSolid] subtract failed at layer', i, e);
      }
    }

    try {
      const geo = manifoldMeshToGeo(result.getMesh());
      blocks.push({
        geo,
        color: sorted[i].colour ?? '#8b7355',
        name:  sorted[i].name,
        id:    sorted[i].id,
      });
    } catch (e) {
      console.warn('[manifoldSolid] getMesh failed at layer', i, e);
    }
  }

  return blocks;
}
