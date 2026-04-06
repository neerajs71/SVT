<script>
  import { Canvas }       from '@threlte/core';
  import Dgeo3DScene      from './Dgeo3DScene.svelte';
  import DgeoEditPopup    from './DgeoEditPopup.svelte';

  let {
    horizons          = [],
    domX,
    domY,
    onUpdateRails     = null,
    showSolids        = $bindable(false),
    strikeKm          = $bindable(5),
    defaultRailCount  = $bindable(10),
  } = $props();
  let solidsBuilding = $state(false);
  let editHorizonId = $state(null);
  let editRailIdx   = $state(null);
  let resetKey      = $state(0);
  let showPopup     = $state(false);
  let showRuler     = $state(false);
  let showNurbs     = $state(true);    // toggle NURBS overlay + slice curve

  // ── Slice plane position (world-space Y, 0 .. strikeW) ───────────────────
  // strikeW = strikeKm / (domX.max - domX.min) * WX, where WX=10 and domX span defaults to 10
  // We approximate here; Dgeo3DScene computes the authoritative value.
  // Close enough for the slider max — Dgeo3DScene clamps sliceY internally.
  const strikeW = $derived(strikeKm);   // world Y ≈ strikeKm when domX span ≈ 10
  const sliceW2km = (wy) => wy / strikeW * strikeKm;
  let sliceY = $state(0);
  $effect(() => { sliceY = strikeW / 2; });          // re-centre when model resizes

  function resetView() { resetKey++; }

  // ── Rail management ────────────────────────────────────────────────────────
  const editHorizon = $derived(horizons.find(h => h.id === editHorizonId) ?? null);

  const editRailsSorted = $derived.by(() => {
    if (!editHorizon) return [];
    if (editHorizon.rails && editHorizon.rails.length >= 2) {
      return [...editHorizon.rails].sort((a, b) => a.z - b.z);
    }
    // No saved rails — generate defaultRailCount evenly-spaced rails
    const pts = editHorizon.points ?? [];
    const n   = Math.max(2, defaultRailCount);
    return Array.from({ length: n }, (_, i) => ({
      z:      (i / (n - 1)) * strikeKm,
      points: pts.map(p => ({ ...p })),
    }));
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

  function handleUpdatePoints(newPoints) {
    if (!editHorizon || !onUpdateRails || editRailIdx === null) return;
    const newRails = editRailsSorted.map((r, i) =>
      i === editRailIdx ? { ...r, points: newPoints } : r
    );
    onUpdateRails(editHorizonId, newRails);
  }

  // Auto-open popup when a rail is selected from 3D scene
  $effect(() => {
    if (editRailIdx !== null && editHorizonId) showPopup = true;
  });

  // Close popup + clear selection when horizon is deleted
  $effect(() => {
    if (editHorizonId && !horizons.find(h => h.id === editHorizonId)) {
      editHorizonId = null;
      editRailIdx   = null;
      showPopup     = false;
    }
  });
</script>

<!-- position:relative so the absolute-positioned popup is contained here -->
<div class="flex flex-col h-full relative">

  <!-- ── Top controls bar ──────────────────────────────────────────────────── -->
  <div class="flex items-center flex-wrap gap-3 px-3 py-1.5 border-b border-gray-100 bg-gray-50
              text-xs text-gray-600 flex-shrink-0">
    <span class="font-semibold text-gray-700">3D Block View</span>

    <label class="flex items-center gap-1.5">
      <span class="text-gray-500">Strike:</span>
      <input type="range" min="1" max="20" step="0.5" bind:value={strikeKm}
        class="w-20 accent-blue-600"/>
      <span class="font-mono w-9 text-gray-600">{strikeKm} km</span>
    </label>

    <!-- Horizon selector -->
    <label class="flex items-center gap-1.5">
      <span class="text-gray-500">Edit horizon:</span>
      <select bind:value={editHorizonId}
        class="border border-gray-200 rounded px-1 py-0 text-xs text-gray-700 bg-white">
        <option value={null}>— none —</option>
        {#each horizons as h (h.id)}
          <option value={h.id}>{h.name}</option>
        {/each}
      </select>
    </label>

    <!-- Open editor button (when horizon selected, no popup open) -->
    {#if editHorizonId && !showPopup}
      <button
        onclick={() => { if (editRailIdx === null) editRailIdx = 0; showPopup = true; }}
        class="px-2 py-0.5 bg-blue-600 text-white rounded text-[10px] font-medium hover:bg-blue-700">
        ✏ Edit Rails
      </button>
    {/if}

    <!-- Solidify toggle -->
    <button
      onclick={() => (showSolids = !showSolids)}
      class="px-2 py-0.5 border rounded text-[10px] font-medium transition-colors
             {showSolids
               ? 'bg-amber-500 text-white border-amber-600 hover:bg-amber-600'
               : 'border-gray-200 text-gray-600 hover:bg-gray-100'}">
      {showSolids ? '◼ Solidify ON' : '◻ Solidify'}
    </button>

    <!-- Ruler toggle -->
    <button
      onclick={() => (showRuler = !showRuler)}
      class="px-2 py-0.5 border rounded text-[10px] font-medium transition-colors
             {showRuler
               ? 'bg-slate-600 text-white border-slate-700 hover:bg-slate-700'
               : 'border-gray-200 text-gray-600 hover:bg-gray-100'}">
      📏 Ruler
    </button>

    <!-- Default rail count -->
    <label class="flex items-center gap-1">
      <span class="text-gray-500">Rails:</span>
      <input type="number" min="2" max="50" bind:value={defaultRailCount}
        class="w-12 border border-gray-200 rounded px-1 text-xs text-gray-700 bg-white"/>
    </label>

    <!-- NURBS overlay toggle -->
    <button
      onclick={() => (showNurbs = !showNurbs)}
      class="px-2 py-0.5 border rounded text-[10px] font-medium transition-colors
             {showNurbs
               ? 'bg-purple-600 text-white border-purple-700 hover:bg-purple-700'
               : 'border-gray-200 text-gray-600 hover:bg-gray-100'}">
      〜 NURBS
    </button>

    <!-- Y slider — strike-direction slice (visible when NURBS on) -->
    {#if showNurbs}
      <label class="flex items-center gap-1.5">
        <span class="text-gray-500">Y:</span>
        <input type="range" min="0" max={strikeW} step="0.05" bind:value={sliceY}
          class="w-20 accent-purple-500"/>
        <span class="font-mono w-12 text-gray-600">
          {(sliceW2km(sliceY)).toFixed(1)} km
        </span>
      </label>
    {/if}

    <button onclick={resetView}
      class="px-2 py-0.5 border border-gray-200 rounded hover:bg-gray-100">
      ⟲ Reset
    </button>

    <span class="ml-auto text-gray-400 hidden sm:block text-[10px]">
      Click surface to select · Drag sphere · Scroll to zoom
    </span>
  </div>

  <!-- ── 3D canvas (full height) ───────────────────────────────────────────── -->
  <div class="flex-1 overflow-hidden touch-none min-h-0">
    {#key resetKey}
      <Canvas>
        <Dgeo3DScene
          {horizons}
          {domX}
          {domY}
          {strikeKm}
          {defaultRailCount}
          {showSolids}
          {showRuler}
          {showNurbs}
          {sliceY}
          bind:editHorizonId
          bind:editRailIdx
          {onUpdateRails}
        />
      </Canvas>
    {/key}
  </div>

  <!-- ── Floating rail-editor popup (analogous to pyenthu PopupEditSurface) ── -->
  {#if showPopup && editHorizonId && activeRail}
    <DgeoEditPopup
      rail={activeRail}
      allRails={editRailsSorted}
      bind:editRailIdx
      horizonName={editHorizon?.name ?? ''}
      {domX}
      {domY}
      onUpdatePoints={handleUpdatePoints}
      onAddRail={addRail}
      onRemoveRail={removeRail}
      onClose={() => { showPopup = false; }}
    />
  {/if}

</div>
