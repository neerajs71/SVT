<script>
  import { T } from '@threlte/core';
  import { OrbitControls, interactivity } from '@threlte/extras';
  import * as THREE from 'three';
  import { buildLayerSolids } from './manifoldSolid.js';

  let {
    horizons      = [],
    domX,
    domY,
    strikeKm      = 5,
    showSolids    = false,
    editHorizonId = $bindable(null),
    editRailIdx   = $bindable(null),
    onUpdateRails = null,
  } = $props();

  // Enable Threlte raycasting
  interactivity();

  // ── World dimensions ───────────────────────────────────────────────────────
  // X = horizontal distance, Y = along-strike, Z = depth (positive downward)
  const WX = 10, WY = 7;
  const strikeW = $derived((strikeKm / (domX.max - domX.min)) * WX);

  // ── Mapping functions ──────────────────────────────────────────────────────
  const nX      = x    => (x    - domX.min) / (domX.max - domX.min) * WX;
  const nStrike = z_km => z_km / strikeKm * strikeW;
  const nDepth  = y    => (y    - domY.min) / (domY.max - domY.min) * WY;

  // Inverse maps (for drag)
  const fromNX     = wx => domX.min + (wx / WX) * (domX.max - domX.min);
  const fromNDepth = wz => domY.min + (wz / WY) * (domY.max - domY.min);

  // ── Rail helpers ───────────────────────────────────────────────────────────
  function getRails(h) {
    if (h.rails && h.rails.length >= 2) return h.rails;
    const pts = h.points ?? [];
    return [
      { z: 0,        points: pts },
      { z: strikeKm, points: pts },
    ];
  }

  // ── Arc-length parameterisation ────────────────────────────────────────────
  function sampleArcLength(rawPts, nSamples) {
    if (!rawPts.length) return Array(nSamples).fill({ x: (domX.min+domX.max)/2, y: (domY.min+domY.max)/2 });
    if (rawPts.length === 1) return Array(nSamples).fill(rawPts[0]);

    const lens = [0];
    for (let i = 1; i < rawPts.length; i++) {
      const dx = rawPts[i].x - rawPts[i-1].x;
      const dy = rawPts[i].y - rawPts[i-1].y;
      lens.push(lens[i-1] + Math.sqrt(dx*dx + dy*dy));
    }
    const total = lens[lens.length - 1];
    const out = [];
    for (let s = 0; s < nSamples; s++) {
      const t = (s / (nSamples - 1)) * total;
      let i = 0;
      while (i < lens.length - 2 && lens[i+1] < t) i++;
      const seg = lens[i+1] - lens[i];
      const frac = seg > 0 ? (t - lens[i]) / seg : 0;
      out.push({
        x: rawPts[i].x + frac * (rawPts[i+1].x - rawPts[i].x),
        y: rawPts[i].y + frac * (rawPts[i+1].y - rawPts[i].y),
      });
    }
    return out;
  }

  // ── Surface geometry (arc-length grid, new coords) ─────────────────────────
  // Vertex layout: [nX(p.x), nStrike(rail.z), nDepth(p.y)]
  function buildGridGeo(rails, nSamples = 50) {
    const sr = [...rails].sort((a, b) => a.z - b.z);
    if (sr.length < 2) return null;
    const nR = sr.length;

    const grid = sr.map(rail => {
      const sampled = sampleArcLength(rail.points, nSamples);
      return sampled.map(p => [nX(p.x), nStrike(rail.z), nDepth(p.y)]);
    });

    const verts = new Float32Array(nR * nSamples * 3);
    for (let r = 0; r < nR; r++) {
      for (let x = 0; x < nSamples; x++) {
        const idx = (r * nSamples + x) * 3;
        [verts[idx], verts[idx+1], verts[idx+2]] = grid[r][x];
      }
    }

    const indices = [];
    for (let r = 0; r < nR - 1; r++) {
      for (let x = 0; x < nSamples - 1; x++) {
        const a = r * nSamples + x, b = a + 1;
        const c = (r+1) * nSamples + x, d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ── Sorted horizons ────────────────────────────────────────────────────────
  const sorted = $derived(
    [...horizons].sort((a, b) => {
      const avg = h => h.points?.length
        ? h.points.reduce((s, p) => s + p.y, 0) / h.points.length : 0;
      return avg(a) - avg(b);
    })
  );

  // ── Derived: surface meshes for all horizons ───────────────────────────────
  const surfaces = $derived.by(() => {
    return sorted.map((h, i) => {
      const rails = getRails(h);
      const geo = buildGridGeo(rails);
      return geo ? { geo, color: h.colour ?? '#c8e6c9', id: h.id, name: h.name } : null;
    }).filter(Boolean);
  });
  $effect(() => {
    const snap = surfaces;
    return () => { for (const s of snap) s.geo?.dispose(); };
  });

  // ── Manifold solid blocks ──────────────────────────────────────────────────
  let solidBlocks   = $state([]);
  let solidsBuilding = $state(false);

  $effect(() => {
    const flag = showSolids;
    const sw   = strikeW;  // reactive capture
    if (!flag) { solidBlocks = []; return; }

    solidsBuilding = true;
    buildLayerSolids({
      horizons,
      getRails,
      WX, WY,
      strikeW: sw,
      sampleArcLength,
      nX, nDepth, nStrike,
    }).then(blocks => {
      for (const b of solidBlocks) b.geo?.dispose();
      solidBlocks = blocks;
      solidsBuilding = false;
    }).catch(e => {
      console.error('[Dgeo3DScene] buildLayerSolids error', e);
      solidsBuilding = false;
    });
  });

  // ── Frame (cube outline) ───────────────────────────────────────────────────
  // X=[0,WX]  Y=[0,strikeW]  Z=[0,WY]
  const frameGeo = $derived.by(() => {
    const sw = strikeW;
    const V = (x,y,z) => new THREE.Vector3(x,y,z);
    // 8 corners
    const c = [
      V(0,0,0),   V(WX,0,0),   V(WX,sw,0),  V(0,sw,0),   // surface (z=0)
      V(0,0,WY),  V(WX,0,WY),  V(WX,sw,WY), V(0,sw,WY),  // base (z=WY)
    ];
    const ei = [[0,1],[1,2],[2,3],[3,0], [4,5],[5,6],[6,7],[7,4],
                [0,4],[1,5],[2,6],[3,7]];
    const pts = []; for (const [a,b] of ei) pts.push(c[a], c[b]);
    return new THREE.BufferGeometry().setFromPoints(pts);
  });
  $effect(() => { const g = frameGeo; return () => g?.dispose(); });

  // ── Floor grid (at Z=WY, horizontal X-Y plane) ────────────────────────────
  const gridGeo = $derived.by(() => {
    const sw = strikeW; const z = WY; const pts = [];
    for (let i = 0; i <= 5; i++) {
      const x = (i/5)*WX, y = (i/5)*sw;
      pts.push(new THREE.Vector3(x,0,z),  new THREE.Vector3(x,sw,z));
      pts.push(new THREE.Vector3(0,y,z),  new THREE.Vector3(WX,y,z));
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

  // ── Control point spheres ──────────────────────────────────────────────────
  const controlPoints = $derived(
    activeRail
      ? activeRail.points.map((p, i) => ({
          idx: i, p,
          wx: nX(p.x), wy: nStrike(activeRail.z), wz: nDepth(p.y),
        }))
      : []
  );

  // ── Rail line geos for edit horizon ───────────────────────────────────────
  const railLineGeos = $derived.by(() => {
    if (!editHorizonId) return [];
    return editRailsSorted.map((rail, ri) => {
      if (rail.points.length < 2) return null;
      const pts = rail.points;
      const geo = new THREE.BufferGeometry().setFromPoints(
        pts.map(p => new THREE.Vector3(nX(p.x), nStrike(rail.z), nDepth(p.y)))
      );
      return { geo, ri, active: ri === editRailIdx };
    }).filter(Boolean);
  });
  $effect(() => {
    const snap = railLineGeos;
    return () => { for (const l of snap) l.geo?.dispose(); };
  });

  // ── Drag handlers ──────────────────────────────────────────────────────────
  // Drag plane: XZ plane (horizontal + depth) at fixed Y = nStrike(activeRail.z)
  function startDrag(ptIdx, e) {
    e.stopPropagation();
    dragPointIdx = ptIdx;
    isDragging   = true;
  }

  function onDragMove(e) {
    if (!isDragging || dragPointIdx === null || !editHorizon || !activeRail) return;
    const newX = Math.max(domX.min, Math.min(domX.max, fromNX(e.point.x)));
    const newY = Math.max(domY.min, Math.min(domY.max, fromNDepth(e.point.z)));

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

  // ── Slice plane at active rail's Y (strike position) ──────────────────────
  const slicePlaneGeo = $derived.by(() => {
    if (!activeRail) return null;
    const ys = nStrike(activeRail.z);
    const pts = [
      new THREE.Vector3(0,  ys, 0),
      new THREE.Vector3(WX, ys, 0),
      new THREE.Vector3(WX, ys, WY),
      new THREE.Vector3(0,  ys, WY),
      new THREE.Vector3(0,  ys, 0),
    ];
    return new THREE.BufferGeometry().setFromPoints(pts);
  });
  $effect(() => { const g = slicePlaneGeo; return () => g?.dispose(); });

  const sliceFillGeo = $derived.by(() => {
    if (!activeRail) return null;
    const ys = nStrike(activeRail.z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0,ys,0, WX,ys,0, WX,ys,WY, 0,ys,WY]), 3));
    geo.setIndex([0,1,2, 0,2,3]);
    return geo;
  });
  $effect(() => { const g = sliceFillGeo; return () => g?.dispose(); });

  // ── Camera ─────────────────────────────────────────────────────────────────
  // Look at the block from above-front-right
  const camTarget = $derived([WX/2, strikeW/2, WY/2]);
  const camPos    = $derived([WX*1.8, -WY*0.5, WY*0.5]);
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
<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[14, -8, -10]} intensity={0.55} />
<T.DirectionalLight position={[-8, 8, 14]}  intensity={0.25} />

<!-- ── Manifold solid blocks ──────────────────────────────────────────────── -->
{#if showSolids}
  {#each solidBlocks as b (b.geo.uuid)}
    <T.Mesh geometry={b.geo}>
      <T.MeshPhongMaterial
        color={b.color}
        transparent opacity={0.82}
        side={THREE.DoubleSide}
        shininess={30}
      />
    </T.Mesh>
    <T.Mesh geometry={b.geo}>
      <T.MeshBasicMaterial
        color="#1e293b" wireframe transparent opacity={0.08}
      />
    </T.Mesh>
  {/each}
{/if}

<!-- ── Formation surfaces (when not in solid mode) ────────────────────────── -->
{#if !showSolids}
  {#each surfaces as s (s.geo.uuid)}
    <T.Mesh
      geometry={s.geo}
      onclick={() => { editHorizonId = s.id; editRailIdx = 0; }}
    >
      <T.MeshLambertMaterial
        color={s.color}
        transparent opacity={0.88}
        side={THREE.DoubleSide}
      />
    </T.Mesh>
  {/each}
{/if}

<!-- ── Rail lines for selected horizon ────────────────────────────────────── -->
{#each railLineGeos as l (l.geo.uuid)}
  <T is={THREE.Line} geometry={l.geo} onclick={() => (editRailIdx = l.ri)}>
    <T.LineBasicMaterial color={l.active ? '#2563eb' : '#94a3b8'} />
  </T>
{/each}

<!-- ── Control point spheres ──────────────────────────────────────────────── -->
{#each controlPoints as cp (cp.idx)}
  <T.Mesh
    position={[cp.wx, cp.wy, cp.wz]}
    onpointerdown={(e) => startDrag(cp.idx, e)}
  >
    <T.SphereGeometry args={[0.18, 10, 10]} />
    <T.MeshBasicMaterial color={dragPointIdx === cp.idx ? '#ef4444' : '#2563eb'} />
  </T.Mesh>
{/each}

<!-- ── Drag capture plane (XZ at fixed Y=strike) ─────────────────────────── -->
{#if isDragging && activeRail !== null}
  {@const ys = nStrike(activeRail.z)}
  <T.Mesh
    position={[WX/2, ys, WY/2]}
    rotation={[-Math.PI/2, 0, 0]}
    onpointermove={onDragMove}
    onpointerup={endDrag}
    onpointerleave={endDrag}
  >
    <T.PlaneGeometry args={[WX*6, WY*6]} />
    <T.MeshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
  </T.Mesh>
{/if}

<!-- ── Slice plane at active rail ─────────────────────────────────────────── -->
{#if sliceFillGeo}
  <T.Mesh geometry={sliceFillGeo}>
    <T.MeshBasicMaterial color="#3b82f6" transparent opacity={0.07}
      side={THREE.DoubleSide} depthWrite={false} />
  </T.Mesh>
{/if}
{#if slicePlaneGeo}
  <T is={THREE.Line} geometry={slicePlaneGeo}>
    <T.LineBasicMaterial color="#2563eb" transparent opacity={0.85} />
  </T>
{/if}

<!-- ── Block wireframe ─────────────────────────────────────────────────────── -->
<T is={THREE.LineSegments} geometry={frameGeo}>
  <T.LineBasicMaterial color={0x1e293b} transparent opacity={0.65} />
</T>

<!-- ── Floor grid (at depth Z=WY) ─────────────────────────────────────────── -->
<T is={THREE.LineSegments} geometry={gridGeo}>
  <T.LineBasicMaterial color={0x94a3b8} transparent opacity={0.22} />
</T>
