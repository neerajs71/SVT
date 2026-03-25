<script>
  import { onMount } from 'svelte';

  const { tab } = $props();

  let loading = $state(true);
  let error   = $state('');
  let wson    = $state(null);

  // ── Layout constants ─────────────────────────────────────────────────────
  const RULER_W   = 44;
  const HEADER_H  = 52;
  const PERF_DIST = 3;

  // ── Display Options state ────────────────────────────────────────────────
  let displayOpts = $state({
    autoScale: true,
    directional: false,
    xScale: 0.17,
    yScale: 0.17,
    xDiaScale: 6.0,
    preserveAspectRatio: true,
    showLeftTrack: true
  });
  let showDisplayOpts = $state(false);
  let dispPos = $state({ x: 0, y: 50 });
  let isDragging = false;
  let dragOffX = 0, dragOffY = 0;

  // ── Toolbar visibility states ─────────────────────────────────────────────
  let showInfoBar      = $state(true);
  let showStrata       = $state(true);
  let showOpenHole     = $state(true);
  let showCasing       = $state(true);
  let showCement       = $state(true);
  let showCompletions  = $state(true);
  let showPerforations = $state(true);

  // ── Edit panel state ──────────────────────────────────────────────────────
  let editPanel = $state(null);
  let editIdx = $state(-1);
  let editData = $state({});

  // ── Component JSON cache ──────────────────────────────────────────────────
  const compJsonCache = new Map();
  let compSvgStrings = $state([]);

  function jsonToSvgContent(componentData, comp, compIndex, g) {
    const { elements, width: jw, height: jh } = componentData;
    if (!elements || !jw || !jh) return '';

    const { centerX, yScale, diaScale } = g;
    const compOD     = comp.od ?? 2.875;
    const compLength = comp.length ?? 1;
    const compTop    = comp._top;

    const defs  = [];
    const paths = [];
    let gradCounter = 0;

    for (const el of elements) {
      if (el.type !== 'freeform' || !el.points?.length) continue;

      const segs = [];
      for (const pt of el.points) {
        const { x, y, directive } = pt;
        const diamIn  = (x - jw / 2) * (compOD / jw);
        const depthM  = compTop + (y * compLength / jh);
        const svgX    = (centerX + diamIn * diaScale).toFixed(2);
        const svgY    = (HEADER_H + depthM * yScale).toFixed(2);

        if (directive === 'moveTo')  segs.push(`M${svgX} ${svgY}`);
        else if (directive === 'lineTo')  segs.push(`L${svgX} ${svgY}`);
        else if (directive === 'close')   segs.push('Z');
      }
      if (segs.length === 0) continue;

      let fillAttr = 'none';
      const fill = el.fill;
      if (fill) {
        if (typeof fill === 'string') {
          fillAttr = fill;
        } else if (fill.type === 'solid') {
          fillAttr = fill.color ?? 'none';
        } else if (fill.type === 'gradient') {
          const origId  = fill.id ?? `g${gradCounter}`;
          const uid     = `ci${compIndex}_${origId}`;
          fillAttr = `url(#${uid})`;
          const stops = (fill.gstops ?? []).map(s => {
            const offset = s.offset ?? `${(s.position / 1000).toFixed(1)}%`;
            return `<stop offset="${offset}" stop-color="${s['stop-color'] ?? '#000'}"/>`;
          }).join('');
          const gType = fill.gradient_type ?? 'linear';
          if (gType === 'linear') {
            defs.push(`<linearGradient id="${uid}" x1="0%" y1="0%" x2="100%" y2="0%">${stops}</linearGradient>`);
          } else {
            defs.push(`<radialGradient id="${uid}">${stops}</radialGradient>`);
          }
          gradCounter++;
        }
      }

      const stroke = el.stroke ?? 'none';
      const sw = Array.isArray(el.strokeWidth) ? el.strokeWidth[0] : (el.strokeWidth ?? 0);
      paths.push(`<path d="${segs.join(' ')}" fill="${fillAttr}" stroke="${stroke}" stroke-width="${sw}"/>`);
    }

    const defsSection = defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '';
    return defsSection + paths.join('');
  }

  async function fetchCompJson(jsonName) {
    if (compJsonCache.has(jsonName)) return compJsonCache.get(jsonName);
    try {
      const res = await fetch(`/compjson/${encodeURIComponent(jsonName)}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      compJsonCache.set(jsonName, data);
      return data;
    } catch {
      compJsonCache.set(jsonName, null);
      return null;
    }
  }

  $effect(() => {
    const g = geo;
    if (!g || g.completions.length === 0) { compSvgStrings = []; return; }
    const snap = g.completions;
    (async () => {
      const results = await Promise.all(
        snap.map(async (comp, i) => {
          const name = comp.tool_comp;
          if (!name) return null;
          const data = await fetchCompJson(name);
          if (!data) return null;
          return jsonToSvgContent(data, comp, i, g);
        })
      );
      compSvgStrings = results;
    })();
  });

  const geo = $derived.by(() => {
    if (!wson) return null;

    const strataW = displayOpts.showLeftTrack ? 110 : 0;
    const diaScale = displayOpts.xDiaScale;

    const src = wson.wellData?.[0] ?? wson;
    const oh = src.oh ?? src.openHole ?? [];
    const ch = src.ch ?? src.casedHole ?? [];
    const cem = src.cementing ?? [];
    const str = src.strata ?? [];
    const perf = src.perforations ?? [];
    const completionsRaw = src.completions ?? [];

    const maxBitSize = oh.length ? Math.max(...oh.map(s => s.bitSize)) : 20;
    const maxOD = ch.length ? Math.max(...ch.map(c => c.od)) : maxBitSize;
    const maxR = Math.max(maxBitSize, maxOD) / 2;

    const allD = [
      ...oh.map(s => s.bot),
      ...ch.map(c => c.bot),
      ...str.map(s => s.top),
      ...perf.map(p => p.bot),
    ];
    const maxDepth = allD.length ? Math.max(...allD) + 50 : 1000;

    const autoYScale = Math.min(Math.max(400 / maxDepth, 0.08), 0.35);
    const yScale = displayOpts.autoScale ? autoYScale : displayOpts.yScale;

    const centerX = strataW + RULER_W + maxR * diaScale + 20;
    const totalW = centerX + maxR * diaScale + 160;
    const totalH = HEADER_H + maxDepth * yScale + 40;

    const sy = d => HEADER_H + d * yScale;
    const sxR = r => centerX + r * diaScale;
    const sxL = r => centerX - r * diaScale;

    const wellName =
      wson.inputHeader?.wellName?.value ??
      wson.inputHeader?.WELL?.value ??
      src.inputHeader?.wellName?.value ??
      src.inputHeader?.WELL?.value ??
      wson.wellName ?? src.wellName ?? tab.name ?? 'Well Schematic';

    const niceInterval = (() => {
      const raw = maxDepth / 8;
      const exp = Math.pow(10, Math.floor(Math.log10(raw || 1)));
      return [1, 2, 5, 10].map(m => m * exp).find(m => maxDepth / m <= 12) ?? raw;
    })();
    const rulerTicks = [];
    for (let d = 0; d <= maxDepth; d += niceInterval) rulerTicks.push(d);

    let compCursor = 0;
    const completions = completionsRaw.map(c => {
      const _top = compCursor;
      compCursor += (c.length ?? 0);
      return { ...c, _top, _bot: compCursor };
    });

    return { oh, ch, cem, str, perf, completions, maxDepth, yScale, diaScale, centerX, totalW, totalH, sy, sxR, sxL, wellName, rulerTicks, maxR, strataW };
  });

  async function loadFile() {
    try {
      loading = true;
      error   = '';
      let bytes;
      if (tab.file) {
        bytes = await tab.file.arrayBuffer();
      } else if (tab.driveId) {
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`);
        if (!res.ok) throw new Error(`Drive fetch failed: HTTP ${res.status}`);
        bytes = await res.arrayBuffer();
      } else {
        throw new Error('No file source provided');
      }
      const text = new TextDecoder().decode(bytes);
      wson = JSON.parse(text);
    } catch (e) {
      error = e.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  onMount(loadFile);

  // Drag for Display Options popup
  function onDragStart(e) {
    isDragging = true;
    dragOffX = e.clientX - dispPos.x;
    dragOffY = e.clientY - dispPos.y;
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!isDragging) return;
    dispPos = { x: e.clientX - dragOffX, y: e.clientY - dragOffY };
  }

  function onDragEnd() {
    isDragging = false;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  }

  // Helpers
  function getSrc() {
    return wson?.wellData?.[0] ?? wson;
  }

  function toggleEditPanel(panel) {
    editPanel = editPanel === panel ? null : panel;
    editIdx = -1;
    editData = {};
  }

  function startEditRow(idx, row) {
    editIdx = idx;
    editData = { ...row };
  }

  function cancelEdit() {
    editIdx = -1;
    editData = {};
  }

  // OH functions
  function addOHRow() {
    const src = getSrc();
    if (!src) return;
    src.oh = [...(src.oh ?? []), { bitSize: 12.25, top: 0, bot: 500 }];
  }

  function saveOHRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.oh = src.oh.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1;
    editData = {};
  }

  function deleteOHRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.oh = src.oh.filter((_, i) => i !== idx);
  }

  // CH functions
  function addCHRow() {
    const src = getSrc();
    if (!src) return;
    src.ch = [...(src.ch ?? []), { od: 9.625, grade: 'L80', weight: 40, top: 0, bot: 2500 }];
  }

  function saveCHRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.ch = src.ch.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1;
    editData = {};
  }

  function deleteCHRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.ch = src.ch.filter((_, i) => i !== idx);
  }

  // Cementing functions
  function addCemRow() {
    const src = getSrc();
    if (!src) return;
    src.cementing = [...(src.cementing ?? []), { od: 9.625, top: 0, bot: 2500 }];
  }

  function saveCemRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.cementing = src.cementing.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1;
    editData = {};
  }

  function deleteCemRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.cementing = src.cementing.filter((_, i) => i !== idx);
  }

  // Strata functions
  function addStrataRow() {
    const src = getSrc();
    if (!src) return;
    src.strata = [...(src.strata ?? []), { strata: 'New Layer', top: 0, color: '#aaaaaa' }];
  }

  function saveStrataRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.strata = src.strata.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1;
    editData = {};
  }

  function deleteStrataRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.strata = src.strata.filter((_, i) => i !== idx);
  }

  // Download
  function downloadWson() {
    if (!wson) return;
    const data = JSON.stringify(wson, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (tab.name || 'schematic') + '.wson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Helpers
  function ohForDepth(d, oh) {
    for (const s of oh) {
      if (d >= s.top - 1 && d <= s.bot + 1) return s;
    }
    return null;
  }

  function textColor(hex) {
    const h = (hex ?? '#888').replace('#', '').padEnd(6, '0');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? '#111' : '#eee';
  }

  function perfArrows(perf, sy, sxL, sxR) {
    let paths = '';
    const intervals = Math.max(1, Math.round((perf.bot - perf.top) / PERF_DIST));
    const tip = (perf.perfID ?? 7) / 2;
    const ext = tip + 5;
    for (let i = 0; i < intervals; i++) {
      const t   = perf.top + PERF_DIST * i;
      const mid = t + PERF_DIST / 2;
      const b   = t + PERF_DIST;
      paths += `M${sxL(tip)},${sy(t)} L${sxL(ext)},${sy(mid)} L${sxL(tip)},${sy(b)} Z `;
      paths += `M${sxR(tip)},${sy(t)} L${sxR(ext)},${sy(mid)} L${sxR(tip)},${sy(b)} Z `;
    }
    return paths;
  }

  function cementRects(cem, oh, sy, sxL, sxR) {
    const rects = [];
    for (const c of cem) {
      const ohSec   = ohForDepth((c.top + c.bot) / 2, oh);
      if (!ohSec) continue;
      const holeR   = ohSec.bitSize / 2;
      const casingR = c.od / 2;
      if (holeR <= casingR) continue;
      rects.push({ top: c.top, bot: c.bot, holeR, casingR });
    }
    return rects;
  }

  function compTypeOf(comp) {
    const key = ((comp.tool_comp ?? '') + ' ' + (comp.description ?? '')).toLowerCase();
    if (key.includes('hanger'))  return 'hanger';
    if (key.includes('packer'))  return 'packer';
    if (key.includes('ina') || key.includes('icd') || key.includes('inflow') || key.includes('nozzle')) return 'icd';
    if (key.includes('liner'))   return 'liner';
    return 'tubing';
  }
</script>

{#if loading}
  <div class="flex items-center justify-center h-48 text-gray-400 text-sm">Loading schematic…</div>
{:else if error}
  <div class="p-4 text-red-600 text-sm">
    <p class="font-semibold">Failed to load WSON file</p>
    <p class="mt-1">{error}</p>
  </div>
{:else if geo}
  {@const { oh, ch, cem, str, perf, completions, sy, sxL, sxR, wellName, rulerTicks, totalW, totalH, centerX, strataW } = geo}

  <!-- Info bar -->
  {#if showInfoBar}
    <div class="flex items-center gap-4 px-3 py-1.5 text-xs text-gray-500 border-b border-gray-200 flex-wrap">
      <span class="font-semibold text-gray-700">{wellName}</span>
      {#if oh.length}<span>OH: {oh.length}</span>{/if}
      {#if ch.length}<span>Casing: {ch.length}</span>{/if}
      {#if cem.length}<span>Cement: {cem.length}</span>{/if}
      {#if completions.length}<span>Completions: {completions.length}</span>{/if}
      {#if perf.length}<span>Perforations: {perf.length}</span>{/if}
      {#if str.length}<span>Strata: {str.length}</span>{/if}
      <button onclick={downloadWson} class="ml-auto px-2 py-0.5 rounded text-xs bg-green-800 text-white hover:bg-green-700">↓ Save</button>
    </div>
  {/if}

  <!-- Main layout -->
  <div class="flex overflow-hidden relative" style="height: calc(100% - {showInfoBar ? 30 : 0}px)">

    <!-- Toolbar -->
    <div class="schematic-toolbar">
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showInfoBar} onclick={() => (showInfoBar = !showInfoBar)} aria-label="Info">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><line x1="8" y1="7" x2="8" y2="11"/><circle cx="8" cy="5.5" r="0.6" fill="currentColor"/></svg>
        </button>
        <span class="tb-tip">Info</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showOpenHole} onclick={() => (showOpenHole = !showOpenHole)} aria-label="Open Hole">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="8" height="12" stroke-dasharray="3,2"/></svg>
        </button>
        <span class="tb-tip">Open Hole</span>
      </div>
      <div class="tb-item group">
        <button class="tb-btn tb-edit" class:tb-active={editPanel === 'oh'} onclick={() => toggleEditPanel('oh')} aria-label="Edit OH">✎</button>
        <span class="tb-tip">Edit OH</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showCasing} onclick={() => (showCasing = !showCasing)} aria-label="Casing">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="8" height="12"/></svg>
        </button>
        <span class="tb-tip">Casing</span>
      </div>
      <div class="tb-item group">
        <button class="tb-btn tb-edit" class:tb-active={editPanel === 'ch'} onclick={() => toggleEditPanel('ch')} aria-label="Edit CH">✎</button>
        <span class="tb-tip">Edit CH</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showCement} onclick={() => (showCement = !showCement)} aria-label="Cement">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="4" cy="11" r="1.2" fill="currentColor"/><circle cx="12" cy="11" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg>
        </button>
        <span class="tb-tip">Cement</span>
      </div>
      <div class="tb-item group">
        <button class="tb-btn tb-edit" class:tb-active={editPanel === 'cem'} onclick={() => toggleEditPanel('cem')} aria-label="Edit Cem">✎</button>
        <span class="tb-tip">Edit Cem</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showCompletions} onclick={() => (showCompletions = !showCompletions)} aria-label="Completions">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/><line x1="6" y1="5" x2="10" y2="5"/><line x1="6" y1="9" x2="10" y2="9"/></svg>
        </button>
        <span class="tb-tip">Completions</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showPerforations} onclick={() => (showPerforations = !showPerforations)} aria-label="Perforations">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="5" x2="9" y2="5"/><polyline points="7,3 10,5 7,7"/><line x1="2" y1="11" x2="9" y2="11"/><polyline points="7,9 10,11 7,13"/></svg>
        </button>
        <span class="tb-tip">Perforations</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showStrata} onclick={() => (showStrata = !showStrata)} aria-label="Strata">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg>
        </button>
        <span class="tb-tip">Strata</span>
      </div>
      <div class="tb-item group">
        <button class="tb-btn tb-edit" class:tb-active={editPanel === 'strata'} onclick={() => toggleEditPanel('strata')} aria-label="Edit Strata">✎</button>
        <span class="tb-tip">Edit Strata</span>
      </div>

      <div class="flex-1"></div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showDisplayOpts} onclick={() => (showDisplayOpts = !showDisplayOpts)} aria-label="Display">⚙</button>
        <span class="tb-tip">Display Options</span>
      </div>
    </div>

    <!-- SVG area -->
    <div class="overflow-auto bg-white flex-1">
      <svg width={totalW} height={totalH} xmlns="http://www.w3.org/2000/svg" class="font-mono" style="display:block">
        <defs>
          <pattern id="cement-fill" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#e8e8e8"/>
            <circle cx="3" cy="3" r="1.2" fill="#888"/>
          </pattern>
          <pattern id="icd-fill" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#dbeafe"/>
            <circle cx="4" cy="4" r="1" fill="#2563eb"/>
          </pattern>
        </defs>

        <rect x="0" y="0" width={totalW} height={HEADER_H} fill="#1e3a5f"/>
        <text x={totalW / 2} y={HEADER_H / 2 + 6} text-anchor="middle" fill="white" font-size="14" font-weight="bold" font-family="sans-serif">{wellName}</text>

        {#if showStrata && strataW > 0}
          {#each str as s, i}
            {@const top = sy(s.top)}
            {@const bot = i < str.length - 1 ? sy(str[i + 1].top) : sy(geo.maxDepth)}
            {@const h = bot - top}
            <rect x="0" y={top} width={strataW} height={h} fill={s.color ?? '#aaa'} stroke="#333" stroke-width="0.5"/>
            {#if h > 14}
              <text x="4" y={top + 13} font-size="9" fill={textColor(s.color ?? '#aaa')} font-family="sans-serif">{s.strata}</text>
              <text x="4" y={top + 22} font-size="8" fill={textColor(s.color ?? '#aaa')} font-family="sans-serif">{s.top.toFixed(0)}m</text>
            {/if}
          {/each}
        {/if}

        <rect x={strataW} y={HEADER_H} width={RULER_W} height={totalH - HEADER_H} fill="#f0f0f0" stroke="#ccc" stroke-width="0.5"/>
        {#each rulerTicks as d}
          {@const y = sy(d)}
          <line x1={strataW} y1={y} x2={strataW + RULER_W} y2={y} stroke="#999" stroke-width="0.8"/>
          <text x={strataW + RULER_W - 3} y={y + 4} font-size="8" text-anchor="end" fill="#444" font-family="sans-serif">{d}</text>
        {/each}

        <line x1={centerX} y1={HEADER_H} x2={centerX} y2={totalH} stroke="#aaa" stroke-width="0.5" stroke-dasharray="4 4"/>

        {#if showOpenHole}
          {#each oh as s}
            {@const x = sxL(s.bitSize / 2)}
            {@const w = sxR(s.bitSize / 2) - x}
            {@const y = sy(s.top)}
            {@const ht = sy(s.bot) - y}
            <rect {x} {y} width={w} height={ht} fill="#f3e8ff" stroke="#9333ea" stroke-width="1" stroke-dasharray="5 3"/>
            <text x={sxR(s.bitSize / 2) + 3} y={y + 10} font-size="8" fill="#7c3aed" font-family="sans-serif">{s.bitSize}"</text>
          {/each}
        {/if}

        {#if showCement}
          {#each cementRects(cem, oh, sy, sxL, sxR) as cr}
            {@const y = sy(cr.top)}
            {@const ht = sy(cr.bot) - y}
            <rect x={sxL(cr.holeR)} y={y} width={sxL(cr.casingR) - sxL(cr.holeR)} height={ht} fill="url(#cement-fill)"/>
            <rect x={sxR(cr.casingR)} y={y} width={sxR(cr.holeR) - sxR(cr.casingR)} height={ht} fill="url(#cement-fill)"/>
          {/each}
        {/if}

        {#if showCasing}
          {#each ch as c}
            {@const x = sxL(c.od / 2)}
            {@const w = sxR(c.od / 2) - x}
            {@const y = sy(c.top)}
            {@const ht = sy(c.bot) - y}
            <rect {x} {y} width={w} height={ht} fill="azure" stroke="#111" stroke-width="1.5"/>
            {#if c.grade}
              <text x={sxR(c.od / 2) + 4} y={y + 22} font-size="8" fill="#1e40af" font-family="sans-serif">{c.od}" {c.grade}</text>
            {/if}
          {/each}
        {/if}

        {#if showCompletions}
          {#each completions as comp, i}
            {@const r = (comp.od ?? 2.875) / 2}
            {@const rOuter = r * (comp.od_multiplier ?? 1.2)}
            {@const ytop = sy(comp._top)}
            {@const ybot = sy(comp._bot)}
            {@const xL = sxL(r)}
            {@const xR = sxR(r)}
            {@const xOL = sxL(rOuter)}
            {@const xOR = sxR(rOuter)}
            {@const ymid = (ytop + ybot) / 2}
            {@const type = compTypeOf(comp)}

            {#if compSvgStrings[i]}
              {@html compSvgStrings[i]}
            {:else if type === 'packer'}
              <polygon points="{xOL},{ytop} {xOR},{ytop} {centerX},{ymid}" fill="#f59e0b" stroke="#b45309" stroke-width="0.8" opacity="0.9"/>
              <polygon points="{xOL},{ybot} {xOR},{ybot} {centerX},{ymid}" fill="#f59e0b" stroke="#b45309" stroke-width="0.8" opacity="0.9"/>
              <line x1={xOL} y1={ymid} x2={xOR} y2={ymid} stroke="#b45309" stroke-width="1"/>
            {:else if type === 'hanger'}
              {@const rWide = r * (comp.od_multiplier ?? 1.5)}
              <polygon points="{sxL(rWide)},{ytop} {sxR(rWide)},{ytop} {xR},{ybot} {xL},{ybot}" fill="#94a3b8" stroke="#475569" stroke-width="1"/>
            {:else if type === 'icd'}
              <rect x={xL} y={ytop} width={xR - xL} height={ybot - ytop} fill="url(#icd-fill)" stroke="#2563eb" stroke-width="1"/>
              <line x1={xL} y1={ytop} x2={xL} y2={ybot} stroke="#1d4ed8" stroke-width="1.5"/>
              <line x1={xR} y1={ytop} x2={xR} y2={ybot} stroke="#1d4ed8" stroke-width="1.5"/>
            {:else if type === 'liner'}
              <rect x={xL} y={ytop} width={xR - xL} height={ybot - ytop} fill="#f0fdf4" stroke="#16a34a" stroke-width="1.2"/>
            {:else}
              <rect x={xL - 1.5} y={ytop} width="3" height={ybot - ytop} fill="#334155"/>
              <rect x={xR - 1.5} y={ytop} width="3" height={ybot - ytop} fill="#334155"/>
            {/if}

            {#if comp.description && (ybot - ytop) > 10}
              <text x={xOR + 6} y={ymid + 4} font-size="8" fill="#374151" font-family="sans-serif">{comp.description}</text>
            {/if}
          {/each}
        {/if}

        {#if showPerforations}
          {#each perf as p}
            <path d={perfArrows(p, sy, sxL, sxR)} fill={p.color ?? '#e53e3e'} stroke="none" opacity="0.85"/>
          {/each}
        {/if}

        {#if oh.length}
          {@const tdDepth = Math.max(...oh.map(s => s.bot))}
          {@const tdY = sy(tdDepth)}
          <line x1={sxL(2)} y1={tdY} x2={sxR(2)} y2={tdY} stroke="#dc2626" stroke-width="2"/>
          <text x={sxR(2) + 4} y={tdY + 4} font-size="9" fill="#dc2626" font-family="sans-serif">TD {tdDepth}m</text>
        {/if}
      </svg>
    </div>

    <!-- Display Options Popup -->
    {#if showDisplayOpts}
      <div class="absolute rounded-2xl bg-white/98 shadow-2xl border border-gray-200/90 flex flex-col p-1 select-none" style="width: 240px; right: 10px; top: {dispPos.y}px; z-index: 50;">
        <div class="flex items-center justify-between px-2 py-1 bg-gradient-to-r from-blue-100/50 to-slate-100/40 border-b border-gray-300/70 rounded-t-lg cursor-grab" onmousedown={onDragStart}>
          <h3 class="m-0 text-sm font-extrabold text-slate-900">Display Options</h3>
          <button class="border border-slate-300/60 bg-white/90 text-slate-600 rounded-lg w-6 h-6 flex items-center justify-center cursor-pointer hover:bg-slate-100 text-xs" onclick={(e) => { e.stopPropagation(); showDisplayOpts = false; }} onmousedown={(e) => e.stopPropagation()}>✕</button>
        </div>

        <div class="px-1 py-1 flex flex-col space-y-1 overflow-y-auto">
          <div class="px-1 pt-1 pb-0">
            <div class="grid grid-cols-3 rounded border border-gray-800 p-1">
              <div class="text-xs self-center">To Scale</div>
              <input type="checkbox" bind:checked={displayOpts.autoScale} class="mx-auto accent-orange-500"/>
              <div class="text-xs self-center">Autoscale</div>
            </div>
          </div>

          <div class="px-1 pt-0 pb-1">
            <div class="grid grid-cols-3 rounded border border-gray-800 p-1">
              <div class="text-xs self-center">Directional</div>
              <input type="checkbox" bind:checked={displayOpts.directional} class="mx-auto accent-orange-500"/>
              <div class="text-xs self-center">Straight</div>
            </div>
          </div>

          <div class="flex gap-1 p-1">
            <div class="flex-1 rounded border border-gray-800 p-1">
              <div class="text-xs text-center mb-1 font-medium">X Scale</div>
              <div class="flex items-center gap-1">
                <button onclick={() => displayOpts.xScale = Math.max(0.05, displayOpts.xScale - 0.025)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">-</button>
                <input type="range" bind:value={displayOpts.xScale} min="0.05" max="0.5" step="0.025" class="flex-1 h-1 bg-gray-200 rounded accent-orange-500"/>
                <button onclick={() => displayOpts.xScale = Math.min(0.5, displayOpts.xScale + 0.025)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">+</button>
              </div>
              <div class="text-xs text-center mt-1">{displayOpts.xScale.toFixed(2)}</div>
            </div>

            <div class="flex-1 rounded border border-gray-800 p-1">
              <div class="text-xs text-center mb-1 font-medium">Y Scale</div>
              <div class="flex items-center gap-1">
                <button onclick={() => displayOpts.yScale = Math.max(0.05, displayOpts.yScale - 0.025)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">-</button>
                <input type="range" bind:value={displayOpts.yScale} min="0.05" max="0.5" step="0.025" class="flex-1 h-1 bg-gray-200 rounded accent-orange-500"/>
                <button onclick={() => displayOpts.yScale = Math.min(0.5, displayOpts.yScale + 0.025)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">+</button>
              </div>
              <div class="text-xs text-center mt-1">{displayOpts.yScale.toFixed(2)}</div>
            </div>
          </div>

          <div class="p-1 rounded border border-gray-800">
            <div class="text-xs text-center mb-1 font-medium">Dia Scale</div>
            <div class="flex items-center gap-1">
              <button onclick={() => displayOpts.xDiaScale = Math.max(2, displayOpts.xDiaScale - 0.5)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">-</button>
              <input type="range" bind:value={displayOpts.xDiaScale} min="2" max="15" step="0.5" class="flex-1 h-1 bg-gray-200 rounded accent-orange-500"/>
              <button onclick={() => displayOpts.xDiaScale = Math.min(15, displayOpts.xDiaScale + 0.5)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">+</button>
            </div>
            <div class="text-xs text-center mt-1">{displayOpts.xDiaScale.toFixed(1)}</div>
          </div>

          <div class="p-1 grid grid-cols-4 rounded border border-gray-800">
            <div class="col-span-2 text-xs self-center font-medium">Preserve Aspect</div>
            <input type="checkbox" bind:checked={displayOpts.preserveAspectRatio} class="col-span-2 accent-orange-500"/>
          </div>

          <div class="p-1 grid grid-cols-3 rounded border border-gray-800">
            <div class="text-xs self-center">Hide Plot</div>
            <input type="checkbox" bind:checked={displayOpts.showLeftTrack} class="mx-auto accent-orange-500"/>
            <div class="text-xs self-center">Show Plot</div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Edit Panel -->
    {#if editPanel}
      <div class="absolute left-16 top-14 z-40 bg-white rounded-lg shadow-2xl border border-gray-200 flex flex-col" style="width: 420px; max-height: 60vh;">
        <div class="flex items-center justify-between px-3 py-1.5 bg-gradient-to-r from-green-100 to-slate-100 border-b border-gray-200 rounded-t-lg">
          <h3 class="text-sm font-bold text-slate-900">
            {editPanel === 'oh' ? 'Open Hole' : editPanel === 'ch' ? 'Cased Hole' : editPanel === 'cem' ? 'Cementing' : 'Formation Strata'}
          </h3>
          <button onclick={() => { editPanel = null; editIdx = -1; }} class="text-gray-500 hover:text-gray-900 text-xs">✕</button>
        </div>

        <div class="flex-1 overflow-y-auto p-2">
          {#if editPanel === 'oh'}
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-2 py-1 text-center">Bit Size (in)</th>
                  <th class="px-2 py-1 text-center">Top (m)</th>
                  <th class="px-2 py-1 text-center">Bot (m)</th>
                  <th class="px-2 py-1 text-center w-16">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each (getSrc()?.oh ?? []) as row, i}
                  {#if editIdx === i}
                    <tr class="bg-blue-50">
                      <td class="px-1 py-1"><input type="number" bind:value={editData.bitSize} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.top} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.bot} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><div class="flex gap-1 justify-center"><button onclick={saveOHRow} class="px-1 py-0.5 bg-green-500 text-white rounded text-xs">✓</button><button onclick={cancelEdit} class="px-1 py-0.5 bg-gray-400 text-white rounded text-xs">✕</button></div></td>
                    </tr>
                  {:else}
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                      <td class="px-2 py-1.5 text-center">{row.bitSize}</td>
                      <td class="px-2 py-1.5 text-center">{row.top}</td>
                      <td class="px-2 py-1.5 text-center">{row.bot}</td>
                      <td class="px-2 py-1.5"><div class="flex gap-1 justify-center"><button onclick={(e) => { e.stopPropagation(); startEditRow(i, row); }} class="text-blue-600">✎</button><button onclick={(e) => { e.stopPropagation(); deleteOHRow(i); }} class="text-red-600">✕</button></div></td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            <div class="flex justify-end pt-2"><button onclick={addOHRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-300 text-xs">+ Add</button></div>

          {:else if editPanel === 'ch'}
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-2 py-1 text-center">OD (in)</th>
                  <th class="px-2 py-1 text-center">Grade</th>
                  <th class="px-2 py-1 text-center">Top</th>
                  <th class="px-2 py-1 text-center">Bot</th>
                  <th class="px-2 py-1 text-center w-12">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each (getSrc()?.ch ?? getSrc()?.casedHole ?? []) as row, i}
                  {#if editIdx === i}
                    <tr class="bg-blue-50">
                      <td class="px-1 py-1"><input type="number" bind:value={editData.od} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><input type="text" bind:value={editData.grade} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.top} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.bot} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><div class="flex gap-1 justify-center"><button onclick={saveCHRow} class="px-1 py-0.5 bg-green-500 text-white rounded text-xs">✓</button><button onclick={cancelEdit} class="px-1 py-0.5 bg-gray-400 text-white rounded text-xs">✕</button></div></td>
                    </tr>
                  {:else}
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                      <td class="px-2 py-1.5 text-center">{row.od}</td>
                      <td class="px-2 py-1.5 text-center">{row.grade ?? '-'}</td>
                      <td class="px-2 py-1.5 text-center">{row.top}</td>
                      <td class="px-2 py-1.5 text-center">{row.bot}</td>
                      <td class="px-2 py-1.5"><div class="flex gap-1 justify-center"><button onclick={(e) => { e.stopPropagation(); startEditRow(i, row); }} class="text-blue-600">✎</button><button onclick={(e) => { e.stopPropagation(); deleteCHRow(i); }} class="text-red-600">✕</button></div></td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            <div class="flex justify-end pt-2"><button onclick={addCHRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-300 text-xs">+ Add</button></div>

          {:else if editPanel === 'cem'}
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-2 py-1 text-center">OD (in)</th>
                  <th class="px-2 py-1 text-center">Top (m)</th>
                  <th class="px-2 py-1 text-center">Bot (m)</th>
                  <th class="px-2 py-1 text-center w-12">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each (getSrc()?.cementing ?? []) as row, i}
                  {#if editIdx === i}
                    <tr class="bg-blue-50">
                      <td class="px-1 py-1"><input type="number" bind:value={editData.od} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.top} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.bot} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><div class="flex gap-1 justify-center"><button onclick={saveCemRow} class="px-1 py-0.5 bg-green-500 text-white rounded text-xs">✓</button><button onclick={cancelEdit} class="px-1 py-0.5 bg-gray-400 text-white rounded text-xs">✕</button></div></td>
                    </tr>
                  {:else}
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                      <td class="px-2 py-1.5 text-center">{row.od}</td>
                      <td class="px-2 py-1.5 text-center">{row.top}</td>
                      <td class="px-2 py-1.5 text-center">{row.bot}</td>
                      <td class="px-2 py-1.5"><div class="flex gap-1 justify-center"><button onclick={(e) => { e.stopPropagation(); startEditRow(i, row); }} class="text-blue-600">✎</button><button onclick={(e) => { e.stopPropagation(); deleteCemRow(i); }} class="text-red-600">✕</button></div></td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            <div class="flex justify-end pt-2"><button onclick={addCemRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-300 text-xs">+ Add</button></div>

          {:else if editPanel === 'strata'}
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-0">
                <tr>
                  <th class="px-2 py-1 text-center">Strata Name</th>
                  <th class="px-2 py-1 text-center">Top (m)</th>
                  <th class="px-2 py-1 text-center">Color</th>
                  <th class="px-2 py-1 text-center w-12">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each (getSrc()?.strata ?? []) as row, i}
                  {#if editIdx === i}
                    <tr class="bg-blue-50">
                      <td class="px-1 py-1"><input type="text" bind:value={editData.strata} class="w-full border rounded px-1 py-0.5 text-xs"/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.top} class="w-full border rounded px-1 py-0.5 text-xs text-center"/></td>
                      <td class="px-1 py-1"><input type="color" bind:value={editData.color} class="w-full border rounded px-0.5 py-0.5 text-xs"/></td>
                      <td class="px-1 py-1"><div class="flex gap-1 justify-center"><button onclick={saveStrataRow} class="px-1 py-0.5 bg-green-500 text-white rounded text-xs">✓</button><button onclick={cancelEdit} class="px-1 py-0.5 bg-gray-400 text-white rounded text-xs">✕</button></div></td>
                    </tr>
                  {:else}
                    <tr class="hover:bg-gray-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                      <td class="px-2 py-1.5">{row.strata}</td>
                      <td class="px-2 py-1.5 text-center">{row.top}</td>
                      <td class="px-2 py-1.5"><div class="w-6 h-5 rounded border border-gray-300" style="background-color: {row.color}"></div></td>
                      <td class="px-2 py-1.5"><div class="flex gap-1 justify-center"><button onclick={(e) => { e.stopPropagation(); startEditRow(i, row); }} class="text-blue-600">✎</button><button onclick={(e) => { e.stopPropagation(); deleteStrataRow(i); }} class="text-red-600">✕</button></div></td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            <div class="flex justify-end pt-2"><button onclick={addStrataRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-300 text-xs">+ Add</button></div>
          {/if}
        </div>
      </div>
    {/if}

  </div>
{:else}
  <div class="p-4 text-gray-400 text-sm">No schematic data.</div>
{/if}

<style>
  .schematic-toolbar {
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
    font-weight: bold;
    font-size: 14px;
  }

  .tb-btn:hover {
    background: rgba(59, 130, 246, 0.1);
    color: #2563eb;
  }

  .tb-btn.tb-active {
    background: rgba(59, 130, 246, 0.15);
    color: #2563eb;
  }

  .tb-edit {
    font-size: 12px;
  }

  .tb-tip {
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translate(-4px, -50%);
    padding: 5px 9px;
    background: rgba(15, 23, 42, 0.92);
    color: #fff;
    border-radius: 5px;
    white-space: nowrap;
    font-size: 11px;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.15s ease, transform 0.15s ease;
    z-index: 100;
  }

  .group:hover .tb-tip {
    opacity: 1;
    visibility: visible;
    transform: translate(0, -50%);
  }
</style>
