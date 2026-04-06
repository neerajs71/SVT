/**
 * manifold-solid-test.mjs
 *
 * Tests two approaches for building a manifold solid from a fold-back NURBS surface:
 *   A) buildNurbsSolidDirect — current impl: direct mesh from positions (BROKEN for folds)
 *   B) buildNurbsSolidParamWarp — new impl: cube warp via (u,v) parameter lookup (CORRECT)
 *
 * Run:  node test/manifold-solid-test.mjs
 */

import Module from 'manifold-3d';

const WX = 10, WY = 8, strikeW = 6;
const resolution = 20;   // 21×21 grid
const R = resolution + 1;
const N = R * R;

// ── Generate a fold-back surface matching the "fold_fwd" preset ──────────────
// Row = V (strike), Col = U (arc-length profile)
// Matches the raw points used in DgeoApp.svelte fold_fwd preset:
//   [0,0],[0.15,-0.30],[0.35,-0.80],[0.55,-1.00],[0.72,-0.85],[0.78,-0.55],
//   [0.68,-0.25],[0.58,0],[0.70,0.10],[0.85,0.05],[1.00,0.00]
// x folds back: 0.78 → 0.68 → 0.58 (strong fold)
const FOLD_FWD_RAW = [
  [0.00, 0.00], [0.15, -0.30], [0.35, -0.80], [0.55, -1.00],
  [0.72, -0.85], [0.78, -0.55],
  [0.68, -0.25],   // ← x decreases: fold-back
  [0.58,  0.00], [0.70,  0.10], [0.85,  0.05], [1.00,  0.00],
];

function makeFoldPositions(strongFold = true) {
  const pos = new Float32Array(N * 3);

  // Interpolate the raw fold profile at resolution+1 U samples
  function foldX(u) {
    const pts = FOLD_FWD_RAW;
    const t = u * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(t));
    const ft = t - i;
    return (pts[i][0] * (1 - ft) + pts[i + 1][0] * ft) * WX;
  }
  function foldZ(u) {
    const pts = FOLD_FWD_RAW;
    const t = u * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(t));
    const ft = t - i;
    // depth offset (negative = shallower) mapped to z ∈ [1, 6]
    const d = pts[i][1] * (1 - ft) + pts[i + 1][1] * ft;
    return 3.5 + d * 2;   // range: 3.5 ± 2
  }

  for (let row = 0; row < R; row++) {
    const v = row / resolution;
    const yWorld = v * strikeW;
    for (let col = 0; col < R; col++) {
      const u = col / resolution;
      const i = row * R + col;
      pos[i * 3]     = foldX(u);
      pos[i * 3 + 1] = yWorld;
      pos[i * 3 + 2] = Math.max(0.1, Math.min(WY - 0.1, foldZ(u)));
    }
  }
  return pos;
}

// ── A) Current direct-mesh approach (BROKEN for folds) ────────────────────────
function buildNurbsSolidDirect(mf, positions) {
  const verts = new Float32Array(N * 2 * 3);
  for (let i = 0; i < N * 3; i++) verts[i] = positions[i];
  for (let i = 0; i < N; i++) {
    verts[(N + i) * 3]     = positions[i * 3];
    verts[(N + i) * 3 + 1] = positions[i * 3 + 1];
    verts[(N + i) * 3 + 2] = WY;
  }

  const tris = [];
  // TOP face
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = r * R + c, b = a + 1, d = a + R, e = d + 1;
      tris.push(a, e, b);
      tris.push(a, d, e);
    }
  }
  // BOTTOM face
  for (let r = 0; r < resolution; r++) {
    for (let c = 0; c < resolution; c++) {
      const a = N + r * R + c, b = a + 1, d = a + R, e = d + 1;
      tris.push(a, b, e);
      tris.push(a, e, d);
    }
  }
  // FRONT wall (r=0)
  for (let c = 0; c < resolution; c++) {
    const t0 = c, t1 = c + 1, b0 = N + c, b1 = N + c + 1;
    tris.push(t0, t1, b0);
    tris.push(t1, b1, b0);
  }
  // BACK wall (r=resolution)
  for (let c = 0; c < resolution; c++) {
    const t0 = resolution * R + c, t1 = resolution * R + c + 1;
    const b0 = N + resolution * R + c, b1 = N + resolution * R + c + 1;
    tris.push(t0, b0, t1);
    tris.push(t1, b0, b1);
  }
  // LEFT wall (c=0)
  for (let r = 0; r < resolution; r++) {
    const t0 = r * R, t1 = (r + 1) * R, b0 = N + r * R, b1 = N + (r + 1) * R;
    tris.push(t0, b0, t1);
    tris.push(t1, b0, b1);
  }
  // RIGHT wall (c=resolution)
  for (let r = 0; r < resolution; r++) {
    const t0 = r * R + resolution, t1 = (r + 1) * R + resolution;
    const b0 = N + r * R + resolution, b1 = N + (r + 1) * R + resolution;
    tris.push(t0, t1, b0);
    tris.push(t1, b1, b0);
  }

  const mesh = { numProp: 3, vertProperties: verts, triVerts: new Int32Array(tris) };
  return new mf.Manifold(mesh);
}

