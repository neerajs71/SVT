<script>
  import { Canvas } from '@threlte/core';
  import Dgeo3DScene     from './Dgeo3DScene.svelte';
  import Dgeo2DRailEditor from './Dgeo2DRailEditor.svelte';

  let {
    horizons      = [],
    domX,
    domY,
    onUpdateRails = null,
  } = $props();

  let strikeKm      = $state(5);
  let editHorizonId = $state(null);
  let editRailIdx   = $state(null);
  let resetKey      = $state(0);
  let show2D        = $state(true);   // show inline 2D rail editor panel

  function resetView() { resetKey++; }

  // ── Rail management ────────────────────────────────────────────────────────
  const editHorizon = $derived(horizons.find(h => h.id === editHorizonId) ?? null);

  const editRailsSorted = $derived.by(() => {
    if (!editHorizon) return [];
    if (editHorizon.rails && editHorizon.rails.length >= 2) {
      return [...editHorizon.rails].sort((a, b) => a.z - b.z);
    }
    const pts = editHorizon.points ?? [];
    return [
      { z: 0,        points: pts },
      { z: strikeKm, points: pts },
    ];
  });

  const activeRail = $derived(
    editRailIdx !== null ? (editRailsSorted[editRailIdx] ?? null) : null
  );

  function addRail() {
    if (!editHorizon || !onUpdateRails) return;
    const rails = editRailsSorted;
    let newZ;
    if (rails.length >= 2) {
      newZ = (rails[rails.length - 2].z + rails[rails.length - 1].z) / 2;
    } else {
      newZ = strikeKm / 2;
    }
    const nearestRail = rails.reduce((best, r) =>
      Math.abs(r.z - newZ) < Math.abs(best.z - newZ) ? r : best, rails[0]);
    const newRails = [...rails, { z: newZ, points: nearestRail?.points ?? [] }]
      .sort((a, b) => a.z - b.z);
    onUpdateRails(editHorizonId, newRails);
    editRailIdx = newRails.findIndex(r => r.z === newZ);
  }

  function removeRail(idx) {
    if (!editHorizon || !onUpdateRails || editRailsSorted.length <= 2) return;
    const newRails = editRailsSorted.filter((_, i) => i !== idx);
    onUpdateRails(editHorizonId, newRails);
    editRailIdx = Math.min(editRailIdx ?? 0, newRails.length - 1);
  }

  // Called from 2D rail editor when user drags/adds/deletes a point
  function handleUpdatePoints(newPoints) {
    if (!editHorizon || !onUpdateRails || editRailIdx === null) return;
    const newRails = editRailsSorted.map((r, i) =>
      i === editRailIdx ? { ...r, points: newPoints } : r
    );
    onUpdateRails(editHorizonId, newRails);
  }

  // Sync editHorizonId when horizons list changes (deleted horizon)
  $effect(() => {
    if (editHorizonId && !horizons.find(h => h.id === editHorizonId)) {
      editHorizonId = null;
      editRailIdx   = null;
    }
  });

  // Auto-show 2D panel when a rail is selected
  $effect(() => {
    if (editRailIdx !== null && editHorizonId) show2D = true;
  });
</script>

