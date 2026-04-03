<script>
  /**
   * NodeCanvas — SVG pan/zoom canvas hosting nodes and wires.
   *
   * Props:
   *   nodes           node instance array
   *   wires           wire array
   *   results         Map<nodeId, outputs> from engine
   *   errors          Map<nodeId, errorMsg> from engine
   *   onNodesChange(nodes)
   *   onWiresChange(wires)
   */
  import { NODE_TYPES } from '../nodes/registry.js';
  import { createWire, wouldCycle } from '../format.js';
  import NodeBox from './NodeBox.svelte';
  import Wire   from './Wire.svelte';

  const {
    nodes = [],
    wires = [],
    results = new Map(),
    errors  = new Map(),
    onNodesChange,
    onWiresChange,
  } = $props();

  // ── Viewport (pan + zoom) ─────────────────────────────────────────────────────
  let tx = $state(40);      // translate x
  let ty = $state(40);      // translate y
  let scale = $state(1);

  // ── Drag state ────────────────────────────────────────────────────────────────
  let drag = $state(null);
  // { kind:'node', nodeId, startX, startY, origX, origY }
  // { kind:'pan',  startX, startY, origTx, origTy }

  // ── Wire drawing state ────────────────────────────────────────────────────────
  let wireDrag = $state(null);
  // { fromNodeId, fromPort, x1, y1, mx, my }

  // ── Selection ─────────────────────────────────────────────────────────────────
  let selectedNode = $state(null);
  let selectedWire = $state(null);

  // ── Port centre registry (populated by NodeBox via layout) ────────────────────
  // We derive port positions from node pos + fixed layout offsets.
  const NODE_W      = 180;
  const PORT_OFFSET = 6;   // half port circle diameter — center of port dot

  /**
   * Estimate port position in canvas coordinates.
   * Inputs are on the left edge, outputs on the right edge.
   * We approximate y from port index since we can't measure DOM easily.
   */
  function portPos(nodeId, portKey, side) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return { x: 0, y: 0 };
    const def = NODE_TYPES[node.type];
    if (!def) return { x: 0, y: 0 };

    const HEADER_H  = 28;
    const ROW_H     = 28;
    const TOP_PAD   = 8;

    if (side === 'out') {
      const idx = def.outputs.findIndex(p => p.key === portKey);
      return {
        x: node.pos.x + NODE_W,
        y: node.pos.y + HEADER_H + TOP_PAD + idx * ROW_H + PORT_OFFSET,
      };
    } else {
      const idx = def.inputs.findIndex(p => p.key === portKey);
      return {
        x: node.pos.x,
        y: node.pos.y + HEADER_H + TOP_PAD + idx * ROW_H + PORT_OFFSET,
      };
    }
  }

  // ── Connected ports set (for PortDot styling) ─────────────────────────────────
  const connectedPorts = $derived.by(() => {
    const s = new Set();
    for (const w of wires) {
      s.add(`${w.from[0]}:${w.from[1]}`);
      s.add(`${w.to[0]}:${w.to[1]}`);
    }
    return s;
  });

  // ── SVG canvas event handlers ─────────────────────────────────────────────────

  function svgMouseDown(e) {
    if (e.button !== 0) return;
    // Click on empty canvas → start pan
    if (e.target === e.currentTarget) {
      drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, origTx: tx, origTy: ty };
      selectedNode = null;
      selectedWire = null;
    }
  }

  function svgMouseMove(e) {
    if (wireDrag) {
      // Update ghost wire endpoint
      const rect = e.currentTarget.getBoundingClientRect();
      wireDrag = {
        ...wireDrag,
        mx: (e.clientX - rect.left - tx) / scale,
        my: (e.clientY - rect.top  - ty) / scale,
      };
      return;
    }
    if (!drag) return;

    if (drag.kind === 'pan') {
      tx = drag.origTx + (e.clientX - drag.startX);
      ty = drag.origTy + (e.clientY - drag.startY);
    } else if (drag.kind === 'node') {
      const dx = (e.clientX - drag.startX) / scale;
      const dy = (e.clientY - drag.startY) / scale;
      const updated = nodes.map(n =>
        n.id !== drag.nodeId ? n :
        { ...n, pos: { x: drag.origX + dx, y: drag.origY + dy } }
      );
      onNodesChange?.(updated);
    }
  }

  function svgMouseUp() {
    drag = null;
    wireDrag = null;
  }

  function svgWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    scale = Math.max(0.2, Math.min(3, scale * factor));
  }

  // ── Node interactions ─────────────────────────────────────────────────────────

  function handleNodeDragStart(e, nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    drag = { kind: 'node', nodeId, startX: e.clientX, startY: e.clientY,
             origX: node.pos.x, origY: node.pos.y };
  }

  function handleNodeSelect(nodeId) {
    selectedNode = nodeId;
    selectedWire = null;
  }

  function handleNodeDelete(nodeId) {
    onNodesChange?.(nodes.filter(n => n.id !== nodeId));
    onWiresChange?.(wires.filter(w => w.from[0] !== nodeId && w.to[0] !== nodeId));
    if (selectedNode === nodeId) selectedNode = null;
  }

  function handleParamChange(nodeId, key, value) {
    onNodesChange?.(nodes.map(n =>
      n.id !== nodeId ? n : { ...n, params: { ...n.params, [key]: value } }
    ));
  }

  // ── Port wire dragging ────────────────────────────────────────────────────────

  function handlePortDragStart(e, nodeId, portKey, side) {
    if (side !== 'out') return;
    const pos = portPos(nodeId, portKey, 'out');
    wireDrag = { fromNodeId: nodeId, fromPort: portKey, x1: pos.x, y1: pos.y,
                 mx: pos.x, my: pos.y };
  }

  function handlePortDrop(toNodeId, toPort) {
    if (!wireDrag) return;
    const { fromNodeId, fromPort } = wireDrag;
    wireDrag = null;
    if (fromNodeId === toNodeId) return;
    // Prevent duplicate wires to same input
    const dup = wires.some(w => w.to[0] === toNodeId && w.to[1] === toPort);
    if (dup) return;
    // Prevent cycles
    if (wouldCycle(nodes, wires, fromNodeId, toNodeId)) return;
    const w = createWire(fromNodeId, fromPort, toNodeId, toPort);
    onWiresChange?.([...wires, w]);
  }

  // ── Wire click → select → Delete key ─────────────────────────────────────────

  function handleWireClick(e, wireId) {
    e.stopPropagation();
    selectedWire = wireId;
    selectedNode = null;
  }

  function handleKeyDown(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.target.closest('input,select,textarea')) {
      if (selectedNode) { handleNodeDelete(selectedNode); }
      if (selectedWire) {
        onWiresChange?.(wires.filter(w => w.id !== selectedWire));
        selectedWire = null;
      }
    }
  }

  // ── TrackDisplay inline rendering ─────────────────────────────────────────────

  function getTrackData(nodeId) {
    const out = results.get(nodeId);
    return out?._display ?? null;
  }

  const TRACK_W = 140;
  const NODE_W_TRACK = 200;
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="flex-1 overflow-hidden bg-gray-950 relative"
  onmousedown={svgMouseDown}
  onmousemove={svgMouseMove}
  onmouseup={svgMouseUp}
  onwheel={svgWheel}
