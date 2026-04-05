<script>
  import { onMount } from 'svelte';
  import { Canvas, T } from '@threlte/core';
  import { OrbitControls, interactivity } from '@threlte/extras';
  import * as THREE from 'three';

  interactivity();

  // ── State ──────────────────────────────────────────────────────────────────
  let status   = $state('Loading manifold-3d WASM…');
  let geoSaddle   = $state(null);  // single warped cube
  let geoLayer0   = $state(null);  // layer block 0 (shallow)
  let geoLayer1   = $state(null);  // layer block 1 (deep)
  let error    = $state(null);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function meshToGeo(mesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position',
      new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), mesh.numProp));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
    g.computeVertexNormals();
    return g;
  }

  // ── Main test ──────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      // 1. Load WASM
      status = 'Initialising manifold-3d…';
      const Mod = (await import('manifold-3d')).default;
      const mf  = await Mod();
      mf.setup();
      status = 'manifold-3d ready — running tests…';

      const WX = 4, WS = 3, WY = 2;  // X=horiz, Y=strike, Z=depth

      // ── Test 1: single warped cube (saddle) ────────────────────────────────
      // Coordinate system: X=horizontal, Y=along-strike, Z=depth (0=surface, WY=base)
      // Bottom face (Z=0) = ground surface → stays fixed
      // Top face (Z=WY) = horizon depth → moves according to surface shape
      const solid = mf.Manifold.cube([WX, WS, WY], false).refine(5).warp(vert => {
        // Saddle horizon: deeper in the middle, shallower at edges
        const tx = vert[0] / WX - 0.5;  // ∈ [-0.5, 0.5]
        const ty = vert[1] / WS - 0.5;
        const hz = WY * 0.5 + WY * 0.3 * Math.sin(tx * Math.PI) * Math.sin(ty * Math.PI);
        // Clamp hz to (0, WY)
        const hzC = Math.max(0.05, Math.min(WY * 0.95, hz));
        // vert[2]=0 → 0 (surface stays); vert[2]=WY → hzC (horizon depth)
        vert[2] = hzC * vert[2] / WY;
      });

      const mesh1 = solid.getMesh();
      geoSaddle = meshToGeo(mesh1);
      status = `Test 1 OK: ${mesh1.triVerts.length / 3} triangles — running boolean test…`;

      // ── Test 2: two horizons, boolean subtract ─────────────────────────────
      // Horizon A: shallow (hz ≈ 0.4 * WY)
      const mfA = mf.Manifold.cube([WX, WS, WY], false).refine(5).warp(vert => {
        const hz = WY * 0.4;
        vert[2] = hz * vert[2] / WY;
      });

      // Horizon B: deep (hz ≈ 0.75 * WY)
      const mfB = mf.Manifold.cube([WX, WS, WY], false).refine(5).warp(vert => {
        const hz = WY * 0.75;
        vert[2] = hz * vert[2] / WY;
      });

      // Layer 0 = mfA (overburden from surface to horizon A)
      geoLayer0 = meshToGeo(mfA.getMesh());

      // Layer 1 = mfB minus mfA (interval between A and B)
      const layerAB = mfB.subtract(mfA);
      geoLayer1 = meshToGeo(layerAB.getMesh());

      const m2 = layerAB.getMesh();
      status = `All tests passed ✓ — saddle: ${mesh1.triVerts.length/3} tris | layer: ${m2.triVerts.length/3} tris`;

    } catch (e) {
      error  = e?.message ?? String(e);
      status = `ERROR: ${error}`;
      console.error('[manifold test]', e);
    }
  });
</script>

<div style="height:100vh;display:flex;flex-direction:column;font-family:sans-serif;background:#0f172a;color:#e2e8f0">

  <!-- Status bar -->
  <div style="padding:10px 16px;background:#1e293b;border-bottom:1px solid #334155;font-size:13px;font-family:monospace;flex-shrink:0">
    <span style="color:{error ? '#f87171' : '#4ade80'}">{status}</span>
  </div>

  <!-- Legend -->
  <div style="display:flex;gap:20px;padding:8px 16px;background:#1e293b;border-bottom:1px solid #334155;font-size:11px;flex-shrink:0">
    <span>Coordinate system: <b style="color:#93c5fd">X</b>=horizontal  <b style="color:#86efac">Y</b>=strike  <b style="color:#fca5a5">Z</b>=depth↓</span>
    <span style="color:#fbbf24">■</span> Saddle warp test
    <span style="color:#60a5fa">■</span> Shallow layer (horizon A)
    <span style="color:#34d399">■</span> Deep layer (A→B interval)
  </div>

  <!-- 3D canvas -->
  <div style="flex:1;min-height:0">
    <Canvas>
      <T.PerspectiveCamera makeDefault position={[6, -3, 4]} fov={45} />
      <OrbitControls enableDamping dampingFactor={0.07} target={[2, 1.5, 1]} />

      <T.AmbientLight intensity={0.5} />
      <T.DirectionalLight position={[8, -5, 10]} intensity={0.8} />
      <T.DirectionalLight position={[-5, 8, -5]} intensity={0.3} />

      <!-- Test 1: saddle warped solid (offset to the left) -->
      {#if geoSaddle}
        <T.Mesh geometry={geoSaddle} position={[-5, 0, 0]}>
          <T.MeshPhongMaterial color="#f59e0b" side={2} transparent opacity={0.85} shininess={40}/>
        </T.Mesh>
        <T.Mesh geometry={geoSaddle} position={[-5, 0, 0]}>
          <T.MeshBasicMaterial color="#000" wireframe transparent opacity={0.1}/>
        </T.Mesh>
      {/if}

      <!-- Test 2: two-layer boolean result -->
      {#if geoLayer0}
        <T.Mesh geometry={geoLayer0}>
          <T.MeshPhongMaterial color="#3b82f6" side={2} transparent opacity={0.75} shininess={30}/>
        </T.Mesh>
        <T.Mesh geometry={geoLayer0}>
          <T.MeshBasicMaterial color="#000" wireframe transparent opacity={0.1}/>
        </T.Mesh>
      {/if}
      {#if geoLayer1}
        <T.Mesh geometry={geoLayer1}>
          <T.MeshPhongMaterial color="#10b981" side={2} transparent opacity={0.75} shininess={30}/>
        </T.Mesh>
        <T.Mesh geometry={geoLayer1}>
          <T.MeshBasicMaterial color="#000" wireframe transparent opacity={0.1}/>
        </T.Mesh>
      {/if}

      <!-- Axis helper -->
      <T.AxesHelper args={[2]} />
    </Canvas>
  </div>

</div>
