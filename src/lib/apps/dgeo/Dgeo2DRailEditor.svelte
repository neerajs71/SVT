<script>
  /**
   * 2D cross-section editor for a single rail (analogous to pyenthu/dlis
   * CanvasDraw + DrawScene).  Shows the active rail's X-depth profile in SVG
   * with draggable control points, add-point and delete-point tools.
   * Other rails are drawn as grey context lines.
   */

  let {
    rail          = null,   // { z, points: [{x,y}] }
    allRails      = [],     // full rails array for grey context lines
    domX,
    domY,
    onUpdatePoints = null,  // (newPoints: {x,y}[]) => void
  } = $props();

  // SVG coordinate space
  const W = 580, H = 260, PAD = 44;
  const CW = W - PAD;
  const CH = H - PAD;

  const toSvgX  = x  => PAD + ((x  - domX.min) / (domX.max - domX.min)) * CW;
  const toSvgY  = y  => PAD / 2 + ((y - domY.min) / (domY.max - domY.min)) * CH;
  const fromSvgX = px => domX.min + ((px - PAD) / CW)        * (domX.max - domX.min);
  const fromSvgY = py => domY.min + ((py - PAD / 2) / CH) * (domY.max - domY.min);

  let tool    = $state('select');   // 'select' | 'add' | 'delete'
  let dragIdx = $state(null);
  let svgRef  = $state(null);

  // X-axis ticks
  const xTicks = $derived(
    Array.from({ length: 6 }, (_, i) => {
      const v = domX.min + (i / 5) * (domX.max - domX.min);
      return { v, sx: toSvgX(v) };
    })
  );

  // Y-axis ticks (depth)
  const yTicks = $derived(
    Array.from({ length: 5 }, (_, i) => {
      const v = domY.min + (i / 4) * (domY.max - domY.min);
      return { v, sy: toSvgY(v) };
    })
  );

  // Context-line helper — no sort, preserves fold order
  function polyStr(ps) {
    if (!ps || ps.length < 2) return '';
    return ps.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).join(' ');
  }

  function svgCoords(e) {
    const rect = svgRef.getBoundingClientRect();
    const sx = W / rect.width, sy = H / rect.height;
    return {
      x: Math.max(domX.min, Math.min(domX.max, fromSvgX((e.clientX - rect.left) * sx))),
      y: Math.max(domY.min, Math.min(domY.max, fromSvgY((e.clientY - rect.top)  * sy))),
    };
  }

  function onSvgClick(e) {
    if (tool !== 'add' || !rail) return;
    const { x, y } = svgCoords(e);
    // Insert at the correct X position so the profile stays left→right
    const newPts = [...(rail.points ?? []), { x, y }]
      .sort((a, b) => a.x - b.x);
    onUpdatePoints?.(newPts);
  }

  // ── Pointer-event drag (replaces mouse events) ────────────────────────────
  // setPointerCapture routes all subsequent pointer events to the SVG even
  // when the cursor leaves the circle or the SVG boundary.
  function onPointPointerDown(e, idx) {
    if (tool !== 'select') return;
    e.stopPropagation();
    dragIdx = idx;
    svgRef?.setPointerCapture(e.pointerId);
  }

  function onPointClick(e, idx) {
    if (tool !== 'delete') return;
    e.stopPropagation();
    onUpdatePoints?.((rail.points ?? []).filter((_, i) => i !== idx));
  }

  function onSvgPointerMove(e) {
    if (dragIdx === null || !rail || !svgRef) return;
    const { x, y } = svgCoords(e);
    onUpdatePoints?.(
      (rail.points ?? []).map((p, i) => i === dragIdx ? { x, y } : p)
    );
  }

  function onSvgPointerUp() { dragIdx = null; }

  // Cursor shape per tool
  const cursor = $derived(
    tool === 'add'    ? 'crosshair' :
    tool === 'delete' ? 'not-allowed' : 'default'
  );

  // Points in original order for drag/delete index tracking
  const pts = $derived(rail?.points ?? []);
  // Sorted by X for the connecting polyline — always draws left→right
  const ptsLine = $derived([...pts].sort((a, b) => a.x - b.x));
</script>

