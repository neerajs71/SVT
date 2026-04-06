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
 * Deposition operator algorithm (mirrors pyenthu/dlis geostore.ts):
 *  1. Sort horizons DEEPEST FIRST (largest average depth value).
 *  2. Build a manifold solid per horizon with buildSolidManifold():
 *       each solid spans from its horizon surface DOWN to the box base.
 *       → deeper horizon = smaller solid, shallower horizon = larger solid.
 *  3. Layer[0] (deepest/basement) = solid[0]  — no subtraction.
 *  4. Layer[i] (i > 0) = solid[i].subtract(solid[i-1])
 *       solid[i] is shallower → LARGER volume
 *       solid[i-1] is deeper  → smaller volume
 *       result = positive-volume band between horizons i-1 and i. ✓
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

// ── Average depth of a horizon (across all rail points) ──────────────────────
function avgRailDepth(h, getRails) {
  const rails = getRails(h);
  let sum = 0, count = 0;
  for (const rail of rails) {
    for (const p of rail.points) { sum += p.y; count++; }
  }
  return count > 0 ? sum / count : 0;
}

// ── Build a closed Manifold solid for one horizon ─────────────────────────────
//
// The solid spans from the horizon's curved surface DOWN to the box base.
// A deeper horizon (large nDepth) produces a SMALLER solid.
// A shallower horizon (small nDepth) produces a LARGER solid.
//
// nDepth(p.y) maps geological depth → world Z ∈ [0, WY]
//
function buildSolidManifold(mf, rails, { WX, WY, strikeW, sampleArcLength, nX, nDepth, domX, nXsamp = 40, refineN = 5 }) {
  const sr = [...rails].sort((a, b) => a.z - b.z);
  if (sr.length < 2) return null;
  const nR  = sr.length;
  const nXn = nXsamp;

  // Surface grid: surfGrid[r][col] = world-Z depth at (rail r, arc-col col)
  // Arc-length (insertion) order preserved; fold-back in X is supported.
  const surfGrid = sr.map(rail => {
    const rawPts = [...rail.points];
    // Snap first/last to domain walls before sampling
    if (domX && rawPts.length > 0) {
      rawPts[0] = { ...rawPts[0], x: domX.min };
      rawPts[rawPts.length - 1] = { ...rawPts[rawPts.length - 1], x: domX.max };
    }
    const pts = sampleArcLength(rawPts, nXn);
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

    return surfGrid[r0][x0]    * (1-rt)*(1-xt)
         + surfGrid[r0][x0+1]  * (1-rt)* xt
         + surfGrid[r0+1][x0]  *  rt   *(1-xt)
         + surfGrid[r0+1][x0+1]*  rt   * xt;
  }

  // Warp a [WX × strikeW × WY] cube so:
  //   top face (Z=0)  → horizon surface depth hz(x,y)
  //   base face (Z=WY) → stays at WY
  // Formula: Z_new = hz + (WY - hz) * Z / WY
  const cube    = mf.Manifold.cube([WX, strikeW, WY], false);
  const refined = cube.refine(refineN);
  const warped  = refined.warp(vert => {
    const hz = horizonDepth(vert[0], vert[1]);
    vert[2]  = hz + (WY - hz) * vert[2] / WY;
  });

  return warped; // Manifold
}

// ── Build a closed Manifold solid directly from NURBS surface positions ───────
//
// Instead of warping a cube by looking up depth at (x,z) — which fails for
// folds because a folded surface has multiple depths at the same (x,z) —
// we construct the closed solid directly:
//
//   Top face:   the NURBS surface mesh (exactly preserves fold geometry)
//   Bottom face: same x,y positions but z = WY (base of domain)
//   Four walls:  connecting the perimeter of the top face to the bottom
//
// This is the same concept used in geostore.ts / mfgoms.ts but without the
// bilinear/kriging lookup that loses fold detail.
//
// Winding (right-hand rule, CCW = outward normal):
//   Top face:    reversed NURBS winding → normal in -Z (upward)
//   Bottom face: NURBS winding          → normal in +Z (downward)
//   Front (v=0): t0,t1,b0 / t1,b1,b0  → normal in -Y
//   Back (v=R):  t0,b0,t1 / t1,b0,b1  → normal in +Y
//   Left (u=0):  t0,b0,t1 / t1,b0,b1  → normal in -X
//   Right (u=R): t0,t1,b0 / t1,b1,b0  → normal in +X
//
function buildNurbsSolidDirect(mf, positions, resolution, WY) {
  const R = resolution + 1;   // vertices per side (grid dimension)
  const N = R * R;             // total surface vertices

  // Vertex buffer: top surface (N vertices) + bottom face (N vertices)
  const verts = new Float32Array(N * 2 * 3);

  // Top vertices (indices 0..N-1): copy NURBS surface positions as-is
  for (let i = 0; i < N * 3; i++) verts[i] = positions[i];

  // Bottom vertices (indices N..2N-1): same x,y but z = WY (domain bottom)
  for (let i = 0; i < N; i++) {
    verts[(N + i) * 3]     = positions[i * 3];     // x
    verts[(N + i) * 3 + 1] = positions[i * 3 + 1]; // y (strike)
    verts[(N + i) * 3 + 2] = WY;                   // z = bottom
  }

  const tris = [];

  // TOP face — reversed NURBS winding → outward normal in -Z (upward/outward)
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = r * R + c, b = a + 1, d = a + R, e = d + 1;
      tris.push(a, e, b);  // reversed from NURBS (a,b,e)
      tris.push(a, d, e);  // reversed from NURBS (a,e,d)
    }
  }

  // BOTTOM face — NURBS winding → outward normal in +Z (downward/outward)
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = N + r * R + c, b = a + 1, d = a + R, e = d + 1;
      tris.push(a, b, e);
      tris.push(a, e, d);
    }
  }

  // FRONT wall (r=0 row) — outward normal ≈ -Y
  for (let c = 0; c < resolution; c++) {
    const t0 = c, t1 = c + 1;
    const b0 = N + c, b1 = N + c + 1;
    tris.push(t0, t1, b0);
    tris.push(t1, b1, b0);
  }

  // BACK wall (r=resolution row) — outward normal ≈ +Y
  for (let c = 0; c < resolution; c++) {
    const t0 = resolution * R + c, t1 = resolution * R + c + 1;
    const b0 = N + resolution * R + c, b1 = N + resolution * R + c + 1;
    tris.push(t0, b0, t1);
    tris.push(t1, b0, b1);
  }

  // LEFT wall (c=0 column) — outward normal ≈ -X
  for (let r = 0; r < resolution; r++) {
    const t0 = r * R, t1 = (r + 1) * R;
    const b0 = N + r * R, b1 = N + (r + 1) * R;
    tris.push(t0, b0, t1);
    tris.push(t1, b0, b1);
  }

  // RIGHT wall (c=resolution column) — outward normal ≈ +X
  for (let r = 0; r < resolution; r++) {
    const t0 = r * R + resolution, t1 = (r + 1) * R + resolution;
    const b0 = N + r * R + resolution, b1 = N + (r + 1) * R + resolution;
    tris.push(t0, t1, b0);
    tris.push(t1, b1, b0);
  }

  const mesh = {
    numProp: 3,
    vertProperties: verts,
    triVerts: new Int32Array(tris),
  };

  return new mf.Manifold(mesh);
}


