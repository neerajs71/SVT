<script>
  import { T, Canvas } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import * as THREE from 'three';

  let { horizons = [], domX, domY, activeId = null } = $props();

  // ── World scaling ──────────────────────────────────────────────────────────
  // Domain mapped to a normalised world box: WX wide, WY deep
  const WX = 10;
  const WY = 7;

  let strikeKm = $state(5);    // extrusion along strike (same units as domX)
  const strikeW = $derived((strikeKm / (domX.max - domX.min)) * WX);

  function nx(x) { return (x - domX.min) / (domX.max - domX.min) * WX; }
  function ny(y) { return -(y - domY.min) / (domY.max - domY.min) * WY; }  // negative = deeper

  // Sorted shallowest → deepest
  const sorted = $derived(
    [...horizons].sort((a, b) => {
      const avg = h => h.points.length ? h.points.reduce((s, p) => s + p.y, 0) / h.points.length : 0;
      return avg(a) - avg(b);
    })
  );

  // ── Geometry builders ──────────────────────────────────────────────────────

  function extrudeShape(upperPts, lowerPts, sw) {
    const uS = [...upperPts].sort((a, b) => a.x - b.x);
    const lS = [...lowerPts].sort((a, b) => a.x - b.x);
    if (!uS.length || !lS.length) return null;

    const shape = new THREE.Shape();
    shape.moveTo(nx(domX.min), ny(uS[0].y));
    for (const p of uS) shape.lineTo(nx(p.x), ny(p.y));
    shape.lineTo(nx(domX.max), ny(uS[uS.length - 1].y));
    shape.lineTo(nx(domX.max), ny(lS[lS.length - 1].y));
    for (let i = lS.length - 1; i >= 0; i--) shape.lineTo(nx(lS[i].x), ny(lS[i].y));
    shape.lineTo(nx(domX.min), ny(lS[0].y));
    shape.closePath();

    return new THREE.ExtrudeGeometry(shape, { depth: sw, bevelEnabled: false });
  }

  // Formation layers (reactive — dispose old geometries automatically)
  const formations = $derived.by(() => {
    const sh = sorted;
    const sw = strikeW;
    const layers = [];

    if (sh.length > 0) {
      const geo = extrudeShape(
        [{ x: domX.min, y: domY.min }, { x: domX.max, y: domY.min }],
        sh[0].points, sw
      );
      if (geo) layers.push({ geo, color: '#e8f5e9', opacity: 0.45 });
    }
    for (let i = 0; i < sh.length - 1; i++) {
      const geo = extrudeShape(sh[i].points, sh[i + 1].points, sw);
      if (geo) layers.push({ geo, color: sh[i + 1].colour, opacity: 0.88 });
    }
    if (sh.length > 0) {
      const geo = extrudeShape(
        sh[sh.length - 1].points,
        [{ x: domX.min, y: domY.max }, { x: domX.max, y: domY.max }],
        sw
      );
      if (geo) layers.push({ geo, color: '#6d4c41', opacity: 0.90 });
    }
    return layers;
  });

  $effect(() => {
    const snapshot = formations;
    return () => { for (const f of snapshot) f.geo?.dispose(); };
  });

  // Horizon line geometries (front and back faces)
  const horizonLines = $derived.by(() => {
    const sh = sorted;
    const sw = strikeW;
    const lines = [];
    for (const h of sh) {
      const pts = [...h.points].sort((a, b) => a.x - b.x);
      if (pts.length < 2) continue;
      const isActive = h.id === activeId;
      for (const z of [0, sw]) {
        const geo = new THREE.BufferGeometry().setFromPoints(
          pts.map(p => new THREE.Vector3(nx(p.x), ny(p.y), z))
        );
        lines.push({ geo, color: h.colour, active: isActive });
      }
    }
    return lines;
  });

  $effect(() => {
    const snapshot = horizonLines;
    return () => { for (const l of snapshot) l.geo?.dispose(); };
  });

  // Bounding box frame
  const frameGeo = $derived.by(() => {
    const sw = strikeW;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const c = [
      V(0,0,0), V(WX,0,0), V(WX,-WY,0), V(0,-WY,0),
      V(0,0,sw), V(WX,0,sw), V(WX,-WY,sw), V(0,-WY,sw),
    ];
    const idx = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    const pts = [];
    for (const [a, b] of idx) pts.push(c[a], c[b]);
    return new THREE.BufferGeometry().setFromPoints(pts);
  });
  $effect(() => { const g = frameGeo; return () => g?.dispose(); });

  // Floor grid
  const gridGeo = $derived.by(() => {
    const sw = strikeW;
    const y = -WY;
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const xv = (i / 5) * WX;
      const zv = (i / 5) * sw;
      pts.push(new THREE.Vector3(xv, y, 0), new THREE.Vector3(xv, y, sw));
      pts.push(new THREE.Vector3(0, y, zv), new THREE.Vector3(WX, y, zv));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  });
  $effect(() => { const g = gridGeo; return () => g?.dispose(); });

  // Camera & controls
  const camTarget  = $derived([WX / 2, -WY / 2, strikeW / 2] );
  const camPos     = $derived([WX * 1.8, WY * 0.6, strikeW + WX * 0.6]);

  let resetKey = $state(0);
  function resetView() { resetKey++; }
