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

// ── Ear clipping for 2D concave polygon ──────────────────────────────────────
function earClip2D(poly) {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  const ccw = area > 0;
  function cross(a, b, c) {
    return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0]);
  }
  function inTriangle(p, a, b, c) {
    const d1 = cross(a,b,p), d2 = cross(b,c,p), d3 = cross(c,a,p);
    return !((d1<0||d2<0||d3<0) && (d1>0||d2>0||d3>0));
  }
  const rem = Array.from({length:n},(_,i)=>i);
  const result = [];
  while (rem.length > 3) {
    let cut = false;
    for (let i = 0; i < rem.length; i++) {
      const pi=(i-1+rem.length)%rem.length, ni=(i+1)%rem.length;
      const prev=rem[pi], curr=rem[i], next=rem[ni];
      const c=cross(poly[prev],poly[curr],poly[next]);
      if (ccw ? c<=0 : c>=0) continue;
      let inside=false;
      for (let j=0; j<rem.length; j++) {
        if (j===pi||j===i||j===ni) continue;
        if (inTriangle(poly[rem[j]],poly[prev],poly[curr],poly[next])) { inside=true; break; }
      }
      if (inside) continue;
      result.push([prev,curr,next]); rem.splice(i,1); cut=true; break;
    }
    if (!cut) { result.push([rem[0],rem[1],rem[2]]); rem.splice(1,1); }
  }
  result.push([rem[0],rem[1],rem[2]]);
  return result;
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

