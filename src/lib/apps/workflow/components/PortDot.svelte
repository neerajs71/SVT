<script>
  /**
   * PortDot — a single input or output port circle on a node.
   *
   * Props:
   *   side       'in' | 'out'
   *   dataType   'array' | 'scalar' | 'any'
   *   label      string
   *   connected  boolean
   *   nodeId     string
   *   portKey    string
   *   onDragStart(e, nodeId, portKey, side)   — called on mousedown (output ports)
   *   onDrop(nodeId, portKey)                 — called when ghost wire released here
   */
  const {
    side,
    dataType = 'array',
    label = '',
    connected = false,
    nodeId,
    portKey,
    onDragStart,
    onDrop,
  } = $props();

  const COLOURS = {
    array:  '#3b82f6',   // blue
    scalar: '#f97316',   // orange
    any:    '#8b5cf6',   // purple
  };

  const colour = $derived(COLOURS[dataType] ?? '#9ca3af');

  function handleMouseDown(e) {
    if (side === 'out' && onDragStart) {
      e.stopPropagation();
      onDragStart(e, nodeId, portKey, side);
    }
  }

  function handleMouseUp(e) {
    if (side === 'in' && onDrop) {
      e.stopPropagation();
      onDrop(nodeId, portKey);
    }
  }
</script>

<div
  class="flex items-center gap-1 select-none"
  class:flex-row-reverse={side === 'out'}
>
  <!-- Port circle -->
  <div
    role="button"
    tabindex="-1"
    class="w-3 h-3 rounded-full border-2 cursor-crosshair shrink-0 transition-transform hover:scale-125"
    style="
      background: {connected ? colour : 'white'};
      border-color: {colour};
    "
    onmousedown={handleMouseDown}
    onmouseup={handleMouseUp}
  ></div>

  <!-- Label -->
  {#if label}
    <span class="text-[10px] text-gray-500 leading-none truncate max-w-[70px]">{label}</span>
  {/if}
</div>
