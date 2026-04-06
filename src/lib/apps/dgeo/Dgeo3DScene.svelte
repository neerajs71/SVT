<script>
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls, interactivity, HTML } from '@threlte/extras';
  import { onDestroy } from 'svelte';
  import { NurbsWebGpu }  from './nurbs/nurbsWebGpu.js';
  import { NurbsGpgpu }   from './nurbs/nurbsGpgpu.js';
  import { NurbsCpu }     from './nurbs/nurbsCpu.js';
  import { railsToNURBS } from './nurbs/railsToNURBS.js';
  import * as THREE from 'three';
  import { buildLayerSolids, buildNurbsLayerSolids } from './manifoldSolid.js';

  let {
    horizons          = [],
    domX,
    domY,
    strikeKm          = 5,
    defaultRailCount  = 10,
    showSolids        = false,
    showRuler         = false,
    showNurbs         = false,
    sliceY            = 0,
    editHorizonId     = $bindable(null),
    editRailIdx       = $bindable(null),
    solidErrors       = $bindable([]),
    onUpdateRails     = null,
  } = $props();

  // Evaluator chain: WebGPU → WebGL GPGPU → CPU.
  // All stored as plain (non-reactive) variables to avoid reactive loops.
  const { renderer } = useThrelte();
  const cpu = new NurbsCpu(40);
  let gpgpu = null;
  try { gpgpu = new NurbsGpgpu(renderer, 40); } catch (e) {
    console.warn('[Dgeo3DScene] WebGL NURBS unavailable, using CPU', e);
  }
  onDestroy(() => gpgpu?.dispose());

  // WebGPU — async init; webgpuReady is the only $state here so Svelte
  // knows to re-trigger the nurbsCache effect once the device is ready.
  let webgpu = null;
  let webgpuReady = $state(false);
  NurbsWebGpu.create(40)
    .then(g => { webgpu = g; webgpuReady = true; })
    .catch(e => console.warn('[Dgeo3DScene] WebGPU NURBS unavailable:', e));
  onDestroy(() => webgpu?.destroy());

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
    // No rails saved yet — generate defaultRailCount evenly-spaced rails
    const pts = h.points ?? [];
    const n   = Math.max(2, defaultRailCount);
    return Array.from({ length: n }, (_, i) => ({
      z:      (i / (n - 1)) * strikeKm,
      points: pts,
    }));
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
      // Preserve arc-length (insertion) order so folds are rendered correctly
      const sampled = sampleArcLength(rail.points, nSamples);
      // Snap first/last to exact domain walls (boundary endpoints are always at domain edge)
      if (sampled.length > 0) sampled[0].x = domX.min;
      if (sampled.length > 1) sampled[sampled.length - 1].x = domX.max;
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

  // ── Derived: surface meshes for visible horizons ───────────────────────────
  const surfaces = $derived.by(() => {
    return sorted
      .filter(h => h.visible !== false)
      .map((h, i) => {
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
      domX,
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

    // First and last array entries are the boundary endpoints — X locked to domain walls
    const leftIdx  = 0;
    const rightIdx = activeRail.points.length - 1;
    const finalX   = dragPointIdx === leftIdx  ? domX.min
                   : dragPointIdx === rightIdx ? domX.max
                   : newX;

    const newRails = editRailsSorted.map((rail, ri) => {
      if (ri !== editRailIdx) return rail;
      return {
        ...rail,
        points: rail.points.map((p, pi) =>
          pi === dragPointIdx ? { ...p, x: finalX, y: newY } : p
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

  // ── Ruler geometry ────────────────────────────────────────────────────────
  // Depth ruler: right face (X=WX, Y=0), ticks along Z.
  // Distance ruler: bottom-front edge (Y=0, Z=WY), ticks along X.
  // Strike ruler: bottom-right edge (X=WX, Z=WY), ticks along Y.
  const RULER_OFFSET = 0.55;  // gap from block face

  const rulerGeos = $derived.by(() => {
    const sw = strikeW;
    const off = RULER_OFFSET;
    const pts_d = [], pts_x = [], pts_s = [];

    // ── Depth ruler (right face, along Z) ──────────────────────────────────
    pts_d.push(new THREE.Vector3(WX + off, 0, 0),  new THREE.Vector3(WX + off, 0, WY));
    for (let i = 0; i <= 5; i++) {
      const wz = (i / 5) * WY;
      pts_d.push(new THREE.Vector3(WX + off - 0.15, 0, wz), new THREE.Vector3(WX + off + 0.15, 0, wz));
    }

    // ── Distance ruler (bottom-front, along X) ─────────────────────────────
    pts_x.push(new THREE.Vector3(0, 0, WY + off),  new THREE.Vector3(WX, 0, WY + off));
    for (let i = 0; i <= 5; i++) {
      const wx = (i / 5) * WX;
      pts_x.push(new THREE.Vector3(wx, 0, WY + off - 0.15), new THREE.Vector3(wx, 0, WY + off + 0.15));
    }

    // ── Strike ruler (right-bottom edge, along Y) ──────────────────────────
    pts_s.push(new THREE.Vector3(WX + off, 0, WY),  new THREE.Vector3(WX + off, sw, WY));
    for (let i = 0; i <= 4; i++) {
      const wy = (i / 4) * sw;
      pts_s.push(new THREE.Vector3(WX + off - 0.15, wy, WY), new THREE.Vector3(WX + off + 0.15, wy, WY));
    }

    return {
      depth:  new THREE.BufferGeometry().setFromPoints(pts_d),
      dist:   new THREE.BufferGeometry().setFromPoints(pts_x),
      strike: new THREE.BufferGeometry().setFromPoints(pts_s),
    };
  });
  $effect(() => {
    const g = rulerGeos;
    return () => { g.depth?.dispose(); g.dist?.dispose(); g.strike?.dispose(); };
  });

  // Tick label data
  const depthTicks = $derived(
    Array.from({ length: 6 }, (_, i) => {
      const t = i / 5;
      return { wz: t * WY, label: Math.round(domY.min + t * (domY.max - domY.min)) + ' m' };
    })
  );
  const distTicks = $derived(
    Array.from({ length: 6 }, (_, i) => {
      const t = i / 5;
      return { wx: t * WX, label: (domX.min + t * (domX.max - domX.min)).toFixed(1) + ' km' };
    })
  );
  const strikeTicks = $derived(
    Array.from({ length: 5 }, (_, i) => {
      const t = i / 4;
      return { wy: t * strikeW, label: (t * strikeKm).toFixed(1) + ' km' };
    })
  );

  // ── NURBS overlay — WebGPU > WebGL > CPU ─────────────────────────────────
  // $effect with async body so we can await WebGPU evaluation.
  // webgpuReady ($state) is the only reactive trigger for GPU upgrades;
  // sorted and showNurbs are the main content triggers.
  let nurbsCache = $state(/** @type {Array<{geo,positions,resolution,color}>} */ ([]));

  $effect(() => {
    if (!showNurbs) {
      // Don't read nurbsCache here — the disposal $effect handles geometry cleanup.
      // Reading it would create a dependency that causes an infinite loop.
      nurbsCache = [];
      return;
    }
    // Capture reactive deps synchronously before entering async context
    const snap     = sorted;
    const _wgReady = webgpuReady;   // subscribe so we re-run when GPU is ready
    let cancelled  = false;

    (async () => {
      const next = await Promise.all(snap.map(async h => {
        if (h.visible === false) return null;
        const rails = getRails(h);
        if (rails.length < 2) return null;
        // Use actual point count so folds are captured; clamp to [8, 36]
        // (36 + degree 3 + 1 = 40 knots, matching MAX_KNOT in GLSL shader)
        const maxPts = Math.max(...rails.map(r => r.points?.length ?? 0));
        const nCtrlU = Math.min(36, Math.max(8, maxPts));
        const params = railsToNURBS(rails, { sampleArcLength, nX, nDepth, nStrike, domX, nCtrlU });
        if (!params) return null;
        // Priority: WebGPU (async) → WebGL GPGPU (sync) → CPU (sync)
        for (const ev of [webgpu, gpgpu, cpu]) {
          if (!ev) continue;
          try {
            const r = await Promise.resolve(ev.evaluate(params));
            if (cancelled) return null;   // showNurbs toggled off while evaluating
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(r.positions.slice(), 3));
            geo.setIndex(new THREE.BufferAttribute(new Uint32Array(r.indices), 1));
            geo.computeVertexNormals();
            return { geo, positions: r.positions, resolution: r.resolution, color: h.colour ?? '#c8e6c9', id: h.id };
          } catch (e) {
            console.warn('[Dgeo3DScene] NURBS eval failed on', ev.constructor?.name, 'for', h.name, e);
          }
        }
        return null;
      }));
      if (!cancelled) nurbsCache = next.filter(Boolean);
    })();

    // Signal async work to bail out if the effect re-runs before it completes
    return () => { cancelled = true; };
  });

  // Dispose geometries when component unmounts
  $effect(() => {
    const snap = nurbsCache;
    return () => { for (const d of snap) d?.geo?.dispose(); };
  });

  // ── NURBS-based manifold solids with CSG ──────────────────────────────────
  // Built from the GPU-evaluated NURBS positions whenever the nurbsCache or
  // showSolids changes.  Sorting and CSG mirrors buildLayerSolids (deepest first,
  // Layer[i] = solid[i].subtract(solid[i-1])).
  let nurbsSolidBlocks    = $state(/** @type {Array<{geo,color,id}>} */ ([]));
  let nurbsSolidsBuilding = $state(false);
  let nurbsSolidErrors    = $state(/** @type {string[]} */ ([]));

  $effect(() => {
    const entries  = nurbsCache;
    const doSolids = showSolids;
    if (!doSolids || entries.length === 0) {
      nurbsSolidBlocks  = [];
      nurbsSolidErrors  = [];
      return;
    }
    let cancelled = false;
    nurbsSolidsBuilding = true;
    buildNurbsLayerSolids(entries, { WX, WY, strikeW }).then(({ blocks, errors }) => {
      if (!cancelled) {
        for (const b of nurbsSolidBlocks) b.geo?.dispose();
        nurbsSolidBlocks    = blocks;
        nurbsSolidErrors    = errors;
        solidErrors         = errors;
        nurbsSolidsBuilding = false;
        if (errors.length) console.warn('[manifoldSolid]', errors.join(' | '));
      }
    }).catch(e => {
      if (!cancelled) {
        nurbsSolidErrors    = [`Fatal: ${e?.message ?? e}`];
        nurbsSolidsBuilding = false;
        console.error('[Dgeo3DScene] buildNurbsLayerSolids error', e);
      }
    });
    return () => { cancelled = true; };
  });
  $effect(() => {
    const snap = nurbsSolidBlocks;
    return () => { for (const b of snap) b.geo?.dispose(); };
  });

  // Slice intersection curves — CPU extract from cached vertex grid
  const sliceCurves = $derived.by(() => {
    if (!showNurbs || !nurbsCache.length) return [];
    return nurbsCache.map(nd => {
      const { positions, resolution, color } = nd;
      const W      = resolution + 1;
      const sw     = strikeW;
      const vFrac  = sw > 0 ? Math.max(0, Math.min(1, sliceY / sw)) : 0;
      const rFloat = vFrac * resolution;
      const r0     = Math.min(resolution - 1, Math.floor(rFloat));
      const r1     = r0 + 1;
      const t      = rFloat - r0;

      const pts = new Float32Array(W * 3);
      for (let c = 0; c < W; c++) {
        const i0 = (r0 * W + c) * 3, i1 = (r1 * W + c) * 3;
        pts[c * 3]     = positions[i0]     + t * (positions[i1]     - positions[i0]);
        pts[c * 3 + 1] = positions[i0 + 1] + t * (positions[i1 + 1] - positions[i0 + 1]);
        pts[c * 3 + 2] = positions[i0 + 2] + t * (positions[i1 + 2] - positions[i0 + 2]);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      return { geo, color };
    });
  });
  $effect(() => {
    const snap = sliceCurves;
    return () => { for (const c of snap) c?.geo?.dispose(); };
  });

  // ── Camera ─────────────────────────────────────────────────────────────────
  // Coordinate system: X=horizontal, Y=strike, Z=depth (0=surface, WY=deepest).
  // "Up" in geological terms = -Z direction.
  // Setting camera.up = [0,0,-1] makes OrbitControls rotate around the Z-axis
  // (depth axis), so azimuth drag spins horizontally around the block — correct.
  // Polar limits prevent flipping below the block.
  const camTarget = $derived([WX/2, strikeW/2, WY/2]);
  // Position: right of centre (+X), in front (-Y), above the surface (-Z)
  const camPos    = $derived([WX * 1.3, strikeW/2 - WY * 0.7, -WY * 0.55]);
</script>

<!-- Camera: up=[0,0,-1] so depth-axis (Z) is the orbit pivot -->
<T.PerspectiveCamera makeDefault fov={50} near={0.01} far={500}
  position={camPos} up={[0, 0, -1]}>
  <OrbitControls
    target={camTarget}
    enableDamping
    dampingFactor={0.07}
    enabled={!isDragging}
    minPolarAngle={0.05}
    maxPolarAngle={Math.PI * 0.72}
    minDistance={1}
    maxDistance={120}
  />
</T.PerspectiveCamera>

<!-- Lights -->
<T.AmbientLight intensity={0.6} />
<T.DirectionalLight position={[14, -8, -10]} intensity={0.55} />
<T.DirectionalLight position={[-8, 8, 14]}  intensity={0.25} />

<!-- ── Manifold solid blocks ──────────────────────────────────────────────── -->
{#if showSolids}
  {#each solidBlocks as b (b.geo.uuid)}
    {@const hz = horizons.find(h => h.id === b.id)}
    {#if hz?.visible !== false}
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
    {/if}
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

<!-- ── Rulers ─────────────────────────────────────────────────────────────── -->
{#if showRuler}
  {@const off = RULER_OFFSET}

  <!-- Depth ruler lines (right face) -->
  <T is={THREE.LineSegments} geometry={rulerGeos.depth}>
    <T.LineBasicMaterial color="#374151" />
  </T>
  <!-- Depth labels -->
  {#each depthTicks as tick (tick.wz)}
    <HTML position={[WX + off + 0.25, 0, tick.wz]} center={false}>
      <span style="font-size:9px; font-family:monospace; color:#1e293b; white-space:nowrap; pointer-events:none; text-shadow:0 0 3px #fff,0 0 3px #fff">
        {tick.label}
      </span>
    </HTML>
  {/each}

  <!-- Distance ruler lines (front-bottom) -->
  <T is={THREE.LineSegments} geometry={rulerGeos.dist}>
    <T.LineBasicMaterial color="#374151" />
  </T>
  <!-- Distance labels -->
  {#each distTicks as tick (tick.wx)}
    <HTML position={[tick.wx, 0, WY + off + 0.25]} center>
      <span style="font-size:9px; font-family:monospace; color:#1e293b; white-space:nowrap; pointer-events:none; text-shadow:0 0 3px #fff,0 0 3px #fff">
        {tick.label}
      </span>
    </HTML>
  {/each}

  <!-- Strike ruler lines (right-bottom edge) -->
  <T is={THREE.LineSegments} geometry={rulerGeos.strike}>
    <T.LineBasicMaterial color="#374151" />
  </T>
  <!-- Strike labels -->
  {#each strikeTicks as tick (tick.wy)}
    <HTML position={[WX + off + 0.25, tick.wy, WY]} center={false}>
      <span style="font-size:9px; font-family:monospace; color:#1e293b; white-space:nowrap; pointer-events:none; text-shadow:0 0 3px #fff,0 0 3px #fff">
        {tick.label}
      </span>
    </HTML>
  {/each}
{/if}

<!-- ── NURBS surfaces — displayed to the right of the cube for clarity ──── -->
{#if showNurbs}
  <!-- Offset the NURBS group so it sits beside the cube (not overlapping) -->
  <T.Group position={[WX + 1.5, 0, 0]}>

    <!-- NURBS solid blocks (CSG layers) — shown when Solidify is on -->
    {#if showSolids && nurbsSolidBlocks.length > 0}
      {#each nurbsSolidBlocks as b (b.geo.uuid)}
        <T.Mesh geometry={b.geo}>
          <T.MeshPhongMaterial
            color={b.color} transparent opacity={0.82}
            side={THREE.DoubleSide} shininess={30}
          />
        </T.Mesh>
        <T.Mesh geometry={b.geo}>
          <T.MeshBasicMaterial color="#1e293b" wireframe transparent opacity={0.08} />
        </T.Mesh>
      {/each}
    {:else}
      <!-- Fallback: show raw NURBS surfaces while solids are building or Solidify is off -->
      {#each nurbsCache as nd (nd.geo.uuid)}
        <T.Mesh geometry={nd.geo}>
          <T.MeshLambertMaterial
            color={nd.color} transparent opacity={0.75}
            side={THREE.DoubleSide}
          />
        </T.Mesh>
        <T.Mesh geometry={nd.geo}>
          <T.MeshBasicMaterial color={nd.color} wireframe transparent opacity={0.25} />
        </T.Mesh>
      {/each}
    {/if}

    <!-- Slice intersection curves -->
    {#each sliceCurves as sc (sc.geo.uuid)}
      <T is={THREE.Line} geometry={sc.geo}>
        <T.LineBasicMaterial color={sc.color} />
      </T>
    {/each}

    <!-- Slice plane -->
    {@const ys = Math.max(0, Math.min(strikeW, sliceY))}
    <T.Mesh position={[WX/2, ys, WY/2]} rotation={[Math.PI/2, 0, 0]}>
      <T.PlaneGeometry args={[WX, WY]} />
      <T.MeshBasicMaterial
        color="#a855f7" transparent opacity={0.07}
        side={THREE.DoubleSide} depthWrite={false}
      />
    </T.Mesh>

    <!-- Wireframe outline box for the NURBS panel -->
    <T is={THREE.LineSegments} geometry={frameGeo}>
      <T.LineBasicMaterial color={0x94a3b8} transparent opacity={0.35} />
    </T>
  </T.Group>
{/if}