// ── Average Z depth of a NURBS surface (used for sorting) ────────────────────
function avgNurbsZ(positions) {
  if (!positions || positions.length === 0) return 0;
  let sum = 0, n = 0;
  for (let i = 2; i < positions.length; i += 3) { sum += positions[i]; n++; }
  return n > 0 ? sum / n : 0;
}

// ── Build all NURBS-based layer solids with CSG ───────────────────────────────
//
// `nurbsEntries` — array of { positions: Float32Array, resolution, color, id }
// from the NURBS evaluator cache.  Sorting and CSG mirrors buildLayerSolids:
// deepest first, Layer[0] = basement solid, Layer[i] = solid[i] - solid[i-1].
//
// Returns Promise<Array<{ geo: BufferGeometry, color, id }>>
//
export async function buildNurbsLayerSolids(nurbsEntries, { WX, WY, strikeW }) {
  const mf = await getMF();
  if (!nurbsEntries || nurbsEntries.length === 0) return [];

  // Sort deepest first (largest average surface Z = deepest horizon)
  const sorted = [...nurbsEntries].sort((a, b) =>
    avgNurbsZ(b.positions) - avgNurbsZ(a.positions)
  );

  const manifolds = sorted.map(entry => {
    try {
      return buildNurbsSolidDirect(mf, entry.positions, entry.resolution, WY);
    } catch (e) {
      console.warn('[manifoldSolid] NURBS solid build failed for', entry.id, e);
      return null;
    }
  });

  const blocks = [];
  for (let i = 0; i < sorted.length; i++) {
    if (!manifolds[i]) continue;
    let result = manifolds[i];
    if (i > 0 && manifolds[i - 1]) {
      try {
        result = manifolds[i].subtract(manifolds[i - 1]);
      } catch (e) {
        console.warn('[manifoldSolid] NURBS subtract failed at layer', i, e);
        continue;
      }
    }
    try {
      const mesh = result.getMesh();
      if (!mesh || mesh.triVerts.length === 0) continue;
      blocks.push({ geo: manifoldMeshToGeo(mesh), color: sorted[i].color, id: sorted[i].id });
    } catch (e) {
      console.warn('[manifoldSolid] NURBS getMesh failed at layer', i, e);
    }
  }
  return blocks;
}


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
  domX,
}) {
  const mf = await getMF();
  const opts = { WX, WY, strikeW, sampleArcLength, nX, nDepth, domX };

  const valid = horizons.filter(h => getRails(h).length >= 2);
  if (valid.length === 0) return [];

  // Sort DEEPEST FIRST — deepest horizon has the largest average geological depth.
  // This matches pyenthu/dlis geostore.ts which sorts by maxY descending (their Y is
  // upward, so largest Y = shallowest; we invert: largest depth = deepest).
  const sorted = [...valid].sort((a, b) =>
    avgRailDepth(b, getRails) - avgRailDepth(a, getRails)
  );

  // Build each solid: from horizon surface DOWN to box base
  const manifolds = sorted.map(h => {
    try {
      return buildSolidManifold(mf, getRails(h), opts);
    } catch (e) {
      console.warn('[manifoldSolid] build failed for', h.name, e);
      return null;
    }
  });

  // Deposition operator (mirroring pyenthu/dlis geostore.ts mfGeoMeshes derived):
  //
  //   sorted[0] = deepest  → solid[0] = smallest (horizon near box base)
  //   sorted[n] = shallowest → solid[n] = largest  (horizon near box top)
  //
  //   Layer 0 (basement)  = solid[0]                       deepest formation
  //   Layer i (i > 0)     = solid[i].subtract(solid[i-1])  band between horizons
  //
  // solid[i] is LARGER than solid[i-1] (shallower horizon → more volume below it),
  // so the subtraction always yields a positive-volume band. ✓
  const blocks = [];

  for (let i = 0; i < sorted.length; i++) {
    if (!manifolds[i]) continue;

    let result = manifolds[i];

    if (i > 0 && manifolds[i - 1]) {
      try {
        result = manifolds[i].subtract(manifolds[i - 1]);
      } catch (e) {
        console.warn('[manifoldSolid] subtract failed at layer', i, e);
        continue;
      }
    }

    try {
      const mesh = result.getMesh();
      if (!mesh || mesh.triVerts.length === 0) continue;
      blocks.push({
        geo:   manifoldMeshToGeo(mesh),
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
