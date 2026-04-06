<script>
  import { onMount } from 'svelte';
  import { Canvas, T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import * as THREE from 'three';

  // ── State ──────────────────────────────────────────────────────────────────
  let status  = $state('Loading manifold-3d WASM…');
  let error   = $state(null);

  // Approach A: direct mesh (current buildNurbsSolidDirect)
  let geoA    = $state(null);
  // Approach B: cube warp via (u,v) parameter lookup
  let geoB    = $state(null);
  // Approach B CSG: B_fold subtract B_flat
  let geoBcsg = $state(null);
  // The NURBS surface itself (for reference)
  let geoSurf = $state(null);

  let showA   = $state(true);
  let showB   = $state(true);
  let showCSG = $state(true);
  let showSurf= $state(true);

  const WX = 10, WY = 8, strikeW = 6;
  const resolution = 20;
  const R = resolution + 1;
  const N = R * R;

  // ── fold_fwd preset: x folds back in the middle ───────────────────────────
  const FOLD_FWD_RAW = [
    [0.00, 0.00], [0.15, -0.30], [0.35, -0.80], [0.55, -1.00],
    [0.72, -0.85], [0.78, -0.55],
    [0.68, -0.25],   // ← fold-back: x decreases
    [0.58,  0.00], [0.70,  0.10], [0.85,  0.05], [1.00,  0.00],
  ];

  function makeFoldPositions() {
    const pos = new Float32Array(N * 3);
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
      const d = pts[i][1] * (1 - ft) + pts[i + 1][1] * ft;
      return 3.5 + d * 2;
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

  // ── meshToGeo ─────────────────────────────────────────────────────────────
  function meshToGeo(mesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), mesh.numProp));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
    g.computeVertexNormals();
    return g;
  }

  // ── Approach A: direct mesh (current impl) ────────────────────────────────
  function buildSolidDirect(mf, positions) {
    const verts = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N * 3; i++) verts[i] = positions[i];
    for (let i = 0; i < N; i++) {
      verts[(N + i) * 3]     = positions[i * 3];
      verts[(N + i) * 3 + 1] = positions[i * 3 + 1];
      verts[(N + i) * 3 + 2] = WY;
    }
    const tris = [];
    // TOP face (reversed winding → normal -Z)
    for (let r = 0; r < resolution; r++) {
      for (let c = 0; c < resolution; c++) {
        const a = r*R+c, b=a+1, d=a+R, e=d+1;
        tris.push(a,e,b); tris.push(a,d,e);
      }
    }
    // BOTTOM face (normal +Z)
    for (let r = 0; r < resolution; r++) {
      for (let c = 0; c < resolution; c++) {
        const a = N+r*R+c, b=a+1, d=a+R, e=d+1;
        tris.push(a,b,e); tris.push(a,e,d);
      }
    }
    // FRONT wall (r=0, normal ≈ -Y)
    for (let c = 0; c < resolution; c++) {
      tris.push(c, c+1, N+c); tris.push(c+1, N+c+1, N+c);
    }
    // BACK wall (r=resolution, normal ≈ +Y)
    for (let c = 0; c < resolution; c++) {
      const t0=resolution*R+c, t1=resolution*R+c+1;
      const b0=N+resolution*R+c, b1=N+resolution*R+c+1;
      tris.push(t0,b0,t1); tris.push(t1,b0,b1);
    }
    // LEFT wall (c=0, normal ≈ -X)
    for (let r = 0; r < resolution; r++) {
      const t0=r*R, t1=(r+1)*R, b0=N+r*R, b1=N+(r+1)*R;
      tris.push(t0,b0,t1); tris.push(t1,b0,b1);
    }
    // RIGHT wall (c=resolution, normal ≈ +X)
    for (let r = 0; r < resolution; r++) {
      const t0=r*R+resolution, t1=(r+1)*R+resolution;
      const b0=N+r*R+resolution, b1=N+(r+1)*R+resolution;
      tris.push(t0,t1,b0); tris.push(t1,b1,b0);
    }
    return new mf.Manifold({ numProp:3, vertProperties:verts, triVerts:new Int32Array(tris) });
  }

  // ── Approach B: cube warp via (u,v) parameter lookup ─────────────────────
  function buildSolidParamWarp(mf, positions, refineN = 8) {
    // Build z-grid indexed by (row=V, col=U) parameter
    const grid = new Float32Array(R * R);
    for (let row = 0; row < R; row++) {
      for (let col = 0; col < R; col++) {
        grid[row * R + col] = positions[(row * R + col) * 3 + 2];
      }
    }
    function paramZ(uFrac, vFrac) {
      const cf = Math.max(0, Math.min(R-1, uFrac*(R-1)));
      const c0 = Math.min(R-2, Math.floor(cf)), ct = cf-c0;
      const rf = Math.max(0, Math.min(R-1, vFrac*(R-1)));
      const r0 = Math.min(R-2, Math.floor(rf)), rt = rf-r0;
      return grid[r0*R+c0]     *(1-rt)*(1-ct)
           + grid[r0*R+c0+1]   *(1-rt)*ct
           + grid[(r0+1)*R+c0] *rt    *(1-ct)
           + grid[(r0+1)*R+c0+1]*rt   *ct;
    }
    return mf.Manifold.cube([WX, strikeW, WY], false)
      .refine(refineN)
      .warp(vert => {
        const hz = Math.max(0.01, Math.min(WY*0.99, paramZ(vert[0]/WX, vert[1]/strikeW)));
        vert[2] = hz + (WY - hz) * vert[2] / WY;
      });
  }

  // ── Main test ──────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      status = 'Initialising manifold-3d…';
      const Mod = (await import('manifold-3d')).default;
      const mf  = await Mod();
      mf.setup();

      const positions = makeFoldPositions();
      status = 'Building solids…';

      // NURBS surface geometry (top face only, for reference)
      {
        const surfVerts = positions.slice();
        const surfTris = [];
        for (let r = 0; r < resolution; r++) {
          for (let c = 0; c < resolution; c++) {
            const a = r*R+c, b=a+1, d=a+R, e=d+1;
            surfTris.push(a,b,e); surfTris.push(a,e,d);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(surfVerts, 3));
        g.setIndex(surfTris);
        g.computeVertexNormals();
        geoSurf = g;
      }

      // Approach A: direct mesh
      try {
        const solidA = buildSolidDirect(mf, positions);
        const meshA  = solidA.getMesh();
        geoA = meshToGeo(meshA);
        const statusA = solidA.status();
        console.log('[A] direct mesh status:', statusA, 'vol:', solidA.volume().toFixed(2));
      } catch(e) { console.error('[A] direct mesh failed:', e); }

      // Approach B: cube warp
      try {
        const solidB = buildSolidParamWarp(mf, positions);
        const meshB  = solidB.getMesh();
        geoB = meshToGeo(meshB);
        console.log('[B] param warp status:', solidB.status(), 'vol:', solidB.volume().toFixed(2));

        // CSG: fold layer minus flat base layer (simulates deposition operator)
        const flatPos = new Float32Array(N * 3);
        for (let row = 0; row < R; row++) {
          for (let col = 0; col < R; col++) {
            const i = row*R+col;
            flatPos[i*3]   = (col/resolution)*WX;
            flatPos[i*3+1] = (row/resolution)*strikeW;
            flatPos[i*3+2] = 5.5;   // flat layer at z=5.5
          }
        }
        const solidFlat = buildSolidParamWarp(mf, flatPos);
        const solidBcsg = solidB.subtract(solidFlat);
        geoBcsg = meshToGeo(solidBcsg.getMesh());
        console.log('[B-csg] subtract status:', solidBcsg.status(), 'vol:', solidBcsg.volume().toFixed(2));
      } catch(e) { console.error('[B] param warp failed:', e); }

      status = 'Done ✓ — use toggles to compare approaches';

    } catch (e) {
      error  = e?.message ?? String(e);
      status = `ERROR: ${error}`;
      console.error('[manifold fold test]', e);
    }
  });