<div class="flex flex-col h-full bg-white select-none">

  <!-- ── Mini toolbar ─────────────────────────────────────────────────────── -->
  <div class="flex items-center gap-2 px-2 py-1 border-b border-gray-100 bg-gray-50 text-xs flex-shrink-0">
    <span class="font-semibold text-blue-600 font-mono">
      Z = {(rail?.z ?? 0).toFixed(2)} km
    </span>
    <span class="text-gray-300">|</span>

    <!-- Tool picker -->
    <div class="flex gap-0.5">
      {#each [['select','↖','Select / Drag'],['add','+','Add Point'],['delete','✕','Delete Point']] as [t, icon, label]}
        <button
          onclick={() => (tool = t)}
          title={label}
          class="px-1.5 py-0.5 rounded font-mono text-[10px] border transition-colors
                 {tool === t
                   ? 'bg-blue-600 text-white border-blue-600'
                   : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300'}">
          {icon}
        </button>
      {/each}
    </div>

    <span class="ml-auto text-[9px] text-gray-400">{rail?.points?.length ?? 0} pts</span>
  </div>

  <!-- ── SVG canvas ────────────────────────────────────────────────────────── -->
  <div class="flex-1 overflow-hidden">
    <svg
      bind:this={svgRef}
      width={W} height={H}
      viewBox="0 0 {W} {H}"
      style="display:block;width:100%;height:100%;cursor:{cursor}"
      onclick={onSvgClick}
      onpointermove={onSvgPointerMove}
      onpointerup={onSvgPointerUp}>

      <!-- Background -->
      <rect x={PAD} y={PAD/2} width={CW} height={CH}
            fill="#f0f4ff" stroke="#d1d5db" stroke-width="1"/>

      <!-- Grid lines -->
      {#each xTicks as t}
        <line x1={t.sx} y1={PAD/2} x2={t.sx} y2={PAD/2+CH}
              stroke="#c7d2fe" stroke-width="0.5" stroke-dasharray="3,3"/>
      {/each}
      {#each yTicks as t}
        <line x1={PAD} y1={t.sy} x2={PAD+CW} y2={t.sy}
              stroke="#c7d2fe" stroke-width="0.5" stroke-dasharray="3,3"/>
      {/each}

      <!-- Context: other rails in grey -->
      {#each allRails as r}
        {#if r !== rail && (r.points?.length ?? 0) >= 2}
          <polyline
            points={polyStr(r.points)}
            fill="none"
            stroke="#d1d5db"
            stroke-width="1.5"
            stroke-dasharray="5,3"
            stroke-linejoin="round"/>
        {/if}
      {/each}

      <!-- Active rail polyline — drawn sorted left→right -->
      {#if ptsLine.length >= 2}
        {@const pStr = ptsLine.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).join(' ')}
        <polyline points={pStr} fill="none" stroke="#2563eb"
          stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <polyline points={pStr} fill="none" stroke="#1e3a8a"
          stroke-width="0.7" opacity="0.4" stroke-linejoin="round"/>
      {/if}

      <!-- Control points (in insertion order, numbered) -->
      {#each pts as pt, i}
        {@const isActive = dragIdx === i}
        <circle
          cx={toSvgX(pt.x)}
          cy={toSvgY(pt.y)}
          r={isActive ? 8 : 5}
          fill={isActive ? '#ef4444' : 'white'}
          stroke={isActive ? '#b91c1c' : '#2563eb'}
          stroke-width="2"
          style="cursor:{tool === 'select' ? 'grab' : tool === 'delete' ? 'not-allowed' : 'crosshair'}"
          onpointerdown={e => onPointPointerDown(e, i)}
          onclick={e => onPointClick(e, i)}/>
        <!-- Coordinate label on hover-like: show on active only -->
        {#if isActive}
          <text x={toSvgX(pt.x) + 9} y={toSvgY(pt.y) - 6}
                font-size="8" fill="#b91c1c" font-weight="bold">
            {pt.x.toFixed(1)}, {Math.round(pt.y)}m
          </text>
        {/if}
      {/each}

      <!-- X-axis labels -->
      {#each xTicks as t}
        <line x1={t.sx} y1={PAD/2+CH} x2={t.sx} y2={PAD/2+CH+4}
              stroke="#9ca3af" stroke-width="1"/>
        <text x={t.sx} y={PAD/2+CH+13} text-anchor="middle" font-size="8" fill="#9ca3af">
          {t.v.toFixed(1)}
        </text>
      {/each}
      <text x={PAD+CW/2} y={H-2} text-anchor="middle" font-size="8" fill="#9ca3af">
        Distance (km)
      </text>

      <!-- Y-axis labels (depth) -->
      {#each yTicks as t}
        <line x1={PAD-4} y1={t.sy} x2={PAD} y2={t.sy}
              stroke="#9ca3af" stroke-width="1"/>
        <text x={PAD-6} y={t.sy+3} text-anchor="end" font-size="8" fill="#9ca3af">
          {Math.round(t.v)}
        </text>
      {/each}
      <text x="9" y={PAD/2+CH/2} text-anchor="middle" font-size="8" fill="#9ca3af"
            transform="rotate(-90 9 {PAD/2+CH/2})">
        Depth (m)
      </text>

      <!-- Border -->
      <rect x={PAD} y={PAD/2} width={CW} height={CH}
            fill="none" stroke="#9ca3af" stroke-width="1"/>
    </svg>
  </div>
</div>
