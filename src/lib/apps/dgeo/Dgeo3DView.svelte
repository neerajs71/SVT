<script>
  import { Canvas } from '@threlte/core';
  import Dgeo3DScene from './Dgeo3DScene.svelte';

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

  function resetView() { resetKey++; }

  // ── Rail management for selected horizon ───────────────────────────────────
  const editHorizon = $derived(horizons.find(h => h.id === editHorizonId) ?? null);

  const editRailsSorted = $derived.by(() => {
    if (!editHorizon) return [];
    if (editHorizon.rails && editHorizon.rails.length >= 2) {
      return [...editHorizon.rails].sort((a, b) => a.z - b.z);
    }
    // Fallback: two rails at z=0 and z=strikeKm mirroring the 2D profile
    const pts = editHorizon.points ?? [];
    return [
      { z: 0,        points: pts },
      { z: strikeKm, points: pts },
    ];
  });

  function addRail() {
    if (!editHorizon || !onUpdateRails) return;
    const rails = editRailsSorted;
    // Insert midpoint between last two rails
    let newZ;
    if (rails.length >= 2) {
      newZ = (rails[rails.length - 2].z + rails[rails.length - 1].z) / 2;
    } else {
      newZ = strikeKm / 2;
    }
    // Copy points from nearest existing rail
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

  // Sync editHorizonId when horizons list changes (deleted horizon)
  $effect(() => {
    if (editHorizonId && !horizons.find(h => h.id === editHorizonId)) {
      editHorizonId = null;
      editRailIdx   = null;
    }
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

    <!-- Horizon to edit -->
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

    <span class="ml-auto text-gray-400 hidden sm:block text-[10px]">
      Click surface to select · Drag sphere to edit · Scroll to zoom
    </span>
  </div>

  <!-- ── Rail strip (visible when a horizon is selected) ──────────────────── -->
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

      <!-- Add rail -->
      <button
        onclick={addRail}
        class="px-2 py-0.5 rounded border border-dashed border-gray-300 text-gray-400
               hover:border-blue-400 hover:text-blue-600 text-[10px] flex-shrink-0">
        + Rail
      </button>

      <!-- Remove active rail (min 2 rails) -->
      {#if editRailIdx !== null && editRailsSorted.length > 2}
        <button
          onclick={() => removeRail(editRailIdx)}
          class="px-2 py-0.5 rounded border border-gray-200 text-red-400
                 hover:border-red-400 text-[10px] flex-shrink-0">
          × Remove
        </button>
      {/if}

      <span class="ml-auto text-[10px] text-gray-400 flex-shrink-0">
        {editRailIdx !== null ? `Editing rail ${editRailIdx + 1} / ${editRailsSorted.length}` : 'Click a rail to edit'}
      </span>
    </div>
  {/if}

  <!-- ── Threlte canvas ────────────────────────────────────────────────────── -->
  <div class="flex-1 overflow-hidden touch-none">
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
</div>
