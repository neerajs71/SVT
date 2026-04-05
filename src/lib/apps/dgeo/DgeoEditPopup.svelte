<script>
  /**
   * Floating draggable popup for editing a single rail's cross-section.
   * Modelled on pyenthu/dlis EditSurfacePopupManager + PopupEditSurface pattern:
   *  - position:absolute inside a position:relative container
   *  - mousedown on header → document.addEventListener mousemove/mouseup
   *  - incremental e.movementX/Y for smooth drag
   *  - Rail strip in header so you never need to close to switch rails
   */
  import Dgeo2DRailEditor from './Dgeo2DRailEditor.svelte';

  let {
    rail,                  // { z, points }
    allRails     = [],     // sorted rails array (for header strip + context)
    editRailIdx  = $bindable(null),
    horizonName  = '',
    domX,
    domY,
    onUpdatePoints = null, // (newPoints) => void
    onAddRail    = null,
    onRemoveRail = null,   // (idx) => void
    onClose      = null,
  } = $props();

  // ── Drag state ─────────────────────────────────────────────────────────────
  let pos       = $state({ x: 8, y: 60 });
  let dragging  = $state(false);

  function startDrag(e) {
    dragging = true;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   onDragEnd);
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!dragging) return;
    pos = { x: pos.x + e.movementX, y: pos.y + e.movementY };
  }

  function onDragEnd() {
    dragging = false;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup',   onDragEnd);
  }
</script>

<!--
  Outer wrapper: position:absolute, floats over the 3D canvas.
  pointer-events:none on the body so the 3D scene remains clickable except
  where explicitly re-enabled.
-->
<div
  class="absolute z-40 rounded-xl shadow-2xl border border-gray-200 flex flex-col
         overflow-hidden select-none"
  style="left:{pos.x}px; top:{pos.y}px; width:min(560px, calc(100vw - 16px)); background:white;"
>

  <!-- ── Header (drag handle) ──────────────────────────────────────────────── -->
  <div
    class="flex items-center gap-2 px-3 py-1.5
           bg-gradient-to-r from-blue-50 to-slate-50
           border-b border-gray-200 rounded-t-xl
           {dragging ? 'cursor-grabbing' : 'cursor-grab'}"
    onmousedown={startDrag}
    role="presentation"
  >
    <!-- Horizon + editor title -->
    <span class="font-semibold text-xs text-gray-800 truncate max-w-[120px]" title={horizonName}>
      {horizonName}
    </span>
    <span class="text-gray-300 text-xs">|</span>
    <span class="text-[10px] text-blue-600 font-medium">Rail Editor</span>

    <!-- Rail strip — select active rail without closing popup -->
    <div class="flex gap-0.5 ml-auto items-center overflow-x-auto" style="max-width:min(280px, 40vw)">
      {#each allRails as r, ri}
        <button
          onclick={() => (editRailIdx = ri)}
          onmousedown={e => e.stopPropagation()}
          class="px-1.5 py-0.5 rounded border text-[9px] font-mono flex-shrink-0 transition-colors
                 {editRailIdx === ri
                   ? 'bg-blue-600 text-white border-blue-600'
                   : 'bg-white text-gray-500 border-gray-200 hover:border-blue-400'}">
          Z={r.z.toFixed(1)}
        </button>
      {/each}

      <!-- Add rail -->
      <button
        onclick={() => onAddRail?.()}
        onmousedown={e => e.stopPropagation()}
        title="Add rail"
        class="px-1.5 py-0.5 rounded border border-dashed border-gray-300
               text-[9px] text-gray-400 hover:border-blue-400 hover:text-blue-600 flex-shrink-0">
        + Rail
      </button>

      <!-- Remove active rail (min 2) -->
      {#if editRailIdx !== null && allRails.length > 2}
        <button
          onclick={() => onRemoveRail?.(editRailIdx)}
          onmousedown={e => e.stopPropagation()}
          title="Remove this rail"
          class="px-1.5 py-0.5 rounded border border-gray-200 text-[9px]
                 text-red-400 hover:border-red-400 flex-shrink-0">
          × Rail
        </button>
      {/if}
    </div>

    <!-- Close button -->
    <button
      onclick={() => onClose?.()}
      onmousedown={e => e.stopPropagation()}
      class="ml-2 w-5 h-5 flex-shrink-0 rounded flex items-center justify-center
             text-gray-400 hover:bg-gray-100 hover:text-gray-700 text-xs leading-none">
      ✕
    </button>
  </div>

  <!-- ── 2D cross-section editor body ──────────────────────────────────────── -->
  <div style="height:270px">
    <Dgeo2DRailEditor
      {rail}
      {allRails}
      {domX}
      {domY}
      {onUpdatePoints}
    />
  </div>

</div>
