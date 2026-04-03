<script>
  /**
   * NodePalette — left sidebar listing all available node types grouped by category.
   * Click a node type to emit onAddNode(typeId).
   * (Drag-to-canvas can be added later; click-to-add is sufficient for now.)
   */
  import { NODE_TYPES, NODE_CATEGORIES } from '../nodes/registry.js';

  const { onAddNode } = $props();

  const CAT_ICONS = {
    source:    '⬛',
    filter:    '⬡',
    transform: '⬢',
    compute:   '◆',
    output:    '▶',
  };
</script>

<div class="flex flex-col h-full overflow-y-auto bg-gray-900 text-white w-36 shrink-0 text-xs">
  <div class="px-2 py-2 text-[10px] font-bold uppercase tracking-widest text-gray-400 border-b border-gray-700">
    Nodes
  </div>

  {#each NODE_CATEGORIES as cat}
    <div class="mt-1">
      <div class="px-2 py-1 text-[9px] uppercase tracking-widest text-gray-500 font-semibold">
        {CAT_ICONS[cat.id] ?? '•'} {cat.label}
      </div>
      {#each cat.nodes as typeId}
        {@const def = NODE_TYPES[typeId]}
        {#if def}
          <button
            onclick={() => onAddNode?.(typeId)}
            class="w-full text-left px-3 py-1.5 hover:bg-gray-700 active:bg-gray-600 flex items-center gap-2 transition-colors"
          >
            <span
              class="w-2 h-2 rounded-full shrink-0"
              style="background:{def.colour};"
            ></span>
            <span class="truncate text-[11px] text-gray-200">{def.label}</span>
          </button>
        {/if}
      {/each}
    </div>
  {/each}

  <div class="mt-auto px-2 py-2 text-[9px] text-gray-600 border-t border-gray-800">
    Click to add node
  </div>
</div>
