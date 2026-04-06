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

// ── Ear-clipping triangulation for simple 2D concave polygons ─────────────────
//
// Used by buildNurbsSolidDirect to correctly triangulate the front and back
// walls of fold-back NURBS solids.  Simple quad strips break for folds because
// the wall panels overlap; ear clipping produces non-overlapping triangles for
// any simple (non-self-intersecting) polygon.
//
// poly: [[x, z], …] — 2D vertex positions in traversal order
// Returns: [[i, j, k], …] — triangle index triples, same winding as input
//
function earClip2D(poly) {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  // Signed area (shoelace); > 0 = CCW in xz, < 0 = CW
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  const ccw = area > 0;

  // 2D signed area of triangle a→b→c (positive = CCW)
  function cross(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }

  // True if point p is inside (or on edge of) triangle (a, b, c)
  function inTriangle(p, a, b, c) {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }

  const rem = Array.from({ length: n }, (_, i) => i);
  const result = [];

  while (rem.length > 3) {
    let cut = false;
    for (let i = 0; i < rem.length; i++) {
      const pi = (i - 1 + rem.length) % rem.length;
      const ni = (i + 1) % rem.length;
      const prev = rem[pi], curr = rem[i], next = rem[ni];
      const c = cross(poly[prev], poly[curr], poly[next]);
      // Convex ear: left turn for CCW, right turn for CW
      if (ccw ? c <= 0 : c >= 0) continue;
      // No other polygon vertex inside this ear
      let inside = false;
      for (let j = 0; j < rem.length; j++) {
        if (j === pi || j === i || j === ni) continue;
        if (inTriangle(poly[rem[j]], poly[prev], poly[curr], poly[next])) { inside = true; break; }
      }
      if (inside) continue;
      result.push([prev, curr, next]);
      rem.splice(i, 1);
      cut = true;
      break;
    }
    // Degenerate fallback: force-cut to avoid infinite loop on near-collinear polygons
    if (!cut) { result.push([rem[0], rem[1], rem[2]]); rem.splice(1, 1); }
  }
  result.push([rem[0], rem[1], rem[2]]);
  return result;
}

// ── Build a closed Manifold solid directly from NURBS surface positions ───────
//
// Constructs the closed solid from the NURBS surface mesh, preserving all
// fold geometry including fold-back in world-x.
//
//   Top face:    NURBS surface mesh (reversed winding → normal -Z upward)
//   Bottom face: same x,y positions but z = WY (normal +Z downward)
//   Left/Right walls: quad strips along V direction (never fold back)
//   Front/Back walls: ear-clipping on the concave 2D polygon in xz-space
//                     (handles fold-back without self-intersecting panels)
//
function buildNurbsSolidDirect(mf, positions, resolution, WY) {
  const R = resolution + 1;   // vertices per side
  const N = R * R;             // total surface vertices

  const verts = new Float32Array(N * 2 * 3);
  for (let i = 0; i < N * 3; i++) verts[i] = positions[i];
  for (let i = 0; i < N; i++) {
    verts[(N + i) * 3]     = positions[i * 3];
    verts[(N + i) * 3 + 1] = positions[i * 3 + 1];
    verts[(N + i) * 3 + 2] = WY;
  }

  const tris = [];

  // TOP face — reversed NURBS winding → normal -Z (upward/outward)
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = r * R + c, b = a + 1, d = a + R, e = d + 1;
      tris.push(a, e, b);
      tris.push(a, d, e);
    }
  }

  // BOTTOM face — NURBS winding → normal +Z (downward/outward)
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = N + r * R + c, b = a + 1, d = a + R, e = d + 1;
      tris.push(a, b, e);
      tris.push(a, e, d);
    }
  }

  // FRONT wall (r=0 row) — concave polygon triangulated with ear clipping
  // Polygon in CCW xz order → -Y outward normal
  // Traversal: t_0→…→t_R (fold profile), then b_R→…→b_0 (bottom reversed)
  {
    const poly = [], idx = [];
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

  // BACK wall (r=resolution row) — concave polygon triangulated with ear clipping
  // Polygon in CW xz order → +Y outward normal
  // Traversal: t_R→…→t_0 (fold profile reversed), then b_0→…→b_R (bottom forward)
  {
    const poly = [], idx = [];
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

  // LEFT wall (c=0 column) — quad strips along V; no fold-back → normal -X
  for (let r = 0; r < resolution; r++) {
    const t0 = r * R, t1 = (r + 1) * R;
    const b0 = N + r * R, b1 = N + (r + 1) * R;
    tris.push(t0, b0, t1);
    tris.push(t1, b0, b1);
  }

  // RIGHT wall (c=resolution column) — quad strips along V; no fold-back → normal +X
  for (let r = 0; r < resolution; r++) {
    const t0 = r * R + resolution, t1 = (r + 1) * R + resolution;
    const b0 = N + r * R + resolution, b1 = N + (r + 1) * R + resolution;
    tris.push(t0, t1, b0);
    tris.push(t1, b1, b0);
  }

  return new mf.Manifold({ numProp: 3, vertProperties: verts, triVerts: new Int32Array(tris) });
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
