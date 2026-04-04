<script>
  import { onMount } from 'svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { saveToHandle, downloadBlob } from '$lib/apps/shared/fileActions.js';
  import Dgeo3DView from './Dgeo3DView.svelte';

  const { tab } = $props();

  // ── View mode ──────────────────────────────────────────────────────────────
  let viewMode = $state('2d');  // '2d' | '3d'

  // ── Colour palette for formations ─────────────────────────────────────────
  const FORMATION_COLOURS = [
    '#c8e6c9','#fff9c4','#ffe0b2','#f8bbd0','#e1bee7',
    '#b3e5fc','#dcedc8','#fff8e1','#fce4ec','#e8eaf6',
    '#f3e5f5','#e0f2f1','#fbe9e7','#ede7f6','#e8f5e9',
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  let horizons = $state([]);      // [{ id, name, colour, points: [{x,y}] }]
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
        id:     h.id ?? crypto.randomUUID(),
        name:   h.name ?? 'Horizon',
        colour: h.colour ?? FORMATION_COLOURS[0],
        points: h.points ?? [],
        rails:  h.rails  ?? null,
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
      { id: crypto.randomUUID(), name: 'Seabed',        colour: FORMATION_COLOURS[0],
        points: [{ x: xL, y: 200 }, { x: mid, y: 220 }, { x: xR, y: 210 }] },
      { id: crypto.randomUUID(), name: 'Top Sand A',    colour: FORMATION_COLOURS[1],
        points: [{ x: xL, y: 800 }, { x: mid, y: 900 }, { x: xR, y: 850 }] },
      { id: crypto.randomUUID(), name: 'Top Shale B',   colour: FORMATION_COLOURS[2],
        points: [{ x: xL, y: 1600 }, { x: mid, y: 1700 }, { x: xR, y: 1650 }] },
      { id: crypto.randomUUID(), name: 'Top Reservoir', colour: FORMATION_COLOURS[3],
        points: [{ x: xL, y: 2400 }, { x: mid, y: 2500 }, { x: xR, y: 2450 }] },
    ];
    dirty = false;
  }

  function toJSON() {
    return JSON.stringify({
      version: '1.0',
      domain:  { x: domX, y: domY },
      horizons: horizons.map(h => ({
        id: h.id, name: h.name, colour: h.colour, points: h.points,
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
      name:   `Horizon ${idx + 1}`,
      colour: FORMATION_COLOURS[idx % FORMATION_COLOURS.length],
      points: [{ x: xL, y: depth }, { x: xMid, y: depth + 50 }, { x: xR, y: depth }],
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

<div class="flex h-full overflow-hidden bg-gray-50 text-sm">

  <!-- ── Left toolbar ───────────────────────────────────────────────────── -->
  <div class="w-52 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">

    <!-- Header -->
    <div class="px-3 py-2 border-b border-gray-200">
      <div class="text-xs font-bold text-gray-700 uppercase tracking-wide">Geological Cross-Section</div>
      <div class="text-[0.6rem] text-gray-400 truncate mt-0.5">{tab.name}</div>
      <!-- 2D / 3D toggle -->
      <div class="flex gap-0.5 mt-1.5">
        {#each [['2d','2D'],['3d','3D']] as [v, label]}
          <button
            onclick={() => viewMode = v}
            class="flex-1 text-[10px] font-semibold py-0.5 rounded transition-colors
                   {viewMode === v
                     ? 'bg-blue-600 text-white'
                     : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}">
            {label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Tools -->
    <div class="px-3 py-2 border-b border-gray-200">
      <div class="text-[0.6rem] text-gray-400 uppercase mb-1.5">Tool</div>
      <div class="flex flex-col gap-0.5">
        {#each [['select','Select / Move','↖'],['add-point','Add Point','+'],['delete','Delete Point','✕']] as [t, label, icon]}
          <button
            onclick={() => tool = t}
            class="flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors
                   {tool === t
                     ? 'bg-blue-600 text-white border-blue-600'
                     : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}">
            <span class="w-4 text-center font-mono">{icon}</span>
            {label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Horizons list -->
    <div class="flex-1 overflow-y-auto">
      <div class="flex items-center justify-between px-3 pt-2 pb-1">
        <div class="text-[0.6rem] text-gray-400 uppercase">Horizons</div>
        <button
          onclick={addHorizon}
          class="text-[0.65rem] text-blue-600 hover:text-blue-800 font-medium">+ Add</button>
      </div>

      {#each sortedHorizons as h (h.id)}
        <div
          role="button" tabindex="0"
          onclick={() => { activeId = h.id; }}
          onkeydown={e => e.key === 'Enter' && (activeId = h.id)}
          class="flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors
                 {activeId === h.id ? 'bg-blue-50 border-l-2 border-blue-500' : 'hover:bg-gray-50 border-l-2 border-transparent'}">
          <!-- Colour swatch -->
          <input type="color" value={h.colour}
            oninput={e => recolourHorizon(h.id, e.target.value)}
            class="w-4 h-4 rounded cursor-pointer border-0 p-0 flex-shrink-0"
            onclick={e => e.stopPropagation()}/>

          <!-- Name (double-click to edit) -->
          {#if editingName === h.id}
            <input type="text" value={h.name} autofocus
              class="flex-1 text-xs border border-blue-400 rounded px-1 py-0"
              onblur={e => { renameHorizon(h.id, e.target.value); editingName = null; }}
              onkeydown={e => { if (e.key === 'Enter') { renameHorizon(h.id, e.target.value); editingName = null; } }}
              onclick={e => e.stopPropagation()}/>
          {:else}
            <span
              class="flex-1 text-xs text-gray-700 truncate"
              ondblclick={e => { e.stopPropagation(); editingName = h.id; }}>
              {h.name}
            </span>
          {/if}

          <button
            onclick={e => { e.stopPropagation(); deleteHorizon(h.id); }}
            class="text-gray-300 hover:text-red-500 text-xs ml-auto flex-shrink-0">✕</button>
        </div>
      {/each}
    </div>

    <!-- Bottom actions -->
    <div class="p-3 border-t border-gray-200 flex flex-col gap-1.5">
      {#if loadErr}<p class="text-[0.6rem] text-red-500">{loadErr}</p>{/if}
      {#if saveErr}<p class="text-[0.6rem] text-red-500 cursor-pointer" onclick={() => saveErr = ''}>{saveErr} ✕</p>{/if}
      <button
        onclick={saveFile}
        class="w-full text-xs rounded py-1.5 font-medium transition-colors
               {dirty ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}">
        {tab.handle ? (dirty ? '● Save' : 'Saved') : (dirty ? '● Download' : 'Download')}
      </button>
      <button
        onclick={downloadFile}
        class="w-full text-xs border border-gray-200 text-gray-500 rounded py-1 hover:bg-gray-50">
        ⬇ Download copy
      </button>
      <button
        onclick={initDefault}
        class="w-full text-xs border border-gray-200 text-gray-500 rounded py-1 hover:bg-gray-50">
        Reset to default
      </button>
    </div>
  </div>

  <!-- ── Right: canvas area ───────────────────────────────────────────── -->
  <div class="flex-1 overflow-auto bg-white flex flex-col" class:overflow-hidden={viewMode === '3d'}>

    <!-- 3D block view -->
    {#if viewMode === '3d'}
      <Dgeo3DView
        horizons={sortedHorizons}
        domX={domX}
        domY={domY}
        {onUpdateRails}
      />
    {/if}

    <!-- 2D SVG canvas (hidden in 3D mode) -->
    <div class="contents" class:hidden={viewMode === '3d'}>

    <!-- Domain controls -->
    <div class="flex items-center gap-4 px-4 py-1.5 border-b border-gray-100 bg-gray-50 text-xs text-gray-500 flex-shrink-0">
      <span class="font-medium text-gray-600">Domain</span>
      <span>X:</span>
      <input type="number" class="w-14 border border-gray-200 rounded px-1 py-0" value={domX.min}
        onchange={e => { domX = { ...domX, min: +e.target.value }; }}/>
      <span>–</span>
      <input type="number" class="w-14 border border-gray-200 rounded px-1 py-0" value={domX.max}
        onchange={e => { domX = { ...domX, max: +e.target.value }; }}/>
      <span class="text-gray-400">km</span>
      <span class="ml-2">Depth:</span>
      <input type="number" class="w-16 border border-gray-200 rounded px-1 py-0" value={domY.min}
        onchange={e => { domY = { ...domY, min: +e.target.value }; }}/>
      <span>–</span>
      <input type="number" class="w-16 border border-gray-200 rounded px-1 py-0" value={domY.max}
        onchange={e => { domY = { ...domY, max: +e.target.value }; }}/>
      <span class="text-gray-400">m</span>
      {#if activeHorizon}
        <span class="ml-4 text-blue-600 font-medium">{activeHorizon.name}</span>
        <span class="text-gray-400">{activeHorizon.points.length} pts</span>
      {/if}
    </div>

    <div class="flex-1 overflow-auto p-4">
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

        <!-- Formation bands (between consecutive sorted horizons) -->
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

          <!-- Line -->
          {#if sorted.length >= 2}
            <polyline
              points={polyStr(h)}
              fill="none"
              stroke={h.colour}
              stroke-width={isActive ? 3 : 2}
              stroke-linejoin="round"
              stroke-linecap="round"
              style="filter: {isActive ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' : 'none'}"/>
            <!-- Dark border for visibility -->
            <polyline
              points={polyStr(h)}
              fill="none"
              stroke="#374151"
              stroke-width={isActive ? 1.5 : 0.5}
              opacity="0.5"
              stroke-linejoin="round"
              stroke-linecap="round"/>
          {/if}

          <!-- Horizon label at rightmost point -->
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

          <!-- Control points -->
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
    </div> <!-- end 2D wrapper -->
  </div>
</div>
