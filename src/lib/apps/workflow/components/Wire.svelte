<script>
  /**
   * Wire — a bezier cubic SVG path between two ports.
   *
   * Props:
   *   x1, y1   — source port center (canvas coords)
   *   x2, y2   — target port center (canvas coords)
   *   dataType — 'array' | 'scalar' | 'any'
   *   selected — boolean
   *   ghost    — boolean (in-progress drag wire, dashed)
   */
  const {
    x1, y1,
    x2, y2,
    dataType = 'array',
    selected = false,
    ghost = false,
  } = $props();

  const COLOURS = {
    array:  '#3b82f6',
    scalar: '#f97316',
    any:    '#8b5cf6',
  };

  const colour = $derived(COLOURS[dataType] ?? '#9ca3af');

  // Bezier control points — horizontal tangents
  const dx = $derived(Math.max(60, Math.abs(x2 - x1) * 0.5));
  const path = $derived(
    `M ${x1} ${y1} C ${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`
  );
</script>

<path
  d={path}
  fill="none"
  stroke={selected ? '#facc15' : colour}
  stroke-width={selected ? 2.5 : 1.8}
  stroke-dasharray={ghost ? '6 4' : 'none'}
  opacity={ghost ? 0.7 : 0.85}
  stroke-linecap="round"
  pointer-events="stroke"
/>