<div class="flex flex-col h-full">

  <!-- ── Top controls ──────────────────────────────────────────────────────── -->
  <div class="flex items-center flex-wrap gap-3 px-3 py-1.5 border-b border-gray-100 bg-gray-50 text-xs text-gray-600 flex-shrink-0">
    <span class="font-semibold text-gray-700">3D Block View</span>

    <label class="flex items-center gap-1.5">
      <span class="text-gray-500">Strike:</span>
      <input type="range" min="1" max="20" step="0.5" bind:value={strikeKm}
        class="w-20 accent-blue-600"/>
      <span class="font-mono w-9 text-gray-600">{strikeKm} km</span>
    </label>

    <!-- Horizon selector -->
    <label class="flex items-center gap-1.5">
      <span class="text-gray-500">Edit:</span>
      <select bind:value={editHorizonId}
        class="border border-gray-200 rounded px-1 py-0 text-xs text-gray-700 bg-white">
        <option value={null}>— none —</option>
        {#each horizons as h (h.id)}
          <option value={h.id}>{h.name}</option>
        {/each}
      </select>
    </label>

    <button onclick={resetView}
      class="px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-100">
      ⟲ Reset
    </button>

    <!-- Toggle 2D panel -->
    {#if editHorizonId && editRailIdx !== null}
      <button
        onclick={() => (show2D = !show2D)}
        class="px-2 py-0.5 border rounded text-[10px] transition-colors
               {show2D
                 ? 'bg-blue-600 text-white border-blue-600'
                 : 'border-gray-200 text-gray-500 hover:border-blue-400'}">
        {show2D ? '▼ 2D Editor' : '▶ 2D Editor'}
      </button>
    {/if}

    <span class="ml-auto text-gray-400 hidden sm:block text-[10px]">
      Click surface · Drag sphere · Scroll to zoom
    </span>
  </div>

  <!-- ── Rail strip (when a horizon is selected) ───────────────────────────── -->
  {#if editHorizonId}
    <div class="flex items-center gap-1.5 px-3 py-1 border-b border-gray-100 bg-white text-xs flex-shrink-0 overflow-x-auto">
      <span class="text-gray-400 flex-shrink-0 mr-0.5">Rails:</span>

      {#each editRailsSorted as rail, ri}
        <button
          onclick={() => (editRailIdx = ri)}
          class="px-2 py-0.5 rounded border text-[10px] font-mono flex-shrink-0 transition-colors
                 {editRailIdx === ri
                   ? 'bg-blue-600 text-white border-blue-600'
                   : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-blue-400'}">
          Z={rail.z.toFixed(1)}
        </button>
      {/each}

      <button
        onclick={addRail}
        class="px-2 py-0.5 rounded border border-dashed border-gray-300 text-gray-400
               hover:border-blue-400 hover:text-blue-600 text-[10px] flex-shrink-0">
        + Rail
      </button>

      {#if editRailIdx !== null && editRailsSorted.length > 2}
        <button
          onclick={() => removeRail(editRailIdx)}
          class="px-2 py-0.5 rounded border border-gray-200 text-red-400
                 hover:border-red-400 text-[10px] flex-shrink-0">
          × Remove
        </button>
      {/if}

      <span class="ml-auto text-[10px] text-gray-400 flex-shrink-0">
        {editRailIdx !== null
          ? `Rail ${editRailIdx + 1} / ${editRailsSorted.length} · Z=${activeRail?.z?.toFixed(1)} km`
          : 'Click a rail button or surface to edit'}
      </span>
    </div>
  {/if}

  <!-- ── Main content: 3D + optional 2D split ─────────────────────────────── -->
  <div class="flex-1 overflow-hidden flex flex-col min-h-0">

    <!-- 3D canvas — takes remaining height, shrinks when 2D panel visible -->
    <div
      class="overflow-hidden touch-none transition-all"
      style={show2D && editHorizonId && editRailIdx !== null ? 'flex:1 1 60%;min-height:0' : 'flex:1 1 100%'}>
      {#key resetKey}
        <Canvas>
          <Dgeo3DScene
            {horizons}
            {domX}
            {domY}
            {strikeKm}
            bind:editHorizonId
            bind:editRailIdx
            {onUpdateRails}
          />
        </Canvas>
      {/key}
    </div>

    <!-- 2D rail editor panel — shown when a rail is selected and show2D is true -->
    {#if show2D && editHorizonId && editRailIdx !== null && activeRail}
      <div class="border-t-2 border-blue-300 flex-shrink-0 overflow-hidden"
           style="flex:0 0 42%;min-height:180px;max-height:320px">
        <Dgeo2DRailEditor
          rail={activeRail}
          allRails={editRailsSorted}
          {domX}
          {domY}
          onUpdatePoints={handleUpdatePoints}
        />
      </div>
    {/if}

  </div>
</div>
