<script>
  import { onMount } from 'svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { saveToHandle, downloadBlob } from '$lib/apps/shared/fileActions.js';
  import Dgeo3DView from './Dgeo3DView.svelte';
  import { FloatingPanel } from '$lib/components/FloatingPanel';

  const { tab } = $props();

  // ── View mode ──────────────────────────────────────────────────────────────
  let viewMode      = $state('2d');    // '2d' | '3d'
  let showSolids    = $state(false);   // manifold solid blocks in 3D view
  let showHzPanel   = $state(false);   // horizons floating panel

  // ── Colour palette for formations ─────────────────────────────────────────
  const FORMATION_COLOURS = [
    '#c8e6c9','#fff9c4','#ffe0b2','#f8bbd0','#e1bee7',
    '#b3e5fc','#dcedc8','#fff8e1','#fce4ec','#e8eaf6',
    '#f3e5f5','#e0f2f1','#fbe9e7','#ede7f6','#e8f5e9',
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  let horizons = $state([]);      // [{ id, name, colour, operator, points: [{x,y}] }]
  let dirty    = $state(false);
  let loadErr  = $state('');
  let saveErr  = $state('');

  $effect(() => { tabStore.setDirty(tab.id, dirty); });

  // Tool: 'select' | 'add-point' | 'delete'
  let tool        = $state('select');
  let activeId    = $state(null);   // selected horizon id
  let dragState   = $state(null);   // { horizonId, pointIdx, startX, startY }

  // Viewport
  const W = 900, H = 600, PAD = 60;
  const CHART_W = $derived(W - PAD);
  const CHART_H = $derived(H - PAD);

  // Domain: 0–10 km horizontal, 0–5000 m depth
  let domX  = $state({ min: 0, max: 10 });
  let domY  = $state({ min: 0, max: 5000 });

  function toSvgX(v) { return PAD + ((v - domX.min) / (domX.max - domX.min)) * CHART_W; }
  function toSvgY(v) { return PAD/2 + ((v - domY.min) / (domY.max - domY.min)) * CHART_H; }
  function fromSvgX(px) { return domX.min + ((px - PAD) / CHART_W) * (domX.max - domX.min); }
  function fromSvgY(py) { return domY.min + ((py - PAD/2) / CHART_H) * (domY.max - domY.min); }

  // Sorted horizon list (shallowest avg depth first)
  const sortedHorizons = $derived(
    [...horizons].sort((a, b) => avgDepth(a) - avgDepth(b))
  );

  function avgDepth(h) {
    if (!h.points.length) return 0;
    return h.points.reduce((s, p) => s + p.y, 0) / h.points.length;
  }

  // Build SVG polyline string for a horizon
  function polyStr(h) {
    if (!h.points.length) return '';
    const sorted = [...h.points].sort((a, b) => a.x - b.x);
    return sorted.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).join(' ');
  }

  // Build filled band polygon between two consecutive horizons
  function bandPath(upper, lower) {
    const uPts = [...upper.points].sort((a, b) => a.x - b.x);
    const lPts = [...lower.points].sort((a, b) => a.x - b.x);
    if (!uPts.length || !lPts.length) return '';

    const xMin = PAD, xMax = PAD + CHART_W;
    // Top edge: left cap → upper horizon points → right cap
    const top = [
      `${xMin},${toSvgY(uPts[0].y).toFixed(1)}`,
      ...uPts.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`),
      `${xMax},${toSvgY(uPts[uPts.length - 1].y).toFixed(1)}`,
    ];
    // Bottom edge: right cap → lower horizon reversed → left cap
    const bot = [
      `${xMax},${toSvgY(lPts[lPts.length - 1].y).toFixed(1)}`,
      ...[...lPts].reverse().map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`),
      `${xMin},${toSvgY(lPts[0].y).toFixed(1)}`,
    ];
    return [...top, ...bot].join(' ');
  }

  // ── File I/O ──────────────────────────────────────────────────────────────
  async function loadFile() {
    try {
      if (!tab.file) { loadErr = 'No file attached to tab.'; return; }
      const text = await tab.file.text();
      if (!text.trim()) { initDefault(); return; }
      const data = JSON.parse(text);
      horizons = (data.horizons ?? []).map(h => ({
        id:       h.id ?? crypto.randomUUID(),
        name:     h.name ?? 'Horizon',
        colour:   h.colour ?? FORMATION_COLOURS[0],
        operator: h.operator ?? 'none',
        points:   h.points ?? [],
        rails:    h.rails  ?? null,
      }));
      if (data.domain) {
        domX = data.domain.x ?? domX;
        domY = data.domain.y ?? domY;
      }
      dirty = false;
    } catch (e) {
      loadErr = `Parse error: ${e.message}`;
      initDefault();
    }
  }

  function initDefault() {
    const mid = (domX.min + domX.max) / 2;
    const xL  = domX.min + (domX.max - domX.min) * 0.05;
    const xR  = domX.max - (domX.max - domX.min) * 0.05;
    horizons = [
      { id: crypto.randomUUID(), name: 'Seabed',        colour: FORMATION_COLOURS[0], operator: 'none',
        points: [{ x: xL, y: 200 }, { x: mid, y: 220 }, { x: xR, y: 210 }] },
      { id: crypto.randomUUID(), name: 'Top Sand A',    colour: FORMATION_COLOURS[1], operator: 'none',
        points: [{ x: xL, y: 800 }, { x: mid, y: 900 }, { x: xR, y: 850 }] },
      { id: crypto.randomUUID(), name: 'Top Shale B',   colour: FORMATION_COLOURS[2], operator: 'none',
        points: [{ x: xL, y: 1600 }, { x: mid, y: 1700 }, { x: xR, y: 1650 }] },
      { id: crypto.randomUUID(), name: 'Top Reservoir', colour: FORMATION_COLOURS[3], operator: 'none',
        points: [{ x: xL, y: 2400 }, { x: mid, y: 2500 }, { x: xR, y: 2450 }] },
    ];
    dirty = false;
  }

  function toJSON() {
    return JSON.stringify({
      version: '1.0',
      domain:  { x: domX, y: domY },
      horizons: horizons.map(h => ({
        id: h.id, name: h.name, colour: h.colour,
        operator: h.operator ?? 'none',
        points: h.points,
        ...(h.rails ? { rails: h.rails } : {}),
      })),
    }, null, 2);
  }

  // ── Rail editing callback (from 3D view) ───────────────────────────────────
  function onUpdateRails(horizonId, newRails) {
    horizons = horizons.map(h =>
      h.id === horizonId ? { ...h, rails: newRails } : h
    );
    dirty = true;
  }

  async function saveFile() {
    const json = toJSON();
    if (tab.handle) {
      try {
        await saveToHandle(tab.handle, json);
        dirty = false;
      } catch (e) {
        saveErr = e.message;
      }
    } else {
      downloadBlob(tab.name || 'geology.dgeo', json, 'application/json');
      dirty = false;
    }
  }

  function downloadFile() {
    downloadBlob(tab.name || 'geology.dgeo', toJSON(), 'application/json');
    dirty = false;
  }

  onMount(() => { loadFile(); });

  // ── Horizon management ────────────────────────────────────────────────────
  function addHorizon() {
    const idx = horizons.length;
    const depth = domY.min + (domY.max - domY.min) * ((idx + 1) / (horizons.length + 2));
    const xL  = domX.min + (domX.max - domX.min) * 0.05;
    const xR  = domX.max - (domX.max - domX.min) * 0.05;
    const xMid = (domX.min + domX.max) / 2;
    const h = {
      id:     crypto.randomUUID(),
      name:     `Horizon ${idx + 1}`,
      colour:   FORMATION_COLOURS[idx % FORMATION_COLOURS.length],
      operator: 'none',
      points:   [{ x: xL, y: depth }, { x: xMid, y: depth + 50 }, { x: xR, y: depth }],
    };
    horizons = [...horizons, h];
    activeId = h.id;
    tool = 'add-point';
    dirty = true;
  }

  function deleteHorizon(id) {
    horizons = horizons.filter(h => h.id !== id);
    if (activeId === id) activeId = null;
    dirty = true;
  }

  function renameHorizon(id, name) {
    horizons = horizons.map(h => h.id === id ? { ...h, name } : h);
    dirty = true;
  }

  function recolourHorizon(id, colour) {
    horizons = horizons.map(h => h.id === id ? { ...h, colour } : h);
    dirty = true;
  }

  function setOperator(id, op) {
    horizons = horizons.map(h => h.id === id ? { ...h, operator: op } : h);
    dirty = true;
  }

  function moveHorizon(id, dir) {
    const idx = horizons.findIndex(h => h.id === id);
    if (idx < 0) return;
    if (dir === 'up'   && idx === 0) return;
    if (dir === 'down' && idx === horizons.length - 1) return;
    const arr = [...horizons];
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    horizons = arr;
    dirty = true;
  }

  // Shift all points of a horizon so its average depth becomes newZ
  function adjustDepth(id, newZ) {
    const h = horizons.find(h => h.id === id);
    if (!h || !h.points.length) return;
    const curZ = h.points.reduce((s, p) => s + p.y, 0) / h.points.length;
    const delta = newZ - curZ;
    horizons = horizons.map(hz =>
      hz.id === id
        ? { ...hz, points: hz.points.map(p => ({ ...p, y: Math.max(domY.min, Math.min(domY.max, p.y + delta)) })) }
        : hz
    );
    dirty = true;
  }

  // Returns stroke attributes for a horizon line based on its operator
  function horizonStroke(h) {
    const op = h.operator ?? 'none';
    if (op === 'RA' || op === 'RAI') return { dasharray: '8 4', width: 2 };
    if (op === 'RB' || op === 'RBI') return { dasharray: 'none', width: 3.5 };
    return { dasharray: 'none', width: 2 };
  }

  // ── SVG interaction ───────────────────────────────────────────────────────
  let svgRef = $state(null);
  let editingName = $state(null);  // horizon id being renamed inline

  function svgCoords(e) {
    const rect = svgRef.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    return {
      x: fromSvgX((e.clientX - rect.left) * scaleX),
      y: fromSvgY((e.clientY - rect.top)  * scaleY),
    };
  }

  function onSvgClick(e) {
    if (tool !== 'add-point' || !activeId) return;
    const { x, y } = svgCoords(e);
    // Clamp to domain
    const cx = Math.max(domX.min, Math.min(domX.max, x));
    const cy = Math.max(domY.min, Math.min(domY.max, y));
    horizons = horizons.map(h =>
      h.id === activeId ? { ...h, points: [...h.points, { x: cx, y: cy }] } : h
    );
    dirty = true;
  }

  function onPointMouseDown(e, horizonId, pointIdx) {
    if (tool !== 'select') return;
    e.stopPropagation();
    activeId = horizonId;
    dragState = { horizonId, pointIdx };
  }

  function onPointClick(e, horizonId, pointIdx) {
    if (tool !== 'delete') return;
    e.stopPropagation();
    horizons = horizons.map(h => {
      if (h.id !== horizonId) return h;
      return { ...h, points: h.points.filter((_, i) => i !== pointIdx) };
    });
    dirty = true;
  }

  function onSvgMouseMove(e) {
    if (!dragState) return;
    const { x, y } = svgCoords(e);
    const cx = Math.max(domX.min, Math.min(domX.max, x));
    const cy = Math.max(domY.min, Math.min(domY.max, y));
    horizons = horizons.map(h => {
      if (h.id !== dragState.horizonId) return h;
      const pts = h.points.map((p, i) =>
        i === dragState.pointIdx ? { x: cx, y: cy } : p
      );
      return { ...h, points: pts };
    });
    dirty = true;
  }

  function onSvgMouseUp() { dragState = null; }

  // X-axis ticks (km)
  const xTicks = $derived(
    Array.from({ length: 6 }, (_, i) => {
      const v = domX.min + (i / 5) * (domX.max - domX.min);
      return { v, sx: toSvgX(v) };
    })
  );

  // Y-axis ticks (depth)
  const yTicks = $derived(
    Array.from({ length: 6 }, (_, i) => {
      const v = domY.min + (i / 5) * (domY.max - domY.min);
      return { v, sy: toSvgY(v) };
    })
  );

  const activeHorizon = $derived(horizons.find(h => h.id === activeId));

  // Cursor per tool
  const cursor = $derived(
    tool === 'add-point' ? 'crosshair' :
    tool === 'delete'    ? 'not-allowed' : 'default'
  );