</script>

<div style="height:100vh;display:flex;flex-direction:column;font-family:sans-serif;background:#0f172a;color:#e2e8f0">

  <!-- Status bar -->
  <div style="padding:8px 16px;background:#1e293b;border-bottom:1px solid #334155;font-size:12px;font-family:monospace;flex-shrink:0;display:flex;gap:16px;align-items:center">
    <span style="color:{error ? '#f87171' : '#4ade80'}">{status}</span>
  </div>

  <!-- Controls -->
  <div style="display:flex;gap:16px;padding:8px 16px;background:#1e293b;border-bottom:1px solid #334155;font-size:12px;flex-shrink:0;flex-wrap:wrap">
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showSurf} />
      <span style="color:#a78bfa">■</span> NURBS surface (reference)
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showA} />
      <span style="color:#f87171">■</span> A: Direct mesh (current — may have self-intersecting walls)
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showB} />
      <span style="color:#60a5fa">■</span> B: Cube warp via (u,v) param lookup (no fold in x-pos)
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showCSG} />
      <span style="color:#34d399">■</span> B CSG: fold layer minus flat layer
    </label>
  </div>

  <!-- 3D canvas -->
  <div style="flex:1;min-height:0">
    <Canvas>
      <T.PerspectiveCamera makeDefault position={[5, -12, 8]} fov={50}>
        <OrbitControls enableDamping dampingFactor={0.07} target={[5, 3, 4]} />
      </T.PerspectiveCamera>

      <T.AmbientLight intensity={0.6} />
      <T.DirectionalLight position={[10, -8, 12]} intensity={0.9} />
      <T.DirectionalLight position={[-6, 10, -4]} intensity={0.4} />

      <!-- NURBS surface mesh (reference, offset above) -->
      {#if showSurf && geoSurf}
        <T.Mesh geometry={geoSurf} position={[0, 0, -0.05]}>
          <T.MeshPhongMaterial color="#7c3aed" side={2} transparent opacity={0.7} shininess={60}/>
        </T.Mesh>
        <T.Mesh geometry={geoSurf} position={[0, 0, -0.05]}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <!-- Approach A: direct mesh -->
      {#if showA && geoA}
        <T.Mesh geometry={geoA} position={[-12, 0, 0]}>
          <T.MeshPhongMaterial color="#ef4444" side={2} transparent opacity={0.85} shininess={30}/>
        </T.Mesh>
        <T.Mesh geometry={geoA} position={[-12, 0, 0]}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <!-- Approach B: cube warp -->
      {#if showB && geoB}
        <T.Mesh geometry={geoB}>
          <T.MeshPhongMaterial color="#3b82f6" side={2} transparent opacity={0.85} shininess={30}/>
        </T.Mesh>
        <T.Mesh geometry={geoB}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <!-- B CSG result -->
      {#if showCSG && geoBcsg}
        <T.Mesh geometry={geoBcsg} position={[12, 0, 0]}>
          <T.MeshPhongMaterial color="#10b981" side={2} transparent opacity={0.85} shininess={40}/>
        </T.Mesh>
        <T.Mesh geometry={geoBcsg} position={[12, 0, 0]}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <T.AxesHelper args={[3]} />
    </Canvas>
  </div>

  <!-- Info panel -->
  <div style="padding:8px 16px;background:#1e293b;border-top:1px solid #334155;font-size:11px;color:#94a3b8;flex-shrink:0">
    Fold profile: x goes 0→7.8→5.8→10 (fold-back at u≈0.5..0.65) | WX={WX} WY={WY} strikeW={strikeW} | resolution={resolution}×{resolution}
    <br/>
    A (red, left): direct mesh — walls may self-intersect at fold-back &nbsp;|&nbsp;
    B (blue, centre): cube warp — always manifold, fold visible only in z-depth &nbsp;|&nbsp;
    B-CSG (green, right): fold layer minus flat layer
  </div>

</div>