// ── B) New parameter-space cube warp approach (CORRECT) ──────────────────────
function buildNurbsSolidParamWarp(mf, positions, refineN = 8) {
  const grid = new Float32Array(R * R);
  for (let row = 0; row < R; row++) {
    for (let col = 0; col < R; col++) {
      grid[row * R + col] = positions[(row * R + col) * 3 + 2];
    }
  }

  function paramZ(uFrac, vFrac) {
    const cf = Math.max(0, Math.min(R - 1, uFrac * (R - 1)));
    const c0 = Math.min(R - 2, Math.floor(cf)), ct = cf - c0;
    const rf = Math.max(0, Math.min(R - 1, vFrac * (R - 1)));
    const r0 = Math.min(R - 2, Math.floor(rf)), rt = rf - r0;
    return grid[r0 * R + c0]       * (1 - rt) * (1 - ct)
         + grid[r0 * R + c0 + 1]   * (1 - rt) * ct
         + grid[(r0 + 1) * R + c0] * rt        * (1 - ct)
         + grid[(r0 + 1) * R + c0 + 1] * rt    * ct;
  }

  const cube = mf.Manifold.cube([WX, strikeW, WY], false);
  return cube.refine(refineN).warp(vert => {
    const hz = Math.max(0.01, Math.min(WY * 0.99, paramZ(vert[0] / WX, vert[1] / strikeW)));
    vert[2] = hz + (WY - hz) * vert[2] / WY;
  });
}