</script>

<div class="flex flex-col h-full">
  <!-- Top controls bar -->
  <div class="flex items-center flex-wrap gap-3 px-3 py-1.5 border-b border-gray-100 bg-gray-50 text-xs text-gray-600 flex-shrink-0">
    <span class="font-semibold text-gray-700">3D Block View</span>

    <label class="flex items-center gap-1.5">
      <span class="text-gray-500">Strike:</span>
      <input type="range" min="1" max="20" step="0.5" bind:value={strikeKm}
        class="w-20 accent-blue-600"/>
      <span class="font-mono w-9 text-gray-600">{strikeKm} km</span>
    </label>

    <button onclick={resetView}
      class="px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-100">
      ⟲ Reset
    </button>

    <span class="ml-auto text-gray-400 hidden sm:block text-[10px]">
      Drag to orbit · Scroll to zoom · Right-drag to pan
    </span>
  </div>

  <!-- Threlte canvas -->
  <div class="flex-1 overflow-hidden touch-none">
    {#key resetKey}
      <Canvas>

        <!-- Camera + orbit controls -->
        <T.PerspectiveCamera
          makeDefault
          fov={45}
          near={0.01}
          far={200}
          position={camPos}
        >
          <OrbitControls
            target={camTarget}
            enableDamping
            dampingFactor={0.07}
          />
        </T.PerspectiveCamera>

        <!-- Lights -->
        <T.AmbientLight intensity={0.7} />
        <T.DirectionalLight position={[14, 10, -8]} intensity={0.55} />
        <T.DirectionalLight position={[-8, 4, 14]} intensity={0.25} />

        <!-- Formation meshes -->
        {#each formations as f (f.geo.uuid)}
          <T.Mesh geometry={f.geo}>
            <T.MeshLambertMaterial
              color={f.color}
              transparent={true}
              opacity={f.opacity}
              side={THREE.FrontSide}
            />
          </T.Mesh>
        {/each}

        <!-- Horizon lines on front and back faces -->
        {#each horizonLines as l (l.geo.uuid)}
          <T is={THREE.Line} geometry={l.geo}>
            <T.LineBasicMaterial color={l.color} />
          </T>
        {/each}

        <!-- Bounding box frame -->
        <T is={THREE.LineSegments} geometry={frameGeo}>
          <T.LineBasicMaterial color={0x1e293b} transparent={true} opacity={0.65} />
        </T>

        <!-- Floor grid -->
        <T is={THREE.LineSegments} geometry={gridGeo}>
          <T.LineBasicMaterial color={0x94a3b8} transparent={true} opacity={0.22} />
        </T>

      </Canvas>
    {/key}
  </div>
</div>