>
  <!-- Grid background -->
  <svg
    class="absolute inset-0 w-full h-full pointer-events-none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <pattern id="smallGrid" width={20 * scale} height={20 * scale}
        x={tx % (20 * scale)} y={ty % (20 * scale)}
        patternUnits="userSpaceOnUse">
        <path d={`M ${20 * scale} 0 L 0 0 0 ${20 * scale}`}
          fill="none" stroke="#1f2937" stroke-width="0.5"/>
      </pattern>
      <pattern id="grid" width={100 * scale} height={100 * scale}
        x={tx % (100 * scale)} y={ty % (100 * scale)}
        patternUnits="userSpaceOnUse">
        <rect width={100 * scale} height={100 * scale} fill="url(#smallGrid)"/>
        <path d={`M ${100 * scale} 0 L 0 0 0 ${100 * scale}`}
          fill="none" stroke="#374151" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#grid)"/>
  </svg>

  <!-- Wires layer (SVG) -->
  <svg
    class="absolute inset-0 w-full h-full pointer-events-none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <g transform="translate({tx},{ty}) scale({scale})">
      {#each wires as w (w.id)}
        {@const p1 = portPos(w.from[0], w.from[1], 'out')}
        {@const p2 = portPos(w.to[0],   w.to[1],   'in')}
        {@const def = NODE_TYPES[nodes.find(n => n.id === w.from[0])?.type]}
        {@const dt  = def?.outputs.find(o => o.key === w.from[1])?.dataType ?? 'array'}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <g
          role="button"
          tabindex="-1"
          style="pointer-events:stroke; cursor:pointer;"
          onclick={e => handleWireClick(e, w.id)}
        >
          <Wire x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
            dataType={dt} selected={selectedWire === w.id} />
        </g>
      {/each}

      <!-- Ghost wire while dragging -->
      {#if wireDrag}
        <Wire x1={wireDrag.x1} y1={wireDrag.y1}
          x2={wireDrag.mx} y2={wireDrag.my}
          ghost={true} />
      {/if}
    </g>
  </svg>

  <!-- Nodes layer (HTML positioned inside scaled div) -->
  <div
    class="absolute inset-0 overflow-visible pointer-events-none"
    style="transform-origin: 0 0; transform: translate({tx}px,{ty}px) scale({scale});"
  >
    {#each nodes as node (node.id)}
      {@const def = NODE_TYPES[node.type]}
      {#if def}
        <div class="pointer-events-auto absolute" style="left:0;top:0;">
          <NodeBox
            {def}
            {node}
            selected={selectedNode === node.id}
            error={errors.get(node.id) ?? null}
            {connectedPorts}
            onParamChange={handleParamChange}
            onDragStart={handleNodeDragStart}
            onPortDragStart={handlePortDragStart}
            onPortDrop={handlePortDrop}
            onDelete={handleNodeDelete}
            onSelect={handleNodeSelect}
          />

          <!-- Inline track display for TrackDisplay nodes -->
          {#if def.id === 'TrackDisplay'}
            {@const td = getTrackData(node.id)}
            {#if td}
              {@const CHART_H = td.height ?? 300}
              {@const MARGIN  = 30}
              {@const W       = TRACK_W + MARGIN}
              {@const dMin    = td.depths[0] ?? 0}
              {@const dMax    = td.depths[td.depths.length - 1] ?? 1}
              {@const dRange  = dMax - dMin || 1}
              {@const xRange  = (td.xMax - td.xMin) || 1}
              <div
                class="absolute"
                style="left:{node.pos.x}px; top:{node.pos.y + 90}px; width:{W}px;"
              >
                <svg width={W} height={CHART_H + 20} class="bg-gray-900 rounded border border-gray-700">
                  <!-- depth axis -->
                  {#each [0,0.25,0.5,0.75,1] as t}
                    {@const y = 10 + t * CHART_H}
                    {@const d = dMin + t * dRange}
                    <line x1={MARGIN} y1={y} x2={W} y2={y} stroke="#374151" stroke-width="0.5" stroke-dasharray="3 3"/>
                    <text x={MARGIN - 2} y={y + 3} text-anchor="end" font-size="8" fill="#6b7280">{d.toFixed(0)}</text>
                  {/each}
                  <!-- curve polyline -->
                  {#if td.depths.length > 1}
                    {@const pts = Array.from(td.depths).map((d, i) => {
                      const x = MARGIN + ((td.values[i] - td.xMin) / xRange) * TRACK_W;
                      const y = 10 + ((d - dMin) / dRange) * CHART_H;
                      return `${x},${y}`;
                    }).join(' ')}
                    <polyline points={pts} fill="none" stroke={td.colour} stroke-width="1.5" opacity="0.9"/>
                  {/if}
                  <!-- label -->
                  <text x={MARGIN + TRACK_W / 2} y={CHART_H + 16}
                    text-anchor="middle" font-size="9" fill="#9ca3af">{td.label}</text>
                </svg>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
  </div>

  <!-- Hint -->
  {#if nodes.length === 0}
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <p class="text-gray-600 text-sm">Click a node in the palette to add it, then connect ports</p>
    </div>
  {/if}
</div>
