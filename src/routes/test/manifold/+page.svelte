<script>
  import { onMount } from 'svelte';
  import { Canvas, T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import * as THREE from 'three';

  // ── State ──────────────────────────────────────────────────────────────────
  let status  = $state('Loading manifold-3d WASM…');
  let error   = $state(null);

  // Approach A: direct mesh with quad-strip walls (BROKEN for folds)
  let geoA    = $state(null);
  // Approach C: direct mesh with ear-clip walls (CORRECT fold shape)
  let geoC    = $state(null);
  // Approach C CSG: fold layer minus flat layer
  let geoCcsg = $state(null);
  // Approach B: cube warp via (u,v) parameter lookup (no fold in x-pos)
  let geoB    = $state(null);
  // The NURBS surface itself (for reference)
  let geoSurf = $state(null);
  // Approach D: orange minus sphere (manifold validity test)
  let geoCsphere = $state(null);

  let showA      = $state(false);
  let showC      = $state(true);
  let showCSG    = $state(true);
  let showB      = $state(false);
  let showSurf   = $state(true);
  let showCsphere= $state(true);

  // ── Console panel ──────────────────────────────────────────────────────────
  let consoleLogs  = $state([]);
  let showConsole  = $state(false);
  const errorCount = $derived(consoleLogs.filter(e => e.level === 'error' || e.level === 'warn').length);

  $effect(() => {
    const orig = { log: console.log, warn: console.warn, error: console.error };
    const cap = (level) => (...args) => {
      orig[level](...args);
      const msg = args.map(a => {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
      }).join(' ');
      consoleLogs = [...consoleLogs.slice(-299), { level, msg, ts: new Date().toLocaleTimeString() }];
    };
    console.log = cap('log'); console.warn = cap('warn'); console.error = cap('error');
    return () => Object.assign(console, orig);
  });

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

  // ── Ear clipping for 2D concave polygon (xz-plane) ───────────────────────
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
      const d1=cross(a,b,p), d2=cross(b,c,p), d3=cross(c,a,p);
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

  // ── Approach C: direct mesh with ear-clip walls (CORRECT for folds) ──────
  function buildSolidEarClip(mf, positions) {
    const verts = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N * 3; i++) verts[i] = positions[i];
    for (let i = 0; i < N; i++) {
      verts[(N+i)*3]   = positions[i*3];
      verts[(N+i)*3+1] = positions[i*3+1];
      verts[(N+i)*3+2] = WY;
    }
    const tris = [];
    for (let r=0;r<resolution;r++) for (let c=0;c<resolution;c++) {
      const a=r*R+c,b=a+1,d=a+R,e=d+1;
      tris.push(a,e,b); tris.push(a,d,e);
    }
    for (let r=0;r<resolution;r++) for (let c=0;c<resolution;c++) {
      const a=N+r*R+c,b=a+1,d=a+R,e=d+1;
      tris.push(a,b,e); tris.push(a,e,d);
    }
    { const poly=[],idx=[];
      for (let c=0;c<=resolution;c++) { idx.push(c); poly.push([positions[c*3],positions[c*3+2]]); }
      for (let c=resolution;c>=0;c--) { idx.push(N+c); poly.push([positions[c*3],WY]); }
      for (const [a,b,c] of earClip2D(poly)) tris.push(idx[a],idx[b],idx[c]);
    }
    { const poly=[],idx=[],row=resolution*R;
      for (let c=resolution;c>=0;c--) { idx.push(row+c); poly.push([positions[(row+c)*3],positions[(row+c)*3+2]]); }
      for (let c=0;c<=resolution;c++) { idx.push(N+row+c); poly.push([positions[(row+c)*3],WY]); }
      for (const [a,b,c] of earClip2D(poly)) tris.push(idx[a],idx[b],idx[c]);
    }
    for (let r=0;r<resolution;r++) {
      const t0=r*R,t1=(r+1)*R,b0=N+r*R,b1=N+(r+1)*R;
      tris.push(t0,b0,t1); tris.push(t1,b0,b1);
    }
    for (let r=0;r<resolution;r++) {
      const t0=r*R+resolution,t1=(r+1)*R+resolution,b0=N+r*R+resolution,b1=N+(r+1)*R+resolution;
      tris.push(t0,t1,b0); tris.push(t1,b1,b0);
    }
    return new mf.Manifold({numProp:3,vertProperties:verts,triVerts:new Int32Array(tris)});
  }

  // ── Approach A: direct mesh with quad-strip walls (BROKEN for folds) ─────
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

      // Approach A: direct mesh (quad-strip walls — broken)
      try {
        const solidA = buildSolidDirect(mf, positions);
        geoA = meshToGeo(solidA.getMesh());
        console.log('[A] quad-strip status:', solidA.status(), 'vol:', solidA.volume().toFixed(2));
      } catch(e) { console.error('[A] direct mesh failed:', e); }

      // Approach C: ear-clip walls (correct fold shape)
      try {
        const solidC = buildSolidEarClip(mf, positions);
        geoC = meshToGeo(solidC.getMesh());
        console.log('[C] ear-clip status:', solidC.status(), 'vol:', solidC.volume().toFixed(2));

        // CSG: fold layer minus flat layer
        const flatPos = new Float32Array(N * 3);
        for (let row = 0; row < R; row++) {
          for (let col = 0; col < R; col++) {
            const i = row*R+col;
            flatPos[i*3]   = (col/resolution)*WX;
            flatPos[i*3+1] = (row/resolution)*strikeW;
            flatPos[i*3+2] = 5.5;
          }
        }
        const flatC = buildSolidEarClip(mf, flatPos);
        const solidCcsg = solidC.subtract(flatC);
        geoCcsg = meshToGeo(solidCcsg.getMesh());
        console.log('[C-csg] subtract status:', solidCcsg.status(), 'vol:', solidCcsg.volume().toFixed(2));

        // D: orange minus sphere — manifold validity test
        // Sphere at [5, 3, 6]: centre of domain in x/y, z=6 is below fold surface and above WY=8 base
        const sphere = mf.Manifold.sphere(3.0, 32).translate([5, 3, 6]);
        const solidCsphere = solidC.subtract(sphere);
        const sphereSt = solidCsphere.status();
        console.log('[C-sphere] status:', sphereSt, 'vol:', solidCsphere.volume().toFixed(2));
        if (sphereSt === 'NoError') {
          geoCsphere = meshToGeo(solidCsphere.getMesh());
        } else {
          console.error('[C-sphere] CSG failed — orange solid is NOT manifold, status:', sphereSt);
        }
      } catch(e) { console.error('[C] ear-clip failed:', e); }

      // Approach B: cube warp (no fold in x-pos)
      try {
        const solidB = buildSolidParamWarp(mf, positions);
        geoB = meshToGeo(solidB.getMesh());
        console.log('[B] param warp status:', solidB.status(), 'vol:', solidB.volume().toFixed(2));
      } catch(e) { console.error('[B] param warp failed:', e); }

      status = 'Done ✓ — C (orange) = ear-clip fold solid | toggle others to compare';

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
    <span style="color:{error ? '#f87171' : '#4ade80'};flex:1">{status}</span>
    <button onclick={() => showConsole = !showConsole}
      style="position:relative;padding:2px 8px;border:1px solid {showConsole ? '#475569' : '#334155'};border-radius:4px;font-size:11px;cursor:pointer;background:{showConsole ? '#334155' : 'transparent'};color:{showConsole ? '#e2e8f0' : '#64748b'}">
      🖥 Console
      {#if errorCount > 0}
        <span style="position:absolute;top:-5px;right:-5px;background:#ef4444;color:#fff;font-size:9px;border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;line-height:1">{errorCount > 9 ? '9+' : errorCount}</span>
      {/if}
    </button>
  </div>

  <!-- Controls -->
  <div style="display:flex;gap:16px;padding:8px 16px;background:#1e293b;border-bottom:1px solid #334155;font-size:12px;flex-shrink:0;flex-wrap:wrap">
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showSurf} />
      <span style="color:#a78bfa">■</span> NURBS surface (reference)
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showC} />
      <span style="color:#f97316">■</span> C: Ear-clip walls (correct fold solid)
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showCSG} />
      <span style="color:#34d399">■</span> C CSG: fold layer minus flat layer
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showCsphere} />
      <span style="color:#fbbf24">■</span> D: C − Sphere (manifold test)
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showA} />
      <span style="color:#f87171">■</span> A: Quad-strip walls (broken — self-intersecting)
    </label>
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" bind:checked={showB} />
      <span style="color:#60a5fa">■</span> B: Cube warp (no fold in x-pos)
    </label>
  </div>

  <!-- 3D canvas -->
  <div style="flex:1;min-height:0;position:relative">
    {#if showConsole}
      <div style="position:absolute;top:8px;right:8px;width:360px;max-height:55%;display:flex;flex-direction:column;background:#0f172a;border:1px solid #334155;border-radius:6px;z-index:20;font-family:monospace;font-size:10px;color:#e2e8f0">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;border-bottom:1px solid #334155;flex-shrink:0">
          <span style="color:#94a3b8">Console ({consoleLogs.length})</span>
          <div style="display:flex;gap:10px">
            <button onclick={() => consoleLogs = []} style="color:#64748b;cursor:pointer;background:none;border:none">Clear</button>
            <button onclick={() => showConsole = false} style="color:#64748b;cursor:pointer;background:none;border:none">✕</button>
          </div>
        </div>
        <div style="overflow-y:auto;flex:1">
          {#each consoleLogs as entry}
            <div style="padding:2px 8px;border-bottom:1px solid #1e293b;color:{entry.level==='error'?'#f87171':entry.level==='warn'?'#fbbf24':'#64748b'};word-break:break-all;line-height:1.5">
              <span style="color:#334155">{entry.ts} </span>{entry.msg}
            </div>
          {/each}
        </div>
      </div>
    {/if}
    <Canvas>
      <T.PerspectiveCamera makeDefault position={[5, -12, 8]} fov={50}>
        <OrbitControls enableDamping dampingFactor={0.07} target={[5, 3, 4]} />
      </T.PerspectiveCamera>

      <T.AmbientLight intensity={0.6} />
      <T.DirectionalLight position={[10, -8, 12]} intensity={0.9} />
      <T.DirectionalLight position={[-6, 10, -4]} intensity={0.4} />

      <!-- NURBS surface mesh (reference) -->
      {#if showSurf && geoSurf}
        <T.Mesh geometry={geoSurf} position={[0, 0, -0.05]}>
          <T.MeshPhongMaterial color="#7c3aed" side={2} transparent opacity={0.7} shininess={60}/>
        </T.Mesh>
        <T.Mesh geometry={geoSurf} position={[0, 0, -0.05]}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <!-- Approach C: ear-clip direct mesh (centre) -->
      {#if showC && geoC}
        <T.Mesh geometry={geoC}>
          <T.MeshPhongMaterial color="#f97316" side={2} transparent opacity={0.85} shininess={30}/>
        </T.Mesh>
        <T.Mesh geometry={geoC}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <!-- C CSG result (right) -->
      {#if showCSG && geoCcsg}
        <T.Mesh geometry={geoCcsg} position={[12, 0, 0]}>
          <T.MeshPhongMaterial color="#10b981" side={2} transparent opacity={0.85} shininess={40}/>
        </T.Mesh>
        <T.Mesh geometry={geoCcsg} position={[12, 0, 0]}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <!-- D: orange minus sphere (manifold test, far right) -->
      {#if showCsphere && geoCsphere}
        <T.Mesh geometry={geoCsphere} position={[24, 0, 0]}>
          <T.MeshPhongMaterial color="#fbbf24" side={2} transparent opacity={0.85} shininess={40}/>
        </T.Mesh>
        <T.Mesh geometry={geoCsphere} position={[24, 0, 0]}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <!-- Approach A: quad-strip (left, for comparison) -->
      {#if showA && geoA}
        <T.Mesh geometry={geoA} position={[-12, 0, 0]}>
          <T.MeshPhongMaterial color="#ef4444" side={2} transparent opacity={0.85} shininess={30}/>
        </T.Mesh>
        <T.Mesh geometry={geoA} position={[-12, 0, 0]}>
          <T.MeshBasicMaterial color="#000000" wireframe />
        </T.Mesh>
      {/if}

      <!-- Approach B: cube warp (far left) -->
      {#if showB && geoB}
        <T.Mesh geometry={geoB} position={[-24, 0, 0]}>
          <T.MeshPhongMaterial color="#3b82f6" side={2} transparent opacity={0.85} shininess={30}/>
        </T.Mesh>
        <T.Mesh geometry={geoB} position={[-24, 0, 0]}>
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
    <b style="color:#f97316">C (orange, centre):</b> ear-clip walls — correct concave polygon triangulation, fold shape preserved &nbsp;|&nbsp;
    <b style="color:#34d399">C-CSG (green, right):</b> fold layer minus flat layer &nbsp;|&nbsp;
    <b style="color:#fbbf24">D (yellow, far-right):</b> C minus sphere — if solid is manifold, shows spherical hole; if broken, missing + console error &nbsp;|&nbsp;
    <b style="color:#f87171">A (red, left):</b> quad-strip walls — broken for folds (enable to compare) &nbsp;|&nbsp;
    <b style="color:#60a5fa">B (blue, far-left):</b> cube warp — no fold in x-pos (enable to compare)
  </div>

</div>
