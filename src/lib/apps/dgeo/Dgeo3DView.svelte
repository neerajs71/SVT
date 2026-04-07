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
  let solidErrors     = $state(/** @type {string[]} */ ([]));
  let solidErrorsVisible = $state(false);

  // Auto-dismiss errors after 4 s
  $effect(() => {
    if (solidErrors.length === 0) { solidErrorsVisible = false; return; }
    solidErrorsVisible = true;
    const t = setTimeout(() => { solidErrorsVisible = false; }, 4000);
    return () => clearTimeout(t);
  });
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
  let showNurbsWireframe = $state(true);  // wireframe overlay on NURBS solid blocks
  let showDisplayMenu = $state(false);

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

    <!-- Y slider — strike-direction slice -->
    <label class="flex items-center gap-1.5">
        <span class="text-gray-500">Y:</span>
        <input type="range" min="0" max={strikeW} step="0.05" bind:value={sliceY}
          class="w-20 accent-purple-500"/>
        <span class="font-mono w-12 text-gray-600">
          {(sliceW2km(sliceY)).toFixed(1)} km
        </span>
      </label>

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
          {showNurbsWireframe}
          {sliceY}
          bind:editHorizonId
          bind:editRailIdx
          bind:solidErrors
          {onUpdateRails}
        />
      </Canvas>
    {/key}

    <!-- ── Display settings button + dropdown ──────────────────────────────── -->
    <div style="position:absolute;top:8px;right:8px;z-index:25">
      <button
        onclick={() => showDisplayMenu = !showDisplayMenu}
        title="Display settings"
        style="width:30px;height:30px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(15,23,42,0.72);color:#cbd5e1;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(4px);box-shadow:0 1px 6px rgba(0,0,0,0.35)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">
          <line x1="2" y1="4"  x2="14" y2="4"/>  <circle cx="6"  cy="4"  r="1.8" fill="currentColor" stroke="none"/>
          <line x1="2" y1="8"  x2="14" y2="8"/>  <circle cx="10" cy="8"  r="1.8" fill="currentColor" stroke="none"/>
          <line x1="2" y1="12" x2="14" y2="12"/> <circle cx="6"  cy="12" r="1.8" fill="currentColor" stroke="none"/>
        </svg>
      </button>

      {#if showDisplayMenu}
        <!-- click-away backdrop -->
        <div style="position:fixed;inset:0;z-index:24" onclick={() => showDisplayMenu = false} aria-hidden="true"/>
        <!-- dropdown panel -->
        <div style="position:absolute;top:36px;right:0;z-index:26;min-width:148px;background:rgba(15,23,42,0.92);border:1px solid #334155;border-radius:7px;padding:6px 5px;display:flex;flex-direction:column;gap:2px;backdrop-filter:blur(8px);box-shadow:0 4px 18px rgba(0,0,0,0.5)">

          <!-- Solidify -->
          <button
            onclick={() => { showSolids = !showSolids; }}
            style="display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border-radius:5px;border:none;cursor:pointer;text-align:left;font-size:11px;font-family:inherit;
                   background:{showSolids ? 'rgba(245,158,11,0.2)' : 'transparent'};
                   color:{showSolids ? '#fbbf24' : '#94a3b8'}">
            <span style="width:10px;height:10px;border-radius:2px;flex-shrink:0;
                         background:{showSolids ? '#f59e0b' : 'transparent'};
                         border:1.5px solid {showSolids ? '#f59e0b' : '#475569'}"></span>
            Solidify
          </button>

          <!-- Ruler -->
          <button
            onclick={() => { showRuler = !showRuler; }}
            style="display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border-radius:5px;border:none;cursor:pointer;text-align:left;font-size:11px;font-family:inherit;
                   background:{showRuler ? 'rgba(100,116,139,0.25)' : 'transparent'};
                   color:{showRuler ? '#e2e8f0' : '#94a3b8'}">
            <span style="width:10px;height:10px;border-radius:2px;flex-shrink:0;
                         background:{showRuler ? '#64748b' : 'transparent'};
                         border:1.5px solid {showRuler ? '#94a3b8' : '#475569'}"></span>
            Ruler
          </button>

          <!-- Wireframe -->
          <button
            onclick={() => { showNurbsWireframe = !showNurbsWireframe; }}
            style="display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border-radius:5px;border:none;cursor:pointer;text-align:left;font-size:11px;font-family:inherit;
                   background:{showNurbsWireframe ? 'rgba(100,116,139,0.25)' : 'transparent'};
                   color:{showNurbsWireframe ? '#e2e8f0' : '#94a3b8'}">
            <span style="width:10px;height:10px;border-radius:2px;flex-shrink:0;
                         background:{showNurbsWireframe ? '#64748b' : 'transparent'};
                         border:1.5px solid {showNurbsWireframe ? '#94a3b8' : '#475569'}"></span>
            Wireframe
          </button>

        </div>
      {/if}
    </div>

    <!-- Manifold error overlay — flashes for 4 s then fades -->
    {#if solidErrors.length > 0}
      <div style="position:absolute;bottom:8px;left:8px;right:8px;pointer-events:none;z-index:10;transition:opacity 0.6s ease;opacity:{solidErrorsVisible ? 1 : 0}">
        {#each solidErrors as err}
          <div style="background:rgba(220,38,38,0.88);color:#fff;font-size:10px;font-family:monospace;padding:3px 7px;border-radius:3px;margin-top:2px;line-height:1.4;word-break:break-all">
            ⚠ {err}
          </div>
        {/each}
      </div>
    {/if}

    <!-- Console panel -->
    {#if showConsole}
      <div style="position:absolute;top:46px;right:8px;width:min(360px,calc(100% - 16px));max-height:55%;display:flex;flex-direction:column;background:#0f172a;border:1px solid #334155;border-radius:6px;z-index:20;font-family:monospace;font-size:10px;color:#e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.5)">
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
