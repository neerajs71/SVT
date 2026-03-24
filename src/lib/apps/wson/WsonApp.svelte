<script>
  import { onMount } from 'svelte';

  const { tab } = $props();

  let loading = $state(true);
  let error   = $state('');
  let wson    = $state(null);

  // ── Layout constants ─────────────────────────────────────────────────────
  const STRATA_W  = 110;   // strata column width (px)
  const RULER_W   = 44;    // depth ruler width (px)
  const HEADER_H  = 52;    // top header height (px)
  const DIA_SCALE = 8;     // px per inch of diameter
  const PERF_DIST = 3;     // metres between perf arrows

  // ── Toolbar visibility states ─────────────────────────────────────────────
  let showInfoBar      = $state(true);
  let showStrata       = $state(true);
  let showOpenHole     = $state(true);
  let showCasing       = $state(true);
  let showCement       = $state(true);
  let showCompletions  = $state(true);
  let showPerforations = $state(true);

  // ── Component JSON rendering ──────────────────────────────────────────────
  // Cache: jsonName → parsed JSON object
  const compJsonCache = new Map();

  // Per-completion SVG strings (index → html string | null)
  let compSvgStrings = $state([]);

  /**
   * Converts component JSON data to SVG path content using our linear scale.
   * Mirrors the DLIS buildComponent.ts logic without warpjs deviation.
   */
  function jsonToSvgContent(componentData, comp, compIndex, g) {
    const { elements, width: jw, height: jh } = componentData;
    if (!elements || !jw || !jh) return '';

    const { centerX, yScale } = g;
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
        // Map JSON space → physical space → SVG pixels
        const diamIn  = (x - jw / 2) * (compOD / jw);
        const depthM  = compTop + (y * compLength / jh);
        const svgX    = (centerX + diamIn * DIA_SCALE).toFixed(2);
        const svgY    = (HEADER_H + depthM * yScale).toFixed(2);

        if (directive === 'moveTo')  segs.push(`M${svgX} ${svgY}`);
        else if (directive === 'lineTo')  segs.push(`L${svgX} ${svgY}`);
        else if (directive === 'close')   segs.push('Z');
      }
      if (segs.length === 0) continue;

      // Fill
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

  /** Fetch component JSON (with in-memory cache) */
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

  /** Load SVG strings for all completions whenever geo changes */
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

  // ── Computed geometry ────────────────────────────────────────────────────
  const geo = $derived.by(() => {
    if (!wson) return null;
    const src  = wson.wellData?.[0] ?? wson;
    const oh   = src.oh   ?? src.openHole   ?? [];
    const ch   = src.ch   ?? src.casedHole  ?? [];
    const cem  = src.cementing   ?? [];
    const str  = src.strata      ?? [];
    const perf = src.perforations ?? [];
    const completionsRaw = src.completions ?? [];

    const maxBitSize = oh.length ? Math.max(...oh.map(s => s.bitSize)) : 20;
    const maxOD      = ch.length ? Math.max(...ch.map(c => c.od))      : maxBitSize;
    const maxR       = Math.max(maxBitSize, maxOD) / 2;

    const allD = [
      ...oh.map(s => s.bot),
      ...ch.map(c => c.bot),
      ...str.map(s => s.top),
      ...perf.map(p => p.bot),
    ];
    const maxDepth = allD.length ? Math.max(...allD) + 50 : 1000;

    const yScale = Math.min(Math.max(400 / maxDepth, 0.08), 0.35);

    const centerX = STRATA_W + RULER_W + maxR * DIA_SCALE + 20;
    const totalW  = centerX + maxR * DIA_SCALE + 80;
    const totalH  = HEADER_H + maxDepth * yScale + 40;

    const sy   = d => HEADER_H + d * yScale;
    const sxR  = r => centerX + r * DIA_SCALE;
    const sxL  = r => centerX - r * DIA_SCALE;

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

    // Stack completions top→bottom (they have length, not top/bot)
    let compCursor = 0;
    const completions = completionsRaw.map(c => {
      const _top = compCursor;
      compCursor += (c.length ?? 0);
      return { ...c, _top, _bot: compCursor };
    });

    return { oh, ch, cem, str, perf, completions, maxDepth, yScale, centerX,
             totalW, totalH, sy, sxR, sxL, wellName, rulerTicks, maxR };
  });

  // ── Load file ─────────────────────────────────────────────────────────────
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

  // ── Helpers ───────────────────────────────────────────────────────────────

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

  /** Classify a completion into a renderable type */
  function compTypeOf(comp) {
    const key = ((comp.tool_comp ?? '') + ' ' + (comp.description ?? '')).toLowerCase();
    if (key.includes('hanger'))  return 'hanger';
    if (key.includes('packer'))  return 'packer';
    if (key.includes('ina') || key.includes('icd') || key.includes('inflow') || key.includes('nozzle')) return 'icd';
    if (key.includes('liner'))   return 'liner';
    // tbgJoints, MISC.TUBING, etc.
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
  {@const { oh, ch, cem, str, perf, completions, sy, sxL, sxR, wellName,
            rulerTicks, totalW, totalH, centerX } = geo}

  <!-- Info bar (toggleable) -->
  {#if showInfoBar}
    <div class="flex items-center gap-4 px-3 py-1.5 text-xs text-gray-500 border-b border-gray-200 flex-wrap">
      <span class="font-semibold text-gray-700">{wellName}</span>
      {#if oh.length}<span>OH: {oh.length}</span>{/if}
      {#if ch.length}<span>Casing: {ch.length}</span>{/if}
      {#if cem.length}<span>Cement: {cem.length}</span>{/if}
      {#if completions.length}<span>Completions: {completions.length}</span>{/if}
      {#if perf.length}<span>Perforations: {perf.length}</span>{/if}
      {#if str.length}<span>Strata: {str.length}</span>{/if}
    </div>
  {/if}

  <!-- Toolbar + SVG layout -->
  <div class="flex overflow-hidden" style="height: calc(100% - {showInfoBar ? 30 : 0}px)">

    <!-- ── Side toolbar ──────────────────────────────────────────────────── -->
    <div class="schematic-toolbar">

      <!-- Info bar toggle -->
      <div class="tb-item group">
        <button
          type="button"
          class="tb-btn"
          class:tb-active={showInfoBar}
          onclick={() => (showInfoBar = !showInfoBar)}
          aria-label="Well Header"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <circle cx="8" cy="8" r="6"/>
            <line x1="8" y1="7" x2="8" y2="11"/>
            <circle cx="8" cy="5.5" r="0.6" fill="currentColor" stroke="none"/>
          </svg>
        </button>
        <span class="tb-tip">Well Header</span>
      </div>

      <!-- Completions toggle -->
      <div class="tb-item group">
        <button
          type="button"
          class="tb-btn"
          class:tb-active={showCompletions}
          onclick={() => (showCompletions = !showCompletions)}
          aria-label="Completions"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <line x1="6" y1="2" x2="6" y2="14"/>
            <line x1="10" y1="2" x2="10" y2="14"/>
            <line x1="6" y1="5" x2="10" y2="5"/>
            <line x1="6" y1="9" x2="10" y2="9"/>
          </svg>
        </button>
        <span class="tb-tip">Completions</span>
      </div>

      <!-- Perforations toggle -->
      <div class="tb-item group">
        <button
          type="button"
          class="tb-btn"
          class:tb-active={showPerforations}
          onclick={() => (showPerforations = !showPerforations)}
          aria-label="Perforations"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <line x1="2" y1="5" x2="9" y2="5"/>
            <polyline points="7,3 10,5 7,7"/>
            <line x1="2" y1="11" x2="9" y2="11"/>
            <polyline points="7,9 10,11 7,13"/>
          </svg>
        </button>
        <span class="tb-tip">Perforations</span>
      </div>

      <!-- Strata toggle -->
      <div class="tb-item group">
        <button
          type="button"
          class="tb-btn"
          class:tb-active={showStrata}
          onclick={() => (showStrata = !showStrata)}
          aria-label="Formation Strata"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <line x1="2" y1="4" x2="14" y2="4"/>
            <line x1="2" y1="8" x2="14" y2="8"/>
            <line x1="2" y1="12" x2="14" y2="12"/>
          </svg>
        </button>
        <span class="tb-tip">Formation Strata</span>
      </div>

      <!-- Open Hole toggle -->
      <div class="tb-item group">
        <button
          type="button"
          class="tb-btn"
          class:tb-active={showOpenHole}
          onclick={() => (showOpenHole = !showOpenHole)}
          aria-label="Open Hole"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <rect x="4" y="2" width="8" height="12" stroke-dasharray="3,2"/>
          </svg>
        </button>
        <span class="tb-tip">Open Hole</span>
      </div>

      <!-- Casing toggle -->
      <div class="tb-item group">
        <button
          type="button"
          class="tb-btn"
          class:tb-active={showCasing}
          onclick={() => (showCasing = !showCasing)}
          aria-label="Casing"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
            <rect x="4" y="2" width="8" height="12"/>
          </svg>
        </button>
        <span class="tb-tip">Casing</span>
      </div>

      <!-- Cement toggle -->
      <div class="tb-item group">
        <button
          type="button"
          class="tb-btn"
          class:tb-active={showCement}
          onclick={() => (showCement = !showCement)}
          aria-label="Cement"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="4"  cy="5"  r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="5"  r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="4"  cy="11" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="11" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="8"  cy="8"  r="1.2" fill="currentColor" stroke="none"/>
          </svg>
        </button>
        <span class="tb-tip">Cement</span>
      </div>

    </div><!-- end toolbar -->

    <!-- ── SVG schematic ──────────────────────────────────────────────────── -->
    <div class="overflow-auto bg-white flex-1">
      <svg
        width={totalW}
        height={totalH}
        xmlns="http://www.w3.org/2000/svg"
        class="font-mono"
        style="display:block"
      >
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

        <!-- ── Header ───────────────────────────────────────────────── -->
        <rect x="0" y="0" width={totalW} height={HEADER_H} fill="#1e3a5f"/>
        <text x={totalW / 2} y={HEADER_H / 2 + 6}
              text-anchor="middle" fill="white" font-size="14" font-weight="bold"
              font-family="sans-serif">{wellName}</text>

        <!-- ── Strata bands ────────────────────────────────────────── -->
        {#if showStrata}
          {#each str as s, i}
            {@const top = sy(s.top)}
            {@const bot = i < str.length - 1 ? sy(str[i + 1].top) : sy(geo.maxDepth)}
            {@const h   = bot - top}
            <rect x="0" y={top} width={STRATA_W} height={h}
                  fill={s.color ?? '#aaa'} stroke="#333" stroke-width="0.5"/>
            {#if h > 14}
              <text x="4" y={top + 13} font-size="9" fill={textColor(s.color ?? '#aaa')}
                    font-family="sans-serif">{s.strata}</text>
              <text x="4" y={top + 22} font-size="8" fill={textColor(s.color ?? '#aaa')}
                    font-family="sans-serif">{s.top.toFixed(0)}m</text>
            {/if}
          {/each}
        {/if}

        <!-- ── Depth ruler ─────────────────────────────────────────── -->
        <rect x={STRATA_W} y={HEADER_H} width={RULER_W}
              height={totalH - HEADER_H} fill="#f0f0f0" stroke="#ccc" stroke-width="0.5"/>
        {#each rulerTicks as d}
          {@const y = sy(d)}
          <line x1={STRATA_W} y1={y} x2={STRATA_W + RULER_W} y2={y}
                stroke="#999" stroke-width="0.8"/>
          <text x={STRATA_W + RULER_W - 3} y={y + 4} font-size="8" text-anchor="end"
                fill="#444" font-family="sans-serif">{d}</text>
        {/each}

        <!-- ── Centre line (dashed) ───────────────────────────────── -->
        <line x1={centerX} y1={HEADER_H} x2={centerX} y2={totalH}
              stroke="#aaa" stroke-width="0.5" stroke-dasharray="4 4"/>

        <!-- ── Open hole ──────────────────────────────────────────── -->
        {#if showOpenHole}
          {#each oh as s}
            {@const x  = sxL(s.bitSize / 2)}
            {@const w  = sxR(s.bitSize / 2) - x}
            {@const y  = sy(s.top)}
            {@const ht = sy(s.bot) - y}
            <rect {x} {y} width={w} height={ht}
                  fill="#f3e8ff" stroke="#9333ea" stroke-width="1" stroke-dasharray="5 3"/>
            <text x={sxR(s.bitSize / 2) + 3} y={y + 10} font-size="8" fill="#7c3aed"
                  font-family="sans-serif">{s.bitSize}"</text>
          {/each}
        {/if}

        <!-- ── Cement fill ─────────────────────────────────────────── -->
        {#if showCement}
          {#each cementRects(cem, oh, sy, sxL, sxR) as cr}
            {@const y  = sy(cr.top)}
            {@const ht = sy(cr.bot) - y}
            <rect x={sxL(cr.holeR)} y={y}
                  width={sxL(cr.casingR) - sxL(cr.holeR)} height={ht}
                  fill="url(#cement-fill)"/>
            <rect x={sxR(cr.casingR)} y={y}
                  width={sxR(cr.holeR) - sxR(cr.casingR)} height={ht}
                  fill="url(#cement-fill)"/>
          {/each}
        {/if}

        <!-- ── Cased hole ──────────────────────────────────────────── -->
        {#if showCasing}
          {#each ch as c}
            {@const x  = sxL(c.od / 2)}
            {@const w  = sxR(c.od / 2) - x}
            {@const y  = sy(c.top)}
            {@const ht = sy(c.bot) - y}
            <rect {x} {y} width={w} height={ht}
                  fill="azure" stroke="#111" stroke-width="1.5"/>
            {#if c.grade}
              <text x={sxR(c.od / 2) + 4} y={y + 22} font-size="8" fill="#1e40af"
                    font-family="sans-serif">{c.od}" {c.grade}</text>
            {/if}
          {/each}
        {/if}

        <!-- ── Completion strings ──────────────────────────────────── -->
        {#if showCompletions}
          {#each completions as comp, i}
            {@const r      = (comp.od ?? 2.875) / 2}
            {@const rOuter = r * (comp.od_multiplier ?? 1.2)}
            {@const ytop   = sy(comp._top)}
            {@const ybot   = sy(comp._bot)}
            {@const xL     = sxL(r)}
            {@const xR     = sxR(r)}
            {@const xOL    = sxL(rOuter)}
            {@const xOR    = sxR(rOuter)}
            {@const ymid   = (ytop + ybot) / 2}
            {@const type   = compTypeOf(comp)}

            {#if compSvgStrings[i]}
              <!-- Rendered from actual component JSON definition -->
              {@html compSvgStrings[i]}
            {:else if type === 'packer'}
              <!-- Fallback: two filled triangles pointing inward -->
              <polygon points="{xOL},{ytop} {xOR},{ytop} {centerX},{ymid}"
                       fill="#f59e0b" stroke="#b45309" stroke-width="0.8" opacity="0.9"/>
              <polygon points="{xOL},{ybot} {xOR},{ybot} {centerX},{ymid}"
                       fill="#f59e0b" stroke="#b45309" stroke-width="0.8" opacity="0.9"/>
              <line x1={xOL} y1={ymid} x2={xOR} y2={ymid} stroke="#b45309" stroke-width="1"/>
            {:else if type === 'hanger'}
              <!-- Fallback: trapezoid shoulder -->
              {@const rWide = r * (comp.od_multiplier ?? 1.5)}
              <polygon points="{sxL(rWide)},{ytop} {sxR(rWide)},{ytop} {xR},{ybot} {xL},{ybot}"
                       fill="#94a3b8" stroke="#475569" stroke-width="1"/>
            {:else if type === 'icd'}
              <!-- Fallback: perforated pipe -->
              <rect x={xL} y={ytop} width={xR - xL} height={ybot - ytop}
                    fill="url(#icd-fill)" stroke="#2563eb" stroke-width="1"/>
              <line x1={xL} y1={ytop} x2={xL} y2={ybot} stroke="#1d4ed8" stroke-width="1.5"/>
              <line x1={xR} y1={ytop} x2={xR} y2={ybot} stroke="#1d4ed8" stroke-width="1.5"/>
            {:else if type === 'liner'}
              <rect x={xL} y={ytop} width={xR - xL} height={ybot - ytop}
                    fill="#f0fdf4" stroke="#16a34a" stroke-width="1.2"/>
            {:else}
              <!-- Fallback: tubing walls -->
              <rect x={xL - 1.5} y={ytop} width="3" height={ybot - ytop} fill="#334155"/>
              <rect x={xR - 1.5} y={ytop} width="3" height={ybot - ytop} fill="#334155"/>
            {/if}

            <!-- Label always shown alongside the component -->
            {#if comp.description && (ybot - ytop) > 10}
              <text x={xOR + 6} y={ymid + 4} font-size="8" fill="#374151"
                    font-family="sans-serif">{comp.description}</text>
            {/if}
          {/each}
        {/if}

        <!-- ── Perforations ────────────────────────────────────────── -->
        {#if showPerforations}
          {#each perf as p}
            <path d={perfArrows(p, sy, sxL, sxR)}
                  fill={p.color ?? '#e53e3e'} stroke="none" opacity="0.85"/>
          {/each}
        {/if}

        <!-- ── TD marker ───────────────────────────────────────────── -->
        {#if oh.length}
          {@const tdDepth = Math.max(...oh.map(s => s.bot))}
          {@const tdY = sy(tdDepth)}
          <line x1={sxL(2)} y1={tdY} x2={sxR(2)} y2={tdY}
                stroke="#dc2626" stroke-width="2"/>
          <text x={sxR(2) + 4} y={tdY + 4} font-size="9" fill="#dc2626"
                font-family="sans-serif">TD {tdDepth}m</text>
        {/if}
      </svg>
    </div>

  </div><!-- end flex row -->
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
  }

  .tb-btn:hover {
    background: rgba(59, 130, 246, 0.1);
    color: #2563eb;
  }

  .tb-btn.tb-active {
    background: rgba(59, 130, 246, 0.15);
    color: #2563eb;
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
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    z-index: 100;
  }

  .tb-tip::after {
    content: '';
    position: absolute;
    top: 50%;
    left: -5px;
    transform: translateY(-50%);
    border: 5px solid transparent;
    border-right-color: rgba(15, 23, 42, 0.92);
  }

  .group:hover .tb-tip,
  .group:focus-within .tb-tip {
    opacity: 1;
    visibility: visible;
    transform: translate(0, -50%);
  }
</style>
