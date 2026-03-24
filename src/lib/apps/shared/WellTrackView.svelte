<script>
  /**
   * Multi-track composite well log display.
   *
   * Props:
   *   tracks     — array of { name, units, depths[], values[], vMin, vMax }
   *   indexName  — label for the depth axis (e.g. 'DEPT', 'MD')
   *   dMin/dMax  — global depth extents (used for shared Y scale)
   */

  let { tracks = [], indexName = 'DEPTH', dMin = 0, dMax = 1 } = $props();

  // Layout constants
  const DEPTH_W  = 52;   // width of the left depth axis column
  const TRACK_W  = 88;   // width of each curve track
  const HEADER_H = 40;   // space above the chart area for curve names
  const CHART_H  = 520;  // chart body height
  const TOTAL_H  = HEADER_H + CHART_H;

  const dRange   = $derived(dMax - dMin || 1);
  const totalW   = $derived(DEPTH_W + TRACK_W * tracks.length);

  // Shared Y scale: depth → SVG pixel (min depth at top, max at bottom)
  function sy(d) {
    return HEADER_H + ((d - dMin) / dRange) * CHART_H;
  }

  // 9 evenly-spaced depth ticks
  const depthTicks = $derived(
    Array.from({ length: 9 }, (_, i) => {
      const d = dMin + (i / 8) * dRange;
      return { d, py: sy(d) };
    })
  );

  // Pre-compute per-track polyline points
  const computed = $derived(
    tracks.map((track, ti) => {
      const { depths, values, vMin, vMax } = track;
      const vRange = (vMax - vMin) || 1;
      const trackX  = DEPTH_W + ti * TRACK_W;
      const innerW  = TRACK_W - 4;  // 2px margin each side

      const points = depths
        .map((d, i) => {
          const px = trackX + 2 + ((values[i] - vMin) / vRange) * innerW;
          return `${px.toFixed(1)},${sy(d).toFixed(1)}`;
        })
        .join(' ');

      return { trackX, points, vMin, vMax };
    })
  );

  function fmtDepth(n) {
    return Number.isFinite(n) ? Math.round(n).toString() : '—';
  }

  function fmtVal(n) {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 10000 || (Math.abs(n) < 0.001 && n !== 0))
      return n.toExponential(1);
    return parseFloat(n.toPrecision(4)).toString();
  }
</script>

<!-- Horizontally scrollable wrapper -->
<div class="overflow-x-auto overflow-y-auto border border-gray-200 rounded" style="max-height:{TOTAL_H}px">
  <svg
    width={totalW}
    height={TOTAL_H}
    viewBox="0 0 {totalW} {TOTAL_H}"
    style="display:block;min-width:{totalW}px"
  >
    <!-- ── Depth-axis background ── -->
    <rect x="0" y="0" width={DEPTH_W} height={TOTAL_H} fill="#f3f4f6"/>

    <!-- ── Track backgrounds ── -->
    {#each tracks as _, ti}
      {@const tx = DEPTH_W + ti * TRACK_W}
      <rect x={tx} y={HEADER_H} width={TRACK_W} height={CHART_H}
            fill={ti % 2 === 0 ? '#ffffff' : '#fafafa'}/>
      <!-- Track left border -->
      <line x1={tx} y1="0" x2={tx} y2={TOTAL_H}
            stroke="#d1d5db" stroke-width="1"/>
    {/each}

    <!-- ── Horizontal grid lines (shared across all tracks) ── -->
    {#each depthTicks as t}
      <line x1={DEPTH_W} y1={t.py} x2={totalW} y2={t.py}
            stroke="#e5e7eb" stroke-width="0.5"/>
    {/each}

    <!-- ── Depth axis tick labels ── -->
    {#each depthTicks as t}
      <text
        x={DEPTH_W - 4} y={t.py}
        text-anchor="end" dominant-baseline="middle"
        font-size="7.5" fill="#6b7280"
      >{fmtDepth(t.d)}</text>
    {/each}

    <!-- ── Depth axis label (rotated) ── -->
    <text
      x={DEPTH_W / 2 - 6} y={HEADER_H + CHART_H / 2}
      transform="rotate(-90,{DEPTH_W / 2 - 6},{HEADER_H + CHART_H / 2})"
      text-anchor="middle" font-size="7.5" fill="#9ca3af"
    >{indexName}</text>

    <!-- ── Per-track headers, value ranges, and curves ── -->
    {#each tracks as track, ti}
      {@const c = computed[ti]}

      <!-- Curve name -->
      <text
        x={c.trackX + TRACK_W / 2} y="12"
        text-anchor="middle" font-size="8.5" font-weight="600" fill="#1f2937"
      >{track.name.length > 9 ? track.name.slice(0, 9) : track.name}</text>

      <!-- Units -->
      {#if track.units}
        <text
          x={c.trackX + TRACK_W / 2} y="23"
          text-anchor="middle" font-size="7" fill="#9ca3af"
        >{track.units}</text>
      {/if}

      <!-- Min / max value -->
      <text
        x={c.trackX + 3} y={HEADER_H - 4}
        text-anchor="start" font-size="6.5" fill="#6b7280"
      >{fmtVal(c.vMin)}</text>
      <text
        x={c.trackX + TRACK_W - 3} y={HEADER_H - 4}
        text-anchor="end" font-size="6.5" fill="#6b7280"
      >{fmtVal(c.vMax)}</text>

      <!-- The curve -->
      {#if track.depths.length > 0}
        <polyline
          points={c.points}
          fill="none" stroke="#15803d" stroke-width="1.2"
          stroke-linejoin="round" stroke-linecap="round"
        />
      {:else}
        <text
          x={c.trackX + TRACK_W / 2} y={HEADER_H + CHART_H / 2}
          text-anchor="middle" font-size="7" fill="#d1d5db"
        >no data</text>
      {/if}
    {/each}

    <!-- ── Right border ── -->
    <line x1={totalW} y1="0" x2={totalW} y2={TOTAL_H}
          stroke="#d1d5db" stroke-width="1"/>

    <!-- ── Header / chart separator ── -->
    <line x1="0" y1={HEADER_H} x2={totalW} y2={HEADER_H}
          stroke="#9ca3af" stroke-width="1"/>

    <!-- ── Bottom border ── -->
    <line x1="0" y1={TOTAL_H} x2={totalW} y2={TOTAL_H}
          stroke="#d1d5db" stroke-width="1"/>
  </svg>
</div>