// ── Test runner ───────────────────────────────────────────────────────────────
function checkManifold(_mf, solid, label) {
  try {
    const status = solid.status();
    if (status !== 'NoError') {
      console.log(`  [${label}] ✗  status=${status}`);
      return false;
    }
    const mesh = solid.getMesh();
    if (!mesh || mesh.triVerts.length === 0) {
      console.log(`  [${label}] ✗  empty mesh (status=${status})`);
      return false;
    }
    const nTri = mesh.triVerts.length / 3;
    const nVert = mesh.vertProperties.length / mesh.numProp;
    const vol = solid.volume();
    console.log(`  [${label}] ✓  manifold  tri=${nTri}  vert=${nVert}  vol=${vol.toFixed(3)}`);
    return true;
  } catch (e) {
    console.log(`  [${label}] ✗  exception: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log('Loading manifold-3d...');
  const mf = await Module();
  mf.setup();
  console.log('Loaded.\n');

  const positions = makeFoldPositions();
  console.log(`Surface: ${R}×${R} grid, fold-back profile\n`);

  // Check x values to confirm fold
  const row0 = Array.from({ length: R }, (_, c) => positions[c * 3].toFixed(2));
  console.log('Front rail x values (col 0..20):', row0.join(' '));
  const foldBack = [];
  for (let c = 1; c < R; c++) {
    if (positions[c * 3] < positions[(c - 1) * 3]) foldBack.push(c);
  }
  console.log(`Fold-back at columns: [${foldBack.join(', ')}]\n`);

  // ── Test A: direct mesh ───────────────────────────────────────────────────
  console.log('Test A: buildNurbsSolidDirect (current implementation)');
  let solidA;
  try {
    solidA = buildNurbsSolidDirect(mf, positions);
    checkManifold(mf, solidA, 'A direct-mesh');
  } catch (e) {
    console.log(`  [A direct-mesh] ✗  construction exception: ${e.message}`);
  }

  // ── Test B: param warp ────────────────────────────────────────────────────
  console.log('\nTest B: buildNurbsSolidParamWarp (parameter-space cube warp)');
  let solidB;
  try {
    solidB = buildNurbsSolidParamWarp(mf, positions);
    checkManifold(mf, solidB, 'B param-warp');
  } catch (e) {
    console.log(`  [B param-warp] ✗  construction exception: ${e.message}`);
  }

  // ── Test B2: direct mesh with CONDITIONAL winding for fold-back ──────────
  console.log('\nTest B2: buildNurbsSolidDirectFixed (conditional winding for fold-back)');
  let solidB2;
  try {
    solidB2 = buildNurbsSolidDirectFixed(mf, positions);
    checkManifold(mf, solidB2, 'B2 direct-fixed');
  } catch (e) {
    console.log(`  [B2 direct-fixed] ✗  exception: ${e.message}`);
  }

  // ── Test C: CSG subtract with direct-mesh fold ────────────────────────────
  if (solidA) {
    console.log('\nTest C: CSG subtract using DIRECT MESH solids');
    try {
      const flatPositions = new Float32Array(N * 3);
      for (let row = 0; row < R; row++) {
        for (let col = 0; col < R; col++) {
          const i = row * R + col;
          flatPositions[i * 3]     = (col / resolution) * WX;
          flatPositions[i * 3 + 1] = (row / resolution) * strikeW;
          flatPositions[i * 3 + 2] = 4.0;
        }
      }
      const flatSolidA = buildNurbsSolidDirect(mf, flatPositions);
      checkManifold(mf, flatSolidA, 'C flat (direct)');
      const subtractedA = solidA.subtract(flatSolidA);
      checkManifold(mf, subtractedA, 'C subtract-A(fold - flat)');
    } catch (e) {
      console.log(`  [C CSG-A] ✗  exception: ${e.message}`);
    }
  }

  // ── Test D: CSG subtract with param-warp solids ───────────────────────────
  if (solidB) {
    console.log('\nTest D: CSG subtract using PARAM WARP solids');
    try {
      const flatPositions = new Float32Array(N * 3);
      for (let row = 0; row < R; row++) {
        for (let col = 0; col < R; col++) {
          const i = row * R + col;
          flatPositions[i * 3]     = (col / resolution) * WX;
          flatPositions[i * 3 + 1] = (row / resolution) * strikeW;
          flatPositions[i * 3 + 2] = 4.0;
        }
      }
      const flatSolidB = buildNurbsSolidParamWarp(mf, flatPositions);
      checkManifold(mf, flatSolidB, 'D flat (warp)');
      const subtractedB = solidB.subtract(flatSolidB);
      checkManifold(mf, subtractedB, 'D subtract-B(fold - flat)');
    } catch (e) {
      console.log(`  [D CSG-B] ✗  exception: ${e.message}`);
    }
  }

  // ── Test E: check if direct mesh self-intersects (vol vs warp) ────────────
  console.log('\nTest E: Volume comparison');
  if (solidA && solidB) {
    const volA = solidA.volume(), volB = solidB.volume();
    console.log(`  Direct mesh vol: ${volA.toFixed(3)}`);
    console.log(`  Param warp  vol: ${volB.toFixed(3)}`);
    console.log(`  Difference: ${Math.abs(volA - volB).toFixed(3)} (>0 suggests self-intersection in A adds phantom volume)`);
    // Check minGap between direct mesh and param warp
    try {
      const gap = solidA.minGap(solidB, 0.1);
      console.log(`  minGap(A,B): ${gap.toFixed(4)}`);
    } catch(e) {
      console.log(`  minGap: n/a (${e.message})`);
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
