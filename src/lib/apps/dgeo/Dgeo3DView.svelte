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
  let solidsBuilding  = $state(false);
  let solidErrors     = $state([]);
  let editHorizonId   = $state(null);

  // ── In-app console panel ──────────────────────────────────────────────────
  let consoleLogs  = $state(/** @type {Array<{level:string,msg:string,ts:string}>} */ ([]));
  let showConsole  = $state(false);
  const errorCount = $derived(consoleLogs.filter(e => e.level === 'error' || e.level === 'warn').length);

  $effect(() => {
    const orig = { log: console.log, warn: console.warn, error: console.error };
    const cap = (level) => (...args) => {
      orig[level](...args);
      const msg = args.map(a => {
        if (a instanceof Error) return a.message;
        if (typeof a === 'object' && a !== null) { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
      }).join(' ');
      consoleLogs = [...consoleLogs.slice(-299), { level, msg, ts: new Date().toLocaleTimeString() }];
    };
    console.log = cap('log'); console.warn = cap('warn'); console.error = cap('error');
    return () => Object.assign(console, orig);
  });
  let editRailIdx     = $state(null);
  let resetKey      = $state(0);
  let showPopup     = $state(false);
  let showRuler     = $state(false);
  let showNurbs          = $state(true);   // toggle NURBS overlay + slice curve
  let showNurbsWireframe = $state(true);  // wireframe overlay on NURBS solid blocks

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

    <!-- NURBS wireframe toggle (only useful when NURBS solids are visible) -->
    {#if showNurbs}
      <button
        onclick={() => (showNurbsWireframe = !showNurbsWireframe)}
        class="px-2 py-0.5 border rounded text-[10px] font-medium transition-colors
               {showNurbsWireframe
                 ? 'bg-slate-500 text-white border-slate-600 hover:bg-slate-600'
                 : 'border-gray-200 text-gray-600 hover:bg-gray-100'}"
        title="Toggle wireframe overlay on NURBS solids">
        ⬡ Wire
      </button>
    {/if}

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

    <button onclick={() => showConsole = !showConsole}
      class="relative px-2 py-0.5 border rounded text-[10px] font-medium transition-colors
             {showConsole ? 'bg-slate-600 text-white border-slate-700 hover:bg-slate-700' : 'border-gray-200 text-gray-600 hover:bg-gray-100'}">
      🖥 Console
      {#if errorCount > 0}
        <span style="position:absolute;top:-5px;right:-5px;background:#ef4444;color:#fff;font-size:9px;border-radius:9999px;width:16px;height:16px;display:flex;align-items:center;justify-content:center;line-height:1">{errorCount > 9 ? '9+' : errorCount}</span>
      {/if}
    </button>

    <span class="ml-auto text-gray-400 hidden sm:block text-[10px]">
      Click surface to select · Drag sphere · Scroll to zoom
    </span>
  </div>

  <!-- ── 3D canvas (full height) ───────────────────────────────────────────── -->
  <div class="flex-1 overflow-hidden touch-none min-h-0 relative">
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
          {showNurbsWireframe}
          {sliceY}
          bind:editHorizonId
          bind:editRailIdx
          bind:solidErrors
          {onUpdateRails}
        />
      </Canvas>
    {/key}

    <!-- Manifold error overlay -->
    {#if solidErrors.length > 0}
      <div style="position:absolute;bottom:8px;left:8px;right:8px;pointer-events:none;z-index:10">
        {#each solidErrors as err}
          <div style="background:rgba(220,38,38,0.88);color:#fff;font-size:10px;font-family:monospace;padding:3px 7px;border-radius:3px;margin-top:2px;line-height:1.4;word-break:break-all">
            ⚠ {err}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Console panel -->
    {#if showConsole}
      <div style="position:absolute;top:8px;right:8px;width:min(360px,calc(100% - 16px));max-height:55%;display:flex;flex-direction:column;background:#0f172a;border:1px solid #334155;border-radius:6px;z-index:20;font-family:monospace;font-size:10px;color:#e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.5)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;border-bottom:1px solid #334155;flex-shrink:0">
          <span style="color:#94a3b8;font-size:11px">Console ({consoleLogs.length})</span>
          <div style="display:flex;gap:12px">
            <button onclick={() => consoleLogs = []} style="color:#64748b;cursor:pointer;background:none;border:none;font-size:10px;font-family:monospace">Clear</button>
            <button onclick={() => showConsole = false} style="color:#64748b;cursor:pointer;background:none;border:none;font-size:12px">✕</button>
          </div>
        </div>
        <div style="overflow-y:auto;flex:1">
          {#each consoleLogs as entry}
            <div style="padding:2px 8px;border-bottom:1px solid #1e293b;color:{entry.level==='error'?'#f87171':entry.level==='warn'?'#fbbf24':'#64748b'};word-break:break-all;line-height:1.5;white-space:pre-wrap">
              <span style="color:#334155">{entry.ts} </span>{entry.msg}
            </div>
          {/each}
          {#if consoleLogs.length === 0}
            <div style="padding:12px;color:#334155;text-align:center">No logs yet</div>
          {/if}
        </div>
      </div>
    {/if}
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
