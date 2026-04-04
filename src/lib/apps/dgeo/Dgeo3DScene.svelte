<script>
  import { T } from '@threlte/core';
  import { OrbitControls, interactivity } from '@threlte/extras';
  import * as THREE from 'three';

  let {
    horizons     = [],
    domX,
    domY,
    strikeKm     = 5,
    editHorizonId = $bindable(null),
    editRailIdx   = $bindable(null),
    onUpdateRails = null,   // (horizonId, newRails) => void
  } = $props();

  // Enable Threlte's Three.js raycasting on T.Mesh elements
  interactivity();

  // ── World scaling ──────────────────────────────────────────────────────────
  const WX = 10, WY = 7;
  const strikeW = $derived((strikeKm / (domX.max - domX.min)) * WX);

  const nx    = x  => (x  - domX.min) / (domX.max - domX.min) * WX;
  const ny    = y  => -(y - domY.min) / (domY.max - domY.min) * WY;
  const nz_km = z  => z / strikeKm * strikeW;
  const fromNx = wx => domX.min + (wx / WX) * (domX.max - domX.min);
  const fromNy = wy => domY.min + (-wy / WY) * (domY.max - domY.min);

  // ── Sorted horizons ────────────────────────────────────────────────────────
  const sorted = $derived(
    [...horizons].sort((a, b) => {
      const avg = h => h.points?.length
        ? h.points.reduce((s, p) => s + p.y, 0) / h.points.length : 0;
      return avg(a) - avg(b);
    })
  );

  // ── Rail helpers ───────────────────────────────────────────────────────────
  function getRails(h) {
    if (h.rails && h.rails.length >= 2) return h.rails;
    const pts = h.points ?? [];
    return [
      { z: 0,        points: pts },
      { z: strikeKm, points: pts },
    ];
  }

  function interpY(sortedPts, x) {
    if (!sortedPts.length) return (domY.min + domY.max) / 2;
    if (x <= sortedPts[0].x) return sortedPts[0].y;
    if (x >= sortedPts[sortedPts.length - 1].x) return sortedPts[sortedPts.length - 1].y;
    for (let i = 0; i < sortedPts.length - 1; i++) {
      const p1 = sortedPts[i], p2 = sortedPts[i + 1];
      if (x >= p1.x && x <= p2.x) {
        const t = (x - p1.x) / (p2.x - p1.x);
        return p1.y + t * (p2.y - p1.y);
      }
    }
    return sortedPts[sortedPts.length - 1].y;
  }

  // ── Surface geometry: bilinear grid interpolation from rails ──────────────
  function buildGridGeo(rails, nX = 50) {
    const sr = [...rails].sort((a, b) => a.z - b.z);
    if (sr.length < 2) return null;

    const nR = sr.length;
    const xSamples = Array.from({ length: nX }, (_, i) =>
      domX.min + (i / (nX - 1)) * (domX.max - domX.min)
    );

    const grid = sr.map(rail => {
      const sp = [...rail.points].sort((a, b) => a.x - b.x);
      return xSamples.map(x => [nx(x), ny(interpY(sp, x)), nz_km(rail.z)]);
    });

    const verts = new Float32Array(nR * nX * 3);
    for (let r = 0; r < nR; r++) {
      for (let x = 0; x < nX; x++) {
        const idx = (r * nX + x) * 3;
        [verts[idx], verts[idx + 1], verts[idx + 2]] = grid[r][x];
      }
    }

    const indices = [];
    for (let r = 0; r < nR - 1; r++) {
      for (let x = 0; x < nX - 1; x++) {
        const a = r * nX + x, b = a + 1;
        const c = (r + 1) * nX + x, d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ── Derived: surface meshes for all horizons ───────────────────────────────
  const surfaces = $derived.by(() => {
    const sh = sorted;
    return sh.map((h, i) => {
      const rails = getRails(h);
      const geo = buildGridGeo(rails);
      const color = i === 0 ? '#e8f5e9' : sh[i].colour;
      return geo ? { geo, color, id: h.id, name: h.name } : null;
    }).filter(Boolean);
  });

  $effect(() => {
    const snap = surfaces;
    return () => { for (const s of snap) s.geo?.dispose(); };
  });

  // ── Frame ──────────────────────────────────────────────────────────────────
  const frameGeo = $derived.by(() => {
    const sw = strikeW;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const c = [V(0,0,0),V(WX,0,0),V(WX,-WY,0),V(0,-WY,0),
                V(0,0,sw),V(WX,0,sw),V(WX,-WY,sw),V(0,-WY,sw)];
    const ei = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    const pts = []; for (const [a,b] of ei) pts.push(c[a], c[b]);
    return new THREE.BufferGeometry().setFromPoints(pts);
  });
  $effect(() => { const g = frameGeo; return () => g?.dispose(); });

  // ── Floor grid ─────────────────────────────────────────────────────────────
  const gridGeo = $derived.by(() => {
    const sw = strikeW; const y = -WY; const pts = [];
    for (let i = 0; i <= 5; i++) {
      const x = (i / 5) * WX, z = (i / 5) * sw;
      pts.push(new THREE.Vector3(x, y, 0),  new THREE.Vector3(x, y, sw));
      pts.push(new THREE.Vector3(0, y, z),   new THREE.Vector3(WX, y, z));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  });
  $effect(() => { const g = gridGeo; return () => g?.dispose(); });

  // ── Editing state ──────────────────────────────────────────────────────────
  let isDragging   = $state(false);
  let dragPointIdx = $state(null);

  const editHorizon = $derived(horizons.find(h => h.id === editHorizonId) ?? null);
  const editRailsSorted = $derived(
    editHorizon ? [...getRails(editHorizon)].sort((a, b) => a.z - b.z) : []
  );
  const activeRail = $derived(
    editRailIdx !== null ? (editRailsSorted[editRailIdx] ?? null) : null
  );
  const dragPlaneZ = $derived(activeRail ? nz_km(activeRail.z) : 0);

  // Control point spheres (for active rail)
  const controlPoints = $derived(
    activeRail
      ? activeRail.points.map((p, i) => ({
          idx: i, p,
          wx: nx(p.x), wy: ny(p.y), wz: nz_km(activeRail.z),
        }))
      : []
  );

  // Rail line geometries (all rails for edit horizon, shown as lines)
  const railLineGeos = $derived.by(() => {
    if (!editHorizonId) return [];
    return editRailsSorted.map((rail, ri) => {
      const pts = [...rail.points].sort((a, b) => a.x - b.x);
      if (pts.length < 2) return null;
      const geo = new THREE.BufferGeometry().setFromPoints(
        pts.map(p => new THREE.Vector3(nx(p.x), ny(p.y), nz_km(rail.z)))
      );
      return { geo, ri, active: ri === editRailIdx };
    }).filter(Boolean);
  });
  $effect(() => {
    const snap = railLineGeos;
    return () => { for (const l of snap) l.geo?.dispose(); };
  });

  // ── Drag handlers ──────────────────────────────────────────────────────────
  function startDrag(ptIdx, e) {
    e.stopPropagation();
    dragPointIdx = ptIdx;
    isDragging = true;
  }

  function onDragMove(e) {
    if (!isDragging || dragPointIdx === null || !editHorizon || !activeRail) return;
    const newX = Math.max(domX.min, Math.min(domX.max, fromNx(e.point.x)));
    const newY = Math.max(domY.min, Math.min(domY.max, fromNy(e.point.y)));

    const newRails = editRailsSorted.map((rail, ri) => {
      if (ri !== editRailIdx) return rail;
      return {
        ...rail,
        points: rail.points.map((p, pi) =>
          pi === dragPointIdx ? { ...p, x: newX, y: newY } : p
        ),
      };
    });
    onUpdateRails?.(editHorizonId, newRails);
  }

  function endDrag() { isDragging = false; dragPointIdx = null; }

  // Camera
  const camTarget = $derived([WX / 2, -WY / 2, strikeW / 2]);
  const camPos    = $derived([WX * 1.8, WY * 0.6, strikeW + WX * 0.6]);

  // ── Slice-plane indicator (like pyenthu Slider.svelte) ─────────────────────
  // Blue rectangle at active rail's Z position, visible even when not dragging
  const slicePlaneGeo = $derived.by(() => {
    if (!activeRail) return null;
    const z = nz_km(activeRail.z);
    const pts = [
      new THREE.Vector3(0,  0,  z),
      new THREE.Vector3(WX, 0,  z),
      new THREE.Vector3(WX, -WY, z),
      new THREE.Vector3(0,  -WY, z),
      new THREE.Vector3(0,  0,  z),
    ];
    return new THREE.BufferGeometry().setFromPoints(pts);
  });
  $effect(() => { const g = slicePlaneGeo; return () => g?.dispose(); });

  // Semi-transparent fill for the slice plane
  const sliceFillGeo = $derived.by(() => {
    if (!activeRail) return null;
    const z = nz_km(activeRail.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0,0,z, WX,0,z, WX,-WY,z, 0,-WY,z]), 3));
    geo.setIndex([0,1,2, 0,2,3]);
    return geo;
  });
  $effect(() => { const g = sliceFillGeo; return () => g?.dispose(); });
</script>

<!-- Camera -->
<T.PerspectiveCamera makeDefault fov={45} near={0.01} far={200} position={camPos}>
  <OrbitControls
    target={camTarget}
    enableDamping
    dampingFactor={0.07}
    enabled={!isDragging}
  />
</T.PerspectiveCamera>

<!-- Lights -->
<T.AmbientLight intensity={0.7} />
<T.DirectionalLight position={[14, 10, -8]} intensity={0.55} />
<T.DirectionalLight position={[-8, 4, 14]} intensity={0.25} />

<!-- ── Formation surfaces ──────────────────────────────────────────────────── -->
{#each surfaces as s (s.geo.uuid)}
  <T.Mesh
    geometry={s.geo}
    onclick={() => { editHorizonId = s.id; editRailIdx = 0; }}
  >
    <T.MeshLambertMaterial
      color={s.color}
      transparent={true}
      opacity={0.88}
      side={THREE.DoubleSide}
    />
  </T.Mesh>
{/each}

<!-- ── Rail lines for selected horizon ────────────────────────────────────── -->
{#each railLineGeos as l (l.geo.uuid)}
  <T is={THREE.Line} geometry={l.geo} onclick={() => (editRailIdx = l.ri)}>
    <T.LineBasicMaterial
      color={l.active ? '#2563eb' : '#94a3b8'}
    />
  </T>
{/each}

<!-- ── Control point spheres ──────────────────────────────────────────────── -->
{#each controlPoints as cp (cp.idx)}
  <T.Mesh
    position={[cp.wx, cp.wy, cp.wz]}
    onpointerdown={(e) => startDrag(cp.idx, e)}
  >
    <T.SphereGeometry args={[0.18, 10, 10]} />
    <T.MeshBasicMaterial
      color={dragPointIdx === cp.idx ? '#ef4444' : '#2563eb'}
    />
  </T.Mesh>
{/each}

<!-- ── Drag capture plane (active rail's Z position) ──────────────────────── -->
{#if isDragging && activeRail !== null}
  <T.Mesh
    position={[WX / 2, -WY / 2, dragPlaneZ]}
    onpointermove={onDragMove}
    onpointerup={endDrag}
    onpointerleave={endDrag}
  >
    <T.PlaneGeometry args={[WX * 6, WY * 6]} />
    <T.MeshBasicMaterial
      transparent={true}
      opacity={0}
      depthWrite={false}
      side={THREE.DoubleSide}
    />
  </T.Mesh>
{/if}

<!-- ── Active-rail slice plane (like pyenthu Slider) ──────────────────────── -->
{#if sliceFillGeo}
  <T.Mesh geometry={sliceFillGeo}>
    <T.MeshBasicMaterial
      color="#3b82f6"
      transparent={true}
      opacity={0.07}
      side={THREE.DoubleSide}
      depthWrite={false}
    />
  </T.Mesh>
{/if}
{#if slicePlaneGeo}
  <T is={THREE.Line} geometry={slicePlaneGeo}>
    <T.LineBasicMaterial color="#2563eb" transparent={true} opacity={0.85} />
  </T>
{/if}

<!-- ── Block wireframe ─────────────────────────────────────────────────────── -->
<T is={THREE.LineSegments} geometry={frameGeo}>
  <T.LineBasicMaterial color={0x1e293b} transparent={true} opacity={0.65} />
</T>

<!-- ── Floor grid ─────────────────────────────────────────────────────────── -->
<T is={THREE.LineSegments} geometry={gridGeo}>
  <T.LineBasicMaterial color={0x94a3b8} transparent={true} opacity={0.22} />
</T>
