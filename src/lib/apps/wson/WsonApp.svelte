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
  const DIA_SCALE = 8;     // px per inch of diameter (matches dlis repo default xDiaScale)
  const PERF_DIST = 3;     // metres between perf arrows

  // ── Computed geometry ────────────────────────────────────────────────────
  const geo = $derived.by(() => {
    if (!wson) return null;
    const oh   = wson.oh   ?? wson.openHole   ?? [];
    const ch   = wson.ch   ?? wson.casedHole  ?? [];
    const cem  = wson.cementing   ?? [];
    const str  = wson.strata      ?? [];
    const perf = wson.perforations ?? [];

    const maxBitSize = oh.length  ? Math.max(...oh.map(s => s.bitSize)) : 20;
    const maxOD      = ch.length  ? Math.max(...ch.map(c => c.od))      : maxBitSize;
    const maxR       = Math.max(maxBitSize, maxOD) / 2;

    // Depth range
    const allD = [
      ...oh.map(s => s.bot),
      ...ch.map(c => c.bot),
      ...str.map(s => s.top),
      ...perf.map(p => p.bot),
    ];
    const maxDepth = allD.length ? Math.max(...allD) + 50 : 1000;

    // Y scale: fit within reasonable height (min 400px, max 900px)
    const yScale = Math.min(Math.max(400 / maxDepth, 0.08), 0.35);

    const centerX = STRATA_W + RULER_W + maxR * DIA_SCALE + 20;
    const totalW  = centerX + maxR * DIA_SCALE + 40;
    const totalH  = HEADER_H + maxDepth * yScale + 40;

    const sy   = d => HEADER_H + d * yScale;
    const sxR  = r => centerX + r * DIA_SCALE;   // right side at radius r
    const sxL  = r => centerX - r * DIA_SCALE;   // left  side at radius r

    // Well name
    const wellName =
      wson.inputHeader?.wellName?.value ??
      wson.inputHeader?.WELL?.value ??
      wson.wellName ?? tab.name ?? 'Well Schematic';

    // Depth ruler ticks (niced interval)
    const niceInterval = (() => {
      const raw = maxDepth / 8;
      const exp = Math.pow(10, Math.floor(Math.log10(raw || 1)));
      return [1, 2, 5, 10].map(m => m * exp).find(m => maxDepth / m <= 12) ?? raw;
    })();
    const rulerTicks = [];
    for (let d = 0; d <= maxDepth; d += niceInterval) rulerTicks.push(d);

    return { oh, ch, cem, str, perf, maxDepth, yScale, centerX, totalW, totalH,
             sy, sxR, sxL, wellName, rulerTicks, maxR };
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

  /** Find the open-hole section covering a given depth (returns first match) */
  function ohForDepth(d, oh) {
    for (const s of oh) {
      if (d >= s.top - 1 && d <= s.bot + 1) return s;
    }
    return null;
  }

  /** Return readable text color for a background hex */
  function textColor(hex) {
    const h = (hex ?? '#888').replace('#', '').padEnd(6, '0');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? '#111' : '#eee';
  }

  /** Build SVG path string for one perf interval (both left & right arrows) */
  function perfArrows(perf, sy, sxL, sxR) {
    let paths = '';
    let intervals = Math.max(1, Math.round((perf.bot - perf.top) / PERF_DIST));
    const tip = (perf.perfID ?? 7) / 2;   // casing inner radius
    const ext = tip + 5;                   // arrowhead tip extension (px / DIA_SCALE handled by sxL/sxR)
    for (let i = 0; i < intervals; i++) {
      const t   = perf.top + PERF_DIST * i;
      const mid = t + PERF_DIST / 2;
      const b   = t + PERF_DIST;
      // Left arrow (pointing outward = decreasing x)
      const lx0 = sxL(tip), lx1 = sxL(ext);
      paths += `M${lx0},${sy(t)} L${lx1},${sy(mid)} L${lx0},${sy(b)} Z `;
      // Right arrow (pointing outward = increasing x)
      const rx0 = sxR(tip), rx1 = sxR(ext);
      paths += `M${rx0},${sy(t)} L${rx1},${sy(mid)} L${rx0},${sy(b)} Z `;
    }
    return paths;
  }

  /** Cement bands (left + right annulus between casing OD and open hole ID) */
  function cementRects(cem, oh, sy, sxL, sxR) {
    const rects = [];
    for (const c of cem) {
      // Find the OH bitSize covering the midpoint of this cement section
      const mid    = (c.top + c.bot) / 2;
      const ohSec  = ohForDepth(mid, oh);
      if (!ohSec) continue;
      const holeR  = ohSec.bitSize / 2;
      const casingR = c.od / 2;
      if (holeR <= casingR) continue;   // no annulus
      rects.push({ top: c.top, bot: c.bot, holeR, casingR });
    }
    return rects;
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
  {@const { oh, ch, cem, str, perf, sy, sxL, sxR, wellName,
            rulerTicks, totalW, totalH, centerX } = geo}

  <!-- Info bar -->
  <div class="flex items-center gap-4 px-3 py-1.5 text-xs text-gray-500 border-b border-gray-200 flex-wrap">
    <span class="font-semibold text-gray-700">{wellName}</span>
    {#if oh.length}<span>OH sections: {oh.length}</span>{/if}
    {#if ch.length}<span>Casings: {ch.length}</span>{/if}
    {#if cem.length}<span>Cement: {cem.length}</span>{/if}
    {#if perf.length}<span>Perforations: {perf.length}</span>{/if}
    {#if str.length}<span>Strata: {str.length}</span>{/if}
  </div>

  <!-- SVG schematic (horizontally scrollable) -->
  <div class="overflow-auto bg-white">
    <svg
      width={totalW}
      height={totalH}
      xmlns="http://www.w3.org/2000/svg"
      class="font-mono"
      style="display:block"
    >
      <defs>
        <!-- Cement fill pattern: small grey dots on white -->
        <pattern id="cement-fill" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <rect width="6" height="6" fill="#e8e8e8"/>
          <circle cx="3" cy="3" r="1.2" fill="#888"/>
        </pattern>
      </defs>

      <!-- ── Header ─────────────────────────────────────────────────────── -->
      <rect x="0" y="0" width={totalW} height={HEADER_H} fill="#1e3a5f"/>
      <text x={totalW / 2} y={HEADER_H / 2 + 6}
            text-anchor="middle" fill="white" font-size="14" font-weight="bold"
            font-family="sans-serif">
        {wellName}
      </text>

      <!-- ── Strata bands ──────────────────────────────────────────────── -->
      {#each str as s, i}
        {@const top  = sy(s.top)}
        {@const bot  = i < str.length - 1 ? sy(str[i + 1].top) : sy(geo.maxDepth)}
        {@const h    = bot - top}
        <rect x="0" y={top} width={STRATA_W} height={h}
              fill={s.color ?? '#aaa'} stroke="#333" stroke-width="0.5"/>
        {#if h > 14}
          <text x="4" y={top + 13} font-size="9" fill={textColor(s.color ?? '#aaa')}
                font-family="sans-serif" clip-path="url(#strata-clip-{i})">
            {s.strata}
          </text>
          <text x="4" y={top + 22} font-size="8" fill={textColor(s.color ?? '#aaa')}
                font-family="sans-serif">
            {s.top.toFixed(0)}m
          </text>
        {/if}
      {/each}

      <!-- ── Depth ruler ────────────────────────────────────────────────── -->
      <rect x={STRATA_W} y={HEADER_H} width={RULER_W}
            height={totalH - HEADER_H} fill="#f0f0f0" stroke="#ccc" stroke-width="0.5"/>
      {#each rulerTicks as d}
        {@const y = sy(d)}
        <line x1={STRATA_W} y1={y} x2={STRATA_W + RULER_W} y2={y}
              stroke="#999" stroke-width="0.8"/>
        <text x={STRATA_W + RULER_W - 3} y={y + 4} font-size="8" text-anchor="end"
              fill="#444" font-family="sans-serif">{d}</text>
      {/each}

      <!-- ── Centre line (dashed) ──────────────────────────────────────── -->
      <line x1={centerX} y1={HEADER_H} x2={centerX} y2={totalH}
            stroke="#aaa" stroke-width="0.5" stroke-dasharray="4 4"/>

      <!-- ── Open hole (dashed pink/purple fill) ───────────────────────── -->
      {#each oh as s}
        {@const x   = sxL(s.bitSize / 2)}
        {@const w   = sxR(s.bitSize / 2) - x}
        {@const y   = sy(s.top)}
        {@const ht  = sy(s.bot) - y}
        <rect {x} {y} width={w} height={ht}
              fill="#f3e8ff" stroke="#9333ea" stroke-width="1" stroke-dasharray="5 3"/>
        <text x={sxR(s.bitSize / 2) + 3} y={y + 10} font-size="8" fill="#7c3aed"
              font-family="sans-serif">{s.bitSize}"</text>
      {/each}

      <!-- ── Cement fill ───────────────────────────────────────────────── -->
      {#each cementRects(cem, oh, sy, sxL, sxR) as cr}
        {@const y  = sy(cr.top)}
        {@const ht = sy(cr.bot) - y}
        <!-- Left band -->
        <rect x={sxL(cr.holeR)} y={y}
              width={sxL(cr.casingR) - sxL(cr.holeR)} height={ht}
              fill="url(#cement-fill)"/>
        <!-- Right band -->
        <rect x={sxR(cr.casingR)} y={y}
              width={sxR(cr.holeR) - sxR(cr.casingR)} height={ht}
              fill="url(#cement-fill)"/>
      {/each}

      <!-- ── Cased hole (azure rectangles with grade label) ────────────── -->
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

      <!-- ── Perforations ──────────────────────────────────────────────── -->
      {#each perf as p}
        <path d={perfArrows(p, sy, sxL, sxR)}
              fill={p.color ?? '#e53e3e'} stroke="none" opacity="0.85"/>
      {/each}

      <!-- ── TD marker ──────────────────────────────────────────────────── -->
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
{:else}
  <div class="p-4 text-gray-400 text-sm">No schematic data.</div>
{/if}