// ── C) Direct mesh with ear-clip walls (CORRECT for folds) ───────────────────
function buildNurbsSolidEarClip(mf, positions) {
  const verts = new Float32Array(N * 2 * 3);
  for (let i = 0; i < N * 3; i++) verts[i] = positions[i];
  for (let i = 0; i < N; i++) {
    verts[(N+i)*3]   = positions[i*3];
    verts[(N+i)*3+1] = positions[i*3+1];
    verts[(N+i)*3+2] = WY;
  }
  const tris = [];
  // TOP
  for (let r=0;r<resolution;r++) for (let c=0;c<resolution;c++) {
    const a=r*R+c,b=a+1,d=a+R,e=d+1;
    tris.push(a,e,b); tris.push(a,d,e);
  }
  // BOTTOM
  for (let r=0;r<resolution;r++) for (let c=0;c<resolution;c++) {
    const a=N+r*R+c,b=a+1,d=a+R,e=d+1;
    tris.push(a,b,e); tris.push(a,e,d);
  }
  // FRONT wall — ear clip (CCW xz → -Y normal)
  { const poly=[],idx=[];
    for (let c=0;c<=resolution;c++) { idx.push(c); poly.push([positions[c*3],positions[c*3+2]]); }
    for (let c=resolution;c>=0;c--) { idx.push(N+c); poly.push([positions[c*3],WY]); }
    for (const [a,b,c] of earClip2D(poly)) tris.push(idx[a],idx[b],idx[c]);
  }
  // BACK wall — ear clip (CW xz → +Y normal)
  { const poly=[],idx=[],row=resolution*R;
    for (let c=resolution;c>=0;c--) { idx.push(row+c); poly.push([positions[(row+c)*3],positions[(row+c)*3+2]]); }
    for (let c=0;c<=resolution;c++) { idx.push(N+row+c); poly.push([positions[(row+c)*3],WY]); }
    for (const [a,b,c] of earClip2D(poly)) tris.push(idx[a],idx[b],idx[c]);
  }
  // LEFT wall
  for (let r=0;r<resolution;r++) {
    const t0=r*R,t1=(r+1)*R,b0=N+r*R,b1=N+(r+1)*R;
    tris.push(t0,b0,t1); tris.push(t1,b0,b1);
  }
  // RIGHT wall
  for (let r=0;r<resolution;r++) {
    const t0=r*R+resolution,t1=(r+1)*R+resolution,b0=N+r*R+resolution,b1=N+(r+1)*R+resolution;
    tris.push(t0,t1,b0); tris.push(t1,b1,b0);
  }
  return new mf.Manifold({numProp:3,vertProperties:verts,triVerts:new Int32Array(tris)});
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

  // ── Test A: direct mesh (broken quad strip walls) ─────────────────────────
  console.log('Test A: buildNurbsSolidDirect (quad strip walls — broken for folds)');
  let solidA;
  try {
    solidA = buildNurbsSolidDirect(mf, positions);
    checkManifold(mf, solidA, 'A direct-mesh');
  } catch (e) {
    console.log(`  [A direct-mesh] ✗  construction exception: ${e.message}`);
  }

  // ── Test C: ear-clip direct mesh ─────────────────────────────────────────
  console.log('\nTest C: buildNurbsSolidEarClip (ear-clip walls — CORRECT for folds)');
  let solidC;
  try {
    solidC = buildNurbsSolidEarClip(mf, positions);
    checkManifold(mf, solidC, 'C ear-clip');
  } catch(e) { console.log(`  [C ear-clip] ✗  exception: ${e.message}`); }

  // ── Test B: param warp ────────────────────────────────────────────────────
  console.log('\nTest B: buildNurbsSolidParamWarp (parameter-space cube warp)');
  let solidB;
  try {
    solidB = buildNurbsSolidParamWarp(mf, positions);
    checkManifold(mf, solidB, 'B param-warp');
  } catch (e) {
    console.log(`  [B param-warp] ✗  construction exception: ${e.message}`);
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

  // ── Test E: volume comparison ─────────────────────────────────────────────
  console.log('\nTest E: Volume comparison (C and B should match; A has phantom volume)');
  const vA = solidA?.volume(), vB = solidB?.volume(), vC = solidC?.volume();
  if (vA !== undefined) console.log(`  A quad-strip (broken): ${vA.toFixed(3)}`);
  if (vC !== undefined) console.log(`  C ear-clip  (fixed):   ${vC.toFixed(3)}`);
  if (vB !== undefined) console.log(`  B param-warp (correct): ${vB.toFixed(3)}`);
  if (vC !== undefined && vB !== undefined)
    console.log(`  C vs B difference: ${Math.abs(vC-vB).toFixed(3)} (should be small)`);

  // ── Test F: CSG subtract with ear-clip solid ──────────────────────────────
  if (solidC) {
    console.log('\nTest F: CSG subtract using ear-clip solids');
    try {
      const flatPos = new Float32Array(N * 3);
      for (let row=0;row<R;row++) for (let col=0;col<R;col++) {
        const i=row*R+col;
        flatPos[i*3]=(col/resolution)*WX; flatPos[i*3+1]=(row/resolution)*strikeW; flatPos[i*3+2]=4.0;
      }
      const flatC = buildNurbsSolidEarClip(mf, flatPos);
      checkManifold(mf, flatC, 'F flat (ear-clip)');
      const subC = solidC.subtract(flatC);
      checkManifold(mf, subC, 'F subtract(fold-C - flat-C)');
    } catch(e) { console.log(`  [F CSG-C] ✗  exception: ${e.message}`); }
  }

  // ── Test G: decompose() behaviour ────────────────────────────────────────────
  console.log('\nTest G: Manifold.decompose() — single body vs two disconnected bodies');

  // G1: single cube → decompose should return 1 part
  {
    const box = mf.Manifold.cube([2, 2, 2], true);
    try {
      const parts = box.decompose();
      console.log(`  G1 single cube: decompose() → ${parts.length} part(s) (expected 1)`);
    } catch(e) { console.log(`  G1 ✗ decompose not available: ${e.message}`); }
  }

  // G2: two separate cubes unioned → decompose should return 2 parts (if they don't touch)
  {
    // Place two cubes far apart so they don't share any face
    const box1 = mf.Manifold.cube([1, 1, 1], false);
    const box2 = mf.Manifold.cube([1, 1, 1], false).translate([3, 0, 0]);
    try {
      const combined = mf.Manifold.union([box1, box2]);
      const st = combined.status();
      const parts = combined.decompose();
      console.log(`  G2 two far-apart cubes unioned: status=${st} decompose()→${parts.length} part(s) (expected 2)`);
      parts.forEach((p, i) =>
        console.log(`    part[${i}]: status=${p.status()} vol=${p.volume().toFixed(3)}`)
      );
    } catch(e) { console.log(`  G2 ✗ exception: ${e.message}`); }
  }

  // G3: subtract a central bridge from a bar → splits into two pieces
  // Bar: 0..10 in X, 0..2 in Y, 0..2 in Z
  // Cutter: X 3..7, Y -1..3 (full height+), Z -1..3 (full depth+)  → splits bar left/right
  {
    const bar    = mf.Manifold.cube([10, 2, 2], false);
    const cutter = mf.Manifold.cube([4, 4, 4], false).translate([3, -1, -1]);
    try {
      const split = bar.subtract(cutter);
      const st = split.status();
      const parts = split.decompose();
      console.log(`  G3 bar minus center cutter: status=${st} decompose()→${parts.length} part(s) (expected 2)`);
      parts.forEach((p, i) =>
        console.log(`    part[${i}]: status=${p.status()} vol=${p.volume().toFixed(3)}`)
      );
    } catch(e) { console.log(`  G3 ✗ exception: ${e.message}`); }
  }

  // G4: subtract of two ear-clip NURBS solids that overlap partially
  // Use solidC (fold-back) as "baseBlock" and subtract a flat solid that only covers half the X range
  if (solidC) {
    console.log('\n  G4: subtract fold-back NURBS solid minus left-half flat → may split');
    try {
      // Left-half flat solid (covers X 0..WX/2)
      const halfPos = new Float32Array(N * 3);
      for (let row = 0; row < R; row++) for (let col = 0; col < R; col++) {
        const i = row * R + col;
        halfPos[i*3]   = (col / resolution) * (WX / 2);  // only left half
        halfPos[i*3+1] = (row / resolution) * strikeW;
        halfPos[i*3+2] = 4.0;
      }
      const halfFlat = buildNurbsSolidEarClip(mf, halfPos);
      checkManifold(mf, halfFlat, 'G4 half-flat');
      const g4 = solidC.subtract(halfFlat);
      const st = g4.status();
      if (st === 'NoError') {
        const parts = g4.decompose();
        console.log(`  G4 result: status=${st} vol=${g4.volume().toFixed(3)} decompose()→${parts.length} part(s)`);
      } else {
        console.log(`  G4 result: status=${st} (no decompose)`);
      }
    } catch(e) { console.log(`  G4 ✗ exception: ${e.message}`); }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
