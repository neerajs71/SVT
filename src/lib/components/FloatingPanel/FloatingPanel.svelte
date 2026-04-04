<script>
  /**
   * FloatingPanel — draggable floating popup panel.
   * Matches dlis PopupEditor.svelte style (rounded, frosted glass, gradient header).
   *
   * Props:
   *   title    {string}   Panel title
   *   visible  {boolean}  Show/hide
   *   onClose  {function} Called when X is clicked
   *   width    {number}   Panel width in px (default 400)
   *   x        {number}   Initial left position (default 60)
   *   y        {number}   Initial top position (default 60)
   *   children {Snippet}  Panel body content
   */
  const { title, visible, onClose, width = 400, x = 60, y = 60, children } = $props();

  let posX = $state(x);
  let posY = $state(y);
  let dragging = $state(false);
  let offX = 0, offY = 0;

  // Clamp initial position so panel doesn't start off-screen
  $effect(() => {
    const effectiveW = Math.min(width, window.innerWidth - 16);
    posX = Math.max(0, Math.min(x, window.innerWidth - effectiveW - 8));
  });
  $effect(() => { posY = y; });

  function startDrag(e) {
    dragging = true;
    offX = e.clientX - posX;
    offY = e.clientY - posY;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopDrag);
  }

  function onMove(e) {
    if (!dragging) return;
    posX = Math.max(0, Math.min(e.clientX - offX, window.innerWidth - width - 8));
    posY = Math.max(0, e.clientY - offY);
  }

  function stopDrag() {
    dragging = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stopDrag);
  }
</script>

{#if visible}
  <div
    class="absolute rounded-2xl bg-white shadow-2xl border border-gray-200/90 flex flex-col overflow-hidden select-none {dragging ? 'cursor-grabbing' : ''}"
    style="width:min({width}px, calc(100vw - 16px)); left:{posX}px; top:{posY}px; z-index:50; max-height:80vh; backdrop-filter:blur(4px);"
  >
    <!-- Draggable header -->
    <div
      class="flex items-center justify-between px-2.5 py-1.5 bg-gradient-to-r from-blue-100/70 to-slate-100/60 border-b border-gray-300/70 rounded-t-2xl {dragging ? 'cursor-grabbing' : 'cursor-grab'} flex-shrink-0"
      role="presentation"
      onmousedown={startDrag}
    >
      <h3 class="m-0 text-sm font-extrabold text-slate-800 tracking-tight">{title}</h3>
      <button
        class="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-300/60 bg-white/90 text-slate-500 hover:bg-slate-100 hover:text-slate-900 shadow-sm text-xs transition-all"
        onclick={e => { e.stopPropagation(); onClose(); }}
        onmousedown={e => e.stopPropagation()}
        aria-label="Close"
      >✕</button>
    </div>

    <!-- Content -->
    <div class="overflow-y-auto flex-1">
      {@render children?.()}
    </div>
  </div>
{/if}
