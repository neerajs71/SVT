<script>
  /**
   * NodeBox — renders one node on the canvas.
   *
   * Props:
   *   def        NodeDef from NODE_TYPES
   *   node       node instance { id, type, pos, params }
   *   selected   boolean
   *   error      string | null
   *   connectedPorts  Set<"nodeId:portKey"> — to know which ports are wired
   *   onParamChange(nodeId, key, value)
   *   onDragStart(e, nodeId)        — node header drag
   *   onPortDragStart(e, nodeId, portKey, side)
   *   onPortDrop(nodeId, portKey)
   *   onDelete(nodeId)
   *   onSelect(nodeId)
   */
  import PortDot from './PortDot.svelte';

  const {
    def,
    node,
    selected = false,
    error = null,
    connectedPorts = new Set(),
    onParamChange,
    onDragStart,
    onPortDragStart,
    onPortDrop,
    onDelete,
    onSelect,
  } = $props();

  const NODE_W = 180;

  function isConnected(portKey) {
    return connectedPorts.has(`${node.id}:${portKey}`);
  }

  function handleParamInput(e, key, type) {
    const raw = e.target.value;
    const val = type === 'number' ? Number(raw) : raw;
    onParamChange?.(node.id, key, val);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  role="button"
  tabindex="-1"
  class="absolute select-none"
  style="left:{node.pos.x}px; top:{node.pos.y}px; width:{NODE_W}px;"
  onclick={() => onSelect?.(node.id)}
>
  <!-- Node card -->
  <div
    class="rounded-lg shadow-lg border text-xs overflow-hidden"
    class:ring-2={selected}
    class:ring-yellow-400={selected}
    style="border-color:{def.colour}40; background:white;"
  >
    <!-- Header (drag handle) -->
    <div
      role="button"
      tabindex="-1"
      class="flex items-center justify-between px-2 py-1.5 cursor-grab active:cursor-grabbing text-white font-semibold text-[11px]"
      style="background:{def.colour};"
      onmousedown={e => { e.stopPropagation(); onDragStart?.(e, node.id); }}
    >
      <span class="truncate">{def.label}</span>
      <button
        onclick={e => { e.stopPropagation(); onDelete?.(node.id); }}
        class="ml-1 text-white/70 hover:text-white leading-none"
        tabindex="-1"
      >✕</button>
    </div>

    <!-- Error badge -->
    {#if error}
      <div class="px-2 py-1 text-red-700 bg-red-50 text-[10px] border-b border-red-200 truncate" title={error}>
        ⚠ {error}
      </div>
    {/if}

    <!-- Ports + params body -->
    <div class="flex">

      <!-- Input ports (left) -->
      {#if def.inputs.length}
        <div class="flex flex-col gap-1.5 py-2 pl-1 pr-2 border-r border-gray-100">
          {#each def.inputs as inp}
            <PortDot
              side="in"
              dataType={inp.dataType}
              label={inp.label}
              connected={isConnected(inp.key)}
              nodeId={node.id}
              portKey={inp.key}
              {onPortDragStart}
              onDrop={onPortDrop}
            />
          {/each}
        </div>
      {/if}

      <!-- Params (center) -->
      <div class="flex-1 px-2 py-1.5 flex flex-col gap-1">
        {#each def.params as p}
          {@const val = node.params?.[p.key] ?? p.default}
          <div class="flex flex-col gap-0.5">
            <label class="text-[9px] text-gray-400 uppercase tracking-wide">{p.label}</label>
            {#if p.type === 'select'}
              <select
                class="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white"
                value={val}
                onchange={e => onParamChange?.(node.id, p.key, e.target.value)}
              >
                {#each p.options as opt}
                  <option value={opt.value ?? opt}>{opt.label ?? opt}</option>
                {/each}
              </select>
            {:else if p.type === 'colour'}
              <input
                type="color"
                class="w-full h-6 border border-gray-200 rounded cursor-pointer"
                value={val}
                onchange={e => onParamChange?.(node.id, p.key, e.target.value)}
              />
            {:else}
              <input
                type={p.type === 'number' ? 'number' : 'text'}
                class="w-full text-[10px] border border-gray-200 rounded px-1 py-0.5"
                value={val}
                oninput={e => handleParamInput(e, p.key, p.type)}
              />
            {/if}
          </div>
        {/each}

        {#if def.params.length === 0 && def.inputs.length === 0}
          <span class="text-[9px] text-gray-300 italic">no params</span>
        {/if}
      </div>

      <!-- Output ports (right) -->
      {#if def.outputs.length}
        <div class="flex flex-col gap-1.5 py-2 pl-2 pr-1 border-l border-gray-100">
          {#each def.outputs as out}
            <PortDot
              side="out"
              dataType={out.dataType}
              label={out.label}
              connected={isConnected(out.key)}
              nodeId={node.id}
              portKey={out.key}
              onDragStart={onPortDragStart}
              onDrop={onPortDrop}
            />
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