</script>

<div class="flex h-full overflow-hidden bg-white text-sm">

  <!-- ── Narrow icon toolbar (TplApp pattern) ─────────────────────────────── -->
  <div class="tb-dgeo">

    <!-- Save -->
    <div class="tb-item group">
      <button class="tb-btn" class:tb-active={dirty} onclick={saveFile} aria-label="Save">
        {#if dirty}<span class="dirty-dot"></span>{/if}
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1.5"/>
          <rect x="5" y="2" width="6" height="4" rx="0.5" fill="currentColor" stroke="none"/>
          <rect x="4.5" y="9" width="7" height="5" rx="0.75"/>
        </svg>
      </button>
      <span class="tb-tip">{tab.handle ? 'Save to disk' : 'Download'}</span>
    </div>

    <!-- Download copy -->
    <div class="tb-item group">
      <button class="tb-btn" onclick={downloadFile} aria-label="Download copy">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 14h10M8 2v8M5 7l3 4 3-4"/>
        </svg>
      </button>
      <span class="tb-tip">Download copy</span>
    </div>

    <div class="tb-sep"></div>

    <!-- 2D view -->
    <div class="tb-item group">
      <button class="tb-btn" class:tb-active={viewMode==='2d'} onclick={() => viewMode='2d'} aria-label="2D cross-section">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="12" height="10" rx="1"/>
          <path d="M2 7 q3-2 6 0 q3 2 6 0" stroke-dasharray="2 1.2"/>
          <path d="M2 10.5 q3-1.5 6 0 q3 1.5 6 0" stroke-dasharray="2 1.2"/>
        </svg>
      </button>
      <span class="tb-tip">2D Cross-section</span>
    </div>

    <!-- 3D view -->
    <div class="tb-item group">
      <button class="tb-btn" class:tb-active={viewMode==='3d'} onclick={() => viewMode='3d'} aria-label="3D block view">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8 2 L14 5.5 V11 L8 14.5 L2 11 V5.5 Z"/>
          <path d="M8 2 V8.5 M2 5.5 L8 8.5 L14 5.5"/>
        </svg>
      </button>
      <span class="tb-tip">3D Block view</span>
    </div>

    <!-- Solidify (3D mode only) -->
    {#if viewMode === '3d'}
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showSolids}
          onclick={() => (showSolids = !showSolids)} aria-label="Toggle solid blocks">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1 L14 4.5 V11.5 L8 15 L2 11.5 V4.5 Z"
              fill={showSolids ? 'currentColor' : 'none'}
              stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 1 L8 8 M2 4.5 L8 8 L14 4.5"
              fill="none" stroke={showSolids ? 'white' : 'currentColor'} stroke-width="1.2"/>
          </svg>
        </button>
        <span class="tb-tip">{showSolids ? 'Hide solids' : 'Solidify surfaces'}</span>
      </div>
    {/if}

    <div class="tb-sep"></div>

    <!-- Tools (2D mode only) -->
    {#if viewMode === '2d'}
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={tool==='select'}
          onclick={() => tool='select'} aria-label="Select / Move">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 2 L3 12 L6 9 L8 14 L10 13 L8 8 L12 8 Z" fill="currentColor" stroke="none" opacity="0.7"/>
          </svg>
        </button>
        <span class="tb-tip">Select / Move</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={tool==='add-point'}
          onclick={() => tool='add-point'} aria-label="Add point">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="5.5"/>
            <line x1="8" y1="5" x2="8" y2="11"/><line x1="5" y1="8" x2="11" y2="8"/>
          </svg>
        </button>
        <span class="tb-tip">Add point</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={tool==='delete'}
          onclick={() => tool='delete'} aria-label="Delete point">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="5.5"/>
            <line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>
          </svg>
        </button>
        <span class="tb-tip">Delete point</span>
      </div>

      <div class="tb-sep"></div>
    {/if}

    <!-- Horizons panel -->
    <div class="tb-item group">
      <button class="tb-btn" class:tb-active={showHzPanel}
        onclick={() => (showHzPanel = !showHzPanel)} aria-label="Horizons table">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="1.5" y="2" width="13" height="12" rx="1.2"/>
          <line x1="1.5" y1="5.5" x2="14.5" y2="5.5"/>
          <line x1="1.5" y1="9"   x2="14.5" y2="9"/>
          <line x1="5"   y1="2"   x2="5"    y2="14"/>
        </svg>
      </button>
      <span class="tb-tip">Horizons table</span>
    </div>

    <!-- Add horizon -->
    <div class="tb-item group">
      <button class="tb-btn" onclick={addHorizon} aria-label="Add horizon">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 10 q3-2.5 6 0 q3 2.5 6 0"/>
          <path d="M2 6 q3-2.5 6 0 q3 2.5 6 0" opacity="0.4"/>
          <line x1="8" y1="1" x2="8" y2="4"/><line x1="6.5" y1="2.5" x2="9.5" y2="2.5"/>
        </svg>
      </button>
      <span class="tb-tip">Add horizon</span>
    </div>

    <!-- Reset -->
    <div class="tb-item group">
      <button class="tb-btn" onclick={initDefault} aria-label="Reset to default">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 8 A5 5 0 1 1 5.5 12.5"/>
          <polyline points="2,6 3,9 6,8"/>
        </svg>
      </button>
      <span class="tb-tip">Reset to default</span>
    </div>

    <!-- Error indicator -->
    {#if loadErr || saveErr}
      <div class="tb-item group mt-auto">
        <button class="tb-btn" style="color:#ef4444"
          onclick={() => { loadErr=''; saveErr=''; }}
          aria-label="Clear errors">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M8 2 L14.5 13.5 H1.5 Z"/>
            <line x1="8" y1="6.5" x2="8" y2="9.5"/><circle cx="8" cy="11.5" r="0.6" fill="currentColor"/>
          </svg>
        </button>
        <span class="tb-tip">{loadErr || saveErr} — click to clear</span>
      </div>
    {/if}

  </div><!-- /toolbar -->

  <!-- ── Main canvas area ────────────────────────────────────────────────── -->
  <div class="flex-1 overflow-hidden flex flex-col min-h-0">

    <!-- ── 3D block view ────────────────────────────────────────────────────── -->
    {#if viewMode === '3d'}
      <div class="flex-1 overflow-hidden min-h-0">
        <Dgeo3DView
          horizons={horizons}
          domX={domX}
          domY={domY}
          {onUpdateRails}
          bind:showSolids
        />
      </div>

    {:else}
    <!-- ── 2D SVG canvas ───────────────────────────────────────────────────── -->

      <!-- Compact domain bar -->
      <div class="flex items-center gap-2 px-3 py-1 border-b border-gray-100 bg-white text-[10px] text-gray-500 flex-shrink-0 flex-wrap">
        <span class="font-medium text-gray-600">Domain</span>
        <span>X:</span>
        <input type="number" class="w-12 border border-gray-200 rounded px-1 py-0 text-[10px]" value={domX.min}
          onchange={e => { domX = { ...domX, min: +e.target.value }; }}/>
        <span>–</span>
        <input type="number" class="w-12 border border-gray-200 rounded px-1 py-0 text-[10px]" value={domX.max}
          onchange={e => { domX = { ...domX, max: +e.target.value }; }}/>
        <span class="text-gray-400">km</span>
        <span class="ml-2">Depth:</span>
        <input type="number" class="w-14 border border-gray-200 rounded px-1 py-0 text-[10px]" value={domY.min}
          onchange={e => { domY = { ...domY, min: +e.target.value }; }}/>
        <span>–</span>
        <input type="number" class="w-14 border border-gray-200 rounded px-1 py-0 text-[10px]" value={domY.max}
          onchange={e => { domY = { ...domY, max: +e.target.value }; }}/>
        <span class="text-gray-400">m</span>
      </div>

      <div class="flex-1 overflow-auto p-2">
        <svg
          bind:this={svgRef}
          width={W} height={H}
          viewBox="0 0 {W} {H}"
          style="display:block; font-family:sans-serif; cursor:{cursor}; max-width:100%; height:auto;"
          onclick={onSvgClick}
          onmousemove={onSvgMouseMove}
          onmouseup={onSvgMouseUp}>

          <!-- Background -->
          <rect x={PAD} y={PAD/2} width={CHART_W} height={CHART_H} fill="#f0f4ff" stroke="#d1d5db" stroke-width="1"/>

          <!-- Formation bands (between consecutive depth-sorted horizons for 2D display) -->
          {#each sortedHorizons as h, i (h.id)}
            {#if i < sortedHorizons.length - 1}
              {@const nextH = sortedHorizons[i + 1]}
              <polygon
                points={bandPath(h, nextH)}
                fill={nextH.colour}
                opacity="0.7"/>
            {/if}
          {/each}

          <!-- Top fill (surface to first horizon) -->
          {#if sortedHorizons.length > 0}
            {@const first = sortedHorizons[0]}
            {@const pts = [...first.points].sort((a, b) => a.x - b.x)}
            <polygon
              points={[
                `${PAD},${PAD/2}`,
                `${PAD + CHART_W},${PAD/2}`,
                `${PAD + CHART_W},${toSvgY(pts[pts.length-1].y).toFixed(1)}`,
                ...pts.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).reverse(),
                `${PAD},${toSvgY(pts[0].y).toFixed(1)}`,
              ].join(' ')}
              fill={sortedHorizons[0].colour}
              opacity="0.4"/>
          {/if}

          <!-- Bottom fill (last horizon to bottom) -->
          {#if sortedHorizons.length > 0}
            {@const last = sortedHorizons[sortedHorizons.length - 1]}
            {@const pts = [...last.points].sort((a, b) => a.x - b.x)}
            <polygon
              points={[
                `${PAD},${toSvgY(pts[0].y).toFixed(1)}`,
                ...pts.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`),
                `${PAD + CHART_W},${toSvgY(pts[pts.length-1].y).toFixed(1)}`,
                `${PAD + CHART_W},${PAD/2 + CHART_H}`,
                `${PAD},${PAD/2 + CHART_H}`,
              ].join(' ')}
              fill={FORMATION_COLOURS[(sortedHorizons.length) % FORMATION_COLOURS.length]}
              opacity="0.5"/>
          {/if}

          <!-- Grid lines -->
          {#each xTicks as t}
            <line x1={t.sx} y1={PAD/2} x2={t.sx} y2={PAD/2 + CHART_H} stroke="#c7d2fe" stroke-width="0.5" stroke-dasharray="4,4"/>
          {/each}
          {#each yTicks as t}
            <line x1={PAD} y1={t.sy} x2={PAD + CHART_W} y2={t.sy} stroke="#c7d2fe" stroke-width="0.5" stroke-dasharray="4,4"/>
          {/each}

          <!-- Horizon lines + points -->
          {#each horizons as h (h.id)}
            {@const sorted = [...h.points].sort((a, b) => a.x - b.x)}
            {@const isActive = activeId === h.id}
            {@const stroke = horizonStroke(h)}

            {#if sorted.length >= 2}
              <polyline
                points={polyStr(h)}
                fill="none"
                stroke={h.colour}
                stroke-width={isActive ? stroke.width + 1 : stroke.width}
                stroke-dasharray={stroke.dasharray}
                stroke-linejoin="round"
                stroke-linecap="round"
                style="filter: {isActive ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' : 'none'}"/>
              <polyline
                points={polyStr(h)}
                fill="none"
                stroke="#374151"
                stroke-width={isActive ? 1.5 : 0.5}
                stroke-dasharray={stroke.dasharray}
                opacity="0.5"
                stroke-linejoin="round"
                stroke-linecap="round"/>
            {/if}

            {#if sorted.length > 0}
              {@const lastPt = sorted[sorted.length - 1]}
              <text
                x={toSvgX(lastPt.x) + 5}
                y={toSvgY(lastPt.y) + 4}
                font-size="10"
                font-weight={isActive ? 'bold' : 'normal'}
                fill={isActive ? '#1d4ed8' : '#374151'}>
                {h.name}
              </text>
            {/if}

            {#each h.points as pt, i}
              <circle
                cx={toSvgX(pt.x)}
                cy={toSvgY(pt.y)}
                r={isActive ? 6 : 4}
                fill={isActive ? 'white' : h.colour}
                stroke={isActive ? h.colour : '#374151'}
                stroke-width={isActive ? 2 : 0.5}
                style="cursor:{tool === 'select' ? 'grab' : tool === 'delete' ? 'not-allowed' : 'crosshair'}"
                onmousedown={e => onPointMouseDown(e, h.id, i)}
                onclick={e => onPointClick(e, h.id, i)}/>
            {/each}
          {/each}

          <!-- X-axis -->
          {#each xTicks as t}
            <line x1={t.sx} y1={PAD/2 + CHART_H} x2={t.sx} y2={PAD/2 + CHART_H + 4} stroke="#6b7280" stroke-width="1"/>
            <text x={t.sx} y={PAD/2 + CHART_H + 14} text-anchor="middle" font-size="9" fill="#6b7280">{t.v.toFixed(1)}</text>
          {/each}
          <text x={PAD + CHART_W / 2} y={H - 4} text-anchor="middle" font-size="10" fill="#6b7280">Distance (km)</text>

          <!-- Y-axis (depth) -->
          {#each yTicks as t}
            <line x1={PAD - 4} y1={t.sy} x2={PAD} y2={t.sy} stroke="#6b7280" stroke-width="1"/>
            <text x={PAD - 7} y={t.sy + 3} text-anchor="end" font-size="9" fill="#6b7280">{Math.round(t.v)}</text>
          {/each}
          <text x="12" y={PAD/2 + CHART_H/2} text-anchor="middle" font-size="10" fill="#6b7280"
            transform="rotate(-90 12 {PAD/2 + CHART_H/2})">Depth (m)</text>

          <!-- Border -->
          <rect x={PAD} y={PAD/2} width={CHART_W} height={CHART_H} fill="none" stroke="#9ca3af" stroke-width="1"/>
        </svg>
      </div>
    {/if}

  </div><!-- /canvas area -->

  <!-- ── Horizons floating panel ──────────────────────────────────────────── -->
  <FloatingPanel
    title="Stratigraphic Column"
    visible={showHzPanel}
    onClose={() => (showHzPanel = false)}
    width={520}
    x={40} y={60}>
    {#snippet children()}
      <div class="p-3">

        <!-- Table header -->
        <div class="hz-tbl-head">
          <span style="width:28px"></span>
          <span style="width:18px"></span>
          <span class="flex-1">Name</span>
          <span style="width:72px" class="text-center">Ref depth (m)</span>
          <span style="width:140px" class="text-center">Operator</span>
          <span style="width:20px"></span>
        </div>

        <!-- Horizon rows -->
        {#each horizons as h, idx (h.id)}
          {@const refZ = Math.round(h.points.reduce((s,p)=>s+p.y,0) / Math.max(1,h.points.length))}
          <div class="hz-tbl-row {activeId===h.id ? 'hz-tbl-active' : ''}"
               onclick={() => activeId = h.id} role="button" tabindex="0"
               onkeydown={e => e.key==='Enter' && (activeId=h.id)}>

            <!-- Up/Down -->
            <div style="width:28px" class="flex flex-col items-center gap-px">
              <button class="hz-t-arr" disabled={idx===0}
                onclick={e=>{e.stopPropagation();moveHorizon(h.id,'up')}}
                title="Move up in stratigraphy">▲</button>
              <button class="hz-t-arr" disabled={idx===horizons.length-1}
                onclick={e=>{e.stopPropagation();moveHorizon(h.id,'down')}}
                title="Move down in stratigraphy">▼</button>
            </div>

            <!-- Colour swatch -->
            <input type="color" value={h.colour}
              oninput={e=>recolourHorizon(h.id,e.target.value)}
              onclick={e=>e.stopPropagation()}
              style="width:18px;height:18px"
              class="rounded border-0 p-0 cursor-pointer flex-shrink-0"
              style:appearance="none" style:-webkit-appearance="none"/>

            <!-- Name -->
            <input type="text" value={h.name}
              onchange={e=>renameHorizon(h.id,e.target.value)}
              onclick={e=>e.stopPropagation()}
              class="flex-1 text-xs border border-gray-200 rounded px-1.5 py-0.5 min-w-0"/>

            <!-- Reference depth -->
            <input type="number" value={refZ}
              onchange={e=>{e.stopPropagation();adjustDepth(h.id,+e.target.value)}}
              onclick={e=>e.stopPropagation()}
              style="width:72px"
              class="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-right"/>

            <!-- Operator buttons -->
            <div style="width:140px" class="flex gap-0.5" onclick={e=>e.stopPropagation()}>
              {#each ['none','RA','RAI','RB','RBI'] as op}
                {@const active = (h.operator??'none')===op}
                <button
                  onclick={()=>setOperator(h.id,op)}
                  title={op==='none' ? 'Deposit — conformable layer, no erosion' :
                         op==='RA'   ? 'Remove Above — truncates ALL shallower horizons' :
                         op==='RAI'  ? 'Remove Above Intersection — clips immediate neighbour only' :
                         op==='RB'   ? 'Remove Below — channel/diapir cutting downward' :
                                       'Remove Below Intersection — clips immediate deeper neighbour only'}
                  class="hz-t-op
                    {active && op==='none'  ? 'hz-t-op-deposit' : ''}
                    {active && (op==='RA'||op==='RAI') ? 'hz-t-op-ra' : ''}
                    {active && (op==='RB'||op==='RBI') ? 'hz-t-op-rb' : ''}
                    {!active ? 'hz-t-op-off' : ''}">
                  {op==='none'?'·':op}
                </button>
              {/each}
            </div>

            <!-- Delete -->
            <button style="width:20px"
              onclick={e=>{e.stopPropagation();deleteHorizon(h.id)}}
              class="text-gray-300 hover:text-red-500 text-xs text-center">✕</button>
          </div>
        {/each}

        <!-- Add button -->
        <button onclick={addHorizon}
          class="mt-2 w-full py-1 text-xs text-blue-600 border border-dashed border-blue-300
                 rounded hover:border-blue-500 hover:bg-blue-50">
          + Add horizon
        </button>

        <!-- Operator legend -->
        <div class="mt-3 pt-3 border-t border-gray-100">
          <p class="text-[9px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Operator reference</p>
          <div class="grid grid-cols-1 gap-0.5">
            {#each [
              ['·',   'none',  'Deposit',                      'Conformable layer — fills space between this horizon and the one above. No erosion.'],
              ['RA',  'RA',    'Remove Above',                  'Erosional unconformity. This surface truncates ALL shallower horizons where it cuts up through them.'],
              ['RAI', 'RAI',   'Remove Above (intersection)',   'Same as RA but only clips the immediately shallower neighbour, not all layers above.'],
              ['RB',  'RB',    'Remove Below',                  'Channel or diapir cutting downward. This surface incises into deeper layers. The standard subtract already produces the body.'],
              ['RBI', 'RBI',   'Remove Below (intersection)',   'Same as RB but only clips the immediately deeper neighbour.'],
            ] as [label, opKey, name, desc]}
              <div class="flex gap-2 items-start py-0.5">
                <span class="w-7 flex-shrink-0 text-center text-[9px] font-bold px-1 py-0.5 rounded border
                             {opKey === 'none' ? 'border-gray-200 text-gray-400' :
                              opKey === 'RA' || opKey === 'RAI' ? 'border-orange-200 text-orange-600 bg-orange-50' :
                              'border-purple-200 text-purple-600 bg-purple-50'}">
                  {label}
                </span>
                <div>
                  <span class="text-[10px] font-semibold text-gray-700">{name}</span>
                  <span class="text-[9px] text-gray-400 ml-1">{desc}</span>
                </div>
              </div>
            {/each}
          </div>
        </div>

      </div>
    {/snippet}
  </FloatingPanel>

</div>

<style>
  .tb-dgeo {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 4px 2px;
    background: #ffffff;
    border-right: 1px solid #e2e8f0;
    width: 30px;
    flex-shrink: 0;
  }
  .tb-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .tb-btn {
    position: relative;
    background: none;
    border: none;
    color: #64748b;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tb-btn:hover  { background: #f1f5f9; color: #1e293b; }
  .tb-btn.tb-active { background: #dbeafe; color: #2563eb; }
  .tb-sep {
    width: 18px;
    height: 1px;
    background: #e2e8f0;
    margin: 2px 0;
  }
  .tb-tip {
    display: none;
    position: absolute;
    left: 32px;
    top: 50%;
    transform: translateY(-50%);
    background: #1e293b;
    color: #fff;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    white-space: nowrap;
    z-index: 999;
    pointer-events: none;
  }
  .tb-tip::before {
    content: '';
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 4px solid transparent;
    border-right-color: #1e293b;
  }
  .tb-item:hover .tb-tip { display: block; }
  .dirty-dot {
    position: absolute;
    top: 2px; right: 2px;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #f97316;
    pointer-events: none;
  }

  /* ── Horizons floating panel table ─────────────────────────────────────── */
  .hz-tbl-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px 4px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 3px;
    font-size: 9px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .hz-tbl-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 2px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .hz-tbl-row:hover { background: #f8fafc; }
  .hz-tbl-active { background: #eff6ff !important; }

  .hz-t-arr {
    background: none; border: none; cursor: pointer;
    font-size: 7px; line-height: 1; color: #94a3b8; padding: 1px;
    display: block;
  }
  .hz-t-arr:hover:not(:disabled) { color: #3b82f6; }
  .hz-t-arr:disabled { opacity: 0.2; cursor: default; }

  .hz-t-op {
    flex: 1;
    font-size: 8px; font-weight: 700;
    padding: 2px 0;
    border-radius: 3px;
    border: 1px solid #e2e8f0;
    background: white;
    color: #94a3b8;
    cursor: pointer;
    text-align: center;
    transition: all 0.1s;
  }
  .hz-t-op-off:hover { border-color: #93c5fd; color: #3b82f6; }
  /* Active states — colour-coded by operator type */
  .hz-t-op-deposit { background: #f0fdf4; color: #16a34a; border-color: #86efac; }
  .hz-t-op-ra      { background: #fff7ed; color: #ea580c; border-color: #fdba74; }
  .hz-t-op-rb      { background: #faf5ff; color: #9333ea; border-color: #d8b4fe; }
</style>
