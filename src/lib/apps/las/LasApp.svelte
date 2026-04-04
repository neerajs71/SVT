<script>
  import { onMount } from 'svelte';
  import { parseLASFile, processCurves, extractLasCurve, buildLasTracks } from './utils.js';
  import WellTrackView from '$lib/apps/shared/WellTrackView.svelte';
  import { downloadBlob } from '$lib/apps/shared/fileActions.js';

  let { tab } = $props();

  let loading     = $state(true);
  let error       = $state(null);
  let diagnostic  = $state(null);
  let las         = $state(null);   // raw parse result
  let summary     = $state(null);   // processCurves() output
  let logView     = $state(null);   // buildLasTracks() output
  let rawBuffer   = $state(null);   // kept for download

  let activeSection = $state('overview');
  let chart         = $state(null);  // null = closed

  function download() {
    if (rawBuffer) downloadBlob(tab.name, rawBuffer, 'text/plain');
  }

  onMount(async () => {
    try {
      let buffer;
      if (tab.file) {
        buffer = await tab.file.arrayBuffer();
      } else if (tab.driveId) {
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        buffer = await (await res.blob()).arrayBuffer();
      } else {
        throw new Error('No file source available.');
      }

      rawBuffer = buffer;
      las     = parseLASFile(buffer);
      summary = processCurves(las);
      logView = buildLasTracks(las);
    } catch (e) {
      error      = e.message;
      diagnostic = e.diagnostic ?? null;
    } finally {
      loading = false;
    }
  });

  function fmt(n, digits = 4) {
    if (!isFinite(n)) return String(n);
    return parseFloat(n.toPrecision(digits)).toString();
  }

  function formatBytes(bytes) {
    if (!bytes) return '—';
    const units = ['B','KB','MB','GB'];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(1)} ${units[i]}`;
  }

  function wellVal(key) {
    return las?.well?.[key]?.value ?? '—';
  }

  /** Open chart modal for a curve column. */
  function openChart(curve) {
    const raw = extractLasCurve(las, curve.index);
    if (!raw || !raw.xs.length) {
      chart = { empty: true, name: curve.name, units: curve.unit };
      return;
    }

    // xs = depth (index), ys = curve value
    const { xs: depths, ys: values, indexName, units } = raw;
    const dMin = Math.min(...depths), dMax = Math.max(...depths);
    const vMin = Math.min(...values), vMax = Math.max(...values);
    const dRange = dMax - dMin || 1;
    const vRange = vMax - vMin || 1;

    // Taller layout — log-track style
    const W  = 260, H  = 320;
    const PL = 52,  PR = 14, PT = 14, PB = 36;
    const IW = W - PL - PR, IH = H - PT - PB;

    // Depth on Y (min at top → max at bottom), curve value on X
    const sx = v => PL + ((v - vMin) / vRange) * IW;
    const sy = d => PT + ((d - dMin) / dRange) * IH;

    const points = depths.map((d, i) => `${sx(values[i]).toFixed(1)},${sy(d).toFixed(1)}`).join(' ');

    // Y ticks = depth, X ticks = value
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
      v: dMin + t * dRange,
      py: sy(dMin + t * dRange),
    }));
    const xTicks = [0, 0.5, 1].map(t => ({
      v: vMin + t * vRange,
      px: sx(vMin + t * vRange),
    }));

    chart = {
      empty: false,
      name: curve.name,
      units,
      indexName,
      count: depths.length,
      W, H, PL, PR, PT, PB, IW, IH,
      points, yTicks, xTicks,
    };
  }

  const fileSize = $derived(
    tab.file ? tab.file.size : 0
  );
</script>

<div class="h-full flex flex-col overflow-hidden bg-white text-sm">

  {#if loading}
    <div class="flex-1 flex items-center justify-center text-gray-400">
      Parsing {tab.name}…
    </div>

  {:else if error}
    <div class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <span class="font-medium text-red-500">Failed to parse LAS file</span>
      <span class="text-xs text-red-400 max-w-xs">{error}</span>
      {#if diagnostic}
        <div class="mt-1 max-w-xs w-full">
          <div class="text-[0.6rem] text-gray-400 mb-1 text-left">File preview:</div>
          <pre class="text-[0.6rem] text-gray-600 bg-gray-100 rounded p-2 text-left overflow-x-auto whitespace-pre-wrap break-all">{diagnostic}</pre>
        </div>
      {/if}
    </div>

  {:else}
    <!-- Header bar -->
    <div class="flex-shrink-0 flex items-center gap-3 px-4 py-2 border-b border-gray-200 bg-gray-50">
      <span class="font-mono text-xs text-gray-500 truncate flex-1">{tab.name}</span>
      {#if fileSize}<span class="text-xs text-gray-400">{formatBytes(fileSize)}</span>{/if}
      <span class="text-xs text-gray-400">LAS {las.version ?? '?'}</span>
      <span class="text-xs text-gray-400">{summary.curves.length} curves</span>
      <button onclick={download} class="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 active:bg-gray-200" title="Download file">⬇ Download</button>
    </div>

    <!-- Section tabs -->
    <div class="flex-shrink-0 flex border-b border-gray-200">
      {#each [['overview','Overview'],['curves','Curves'],['log','Log'],['params','Parameters']] as [id, label]}
        <button
          class="px-4 py-1.5 text-xs font-medium border-b-2 transition-colors
                 {activeSection === id
                   ? 'border-green-700 text-green-800'
                   : 'border-transparent text-gray-500 hover:text-gray-700'}"
          onclick={() => (activeSection = id)}
        >
          {label}
          {#if id === 'curves'}  ({summary.curves.length}){/if}
          {#if id === 'params'}  ({las.params.length}){/if}
        </button>
      {/each}
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4">

      {#if activeSection === 'overview'}
        <div class="grid grid-cols-2 gap-3 max-w-lg">
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Well</div>
            <div class="font-medium truncate">{wellVal('WELL') || wellVal('UWI') || '—'}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Company</div>
            <div class="font-medium truncate">{wellVal('COMP') || '—'}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Start depth</div>
            <div class="font-medium">{summary.startDepth} {las.well['STRT']?.unit ?? ''}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Stop depth</div>
            <div class="font-medium">{summary.stopDepth} {las.well['STOP']?.unit ?? ''}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Step</div>
            <div class="font-medium">{summary.step} {las.well['STEP']?.unit ?? ''}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Data rows</div>
            <div class="font-medium">{summary.rowCount.toLocaleString()}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Curves</div>
            <div class="font-medium">{summary.curves.length}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Null value</div>
            <div class="font-medium font-mono">{las.nullValue}</div>
          </div>
        </div>

        {#if las.well['FLD']?.value || las.well['LOC']?.value}
          <div class="mt-4 text-xs text-gray-400">
            {#if las.well['FLD']?.value}Field: {las.well['FLD'].value}{/if}
            {#if las.well['LOC']?.value} &nbsp;·&nbsp; Location: {las.well['LOC'].value}{/if}
          </div>
        {/if}

      {:else if activeSection === 'curves'}
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="bg-gray-100 text-gray-600 text-left">
              <th class="px-3 py-1.5 border border-gray-200 font-medium">Mnemonic</th>
              <th class="px-3 py-1.5 border border-gray-200 font-medium">Units</th>
              <th class="px-3 py-1.5 border border-gray-200 font-medium">Description</th>
              <th class="px-2 py-1.5 border border-gray-200 font-medium w-8 text-center">Plot</th>
            </tr>
          </thead>
          <tbody>
            {#each summary.curves as curve, i}
              <tr class="{i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-green-50">
                <td class="px-3 py-1 border border-gray-200 font-mono font-medium text-green-800">
                  {curve.name}
                  {#if curve.isIndex}
                    <span class="ml-1 text-[0.6rem] text-gray-400 font-normal">(index)</span>
                  {/if}
                </td>
                <td class="px-3 py-1 border border-gray-200 text-gray-500">{curve.unit || '—'}</td>
                <td class="px-3 py-1 border border-gray-200 text-gray-500">{curve.desc || '—'}</td>
                <td class="px-2 py-1 border border-gray-200 text-center">
                  {#if !curve.isIndex}
                    <button
                      onclick={() => openChart(curve)}
                      title="Plot {curve.name}"
                      class="inline-flex items-center justify-center w-6 h-6 rounded
                             hover:bg-green-100 text-gray-400 hover:text-green-700 transition-colors"
                    >
                      <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor">
                        <rect x="0"   y="7" width="3" height="5"/>
                        <rect x="4.5" y="4" width="3" height="8"/>
                        <rect x="9"   y="1" width="3" height="11"/>
                      </svg>
                    </button>
                  {:else}
                    <span class="text-gray-200">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>

      {:else if activeSection === 'log'}
        {#if !logView || !logView.tracks.length}
          <p class="text-gray-400 text-xs">No curve data available for log view.</p>
        {:else}
          <WellTrackView
            tracks={logView.tracks}
            indexName={logView.indexName}
            dMin={logView.dMin}
            dMax={logView.dMax}
          />
        {/if}

      {:else if activeSection === 'params'}
        {#if !las.params.length}
          <p class="text-gray-400">No parameters section found.</p>
        {:else}
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="bg-gray-100 text-gray-600 text-left">
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Mnemonic</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Units</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Value</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {#each las.params as p, i}
                <tr class="{i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}">
                  <td class="px-3 py-1 border border-gray-200 font-mono font-medium text-green-800">{p.mnem}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-500">{p.unit || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-600">{p.value || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-400">{p.desc || '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}

    </div>
  {/if}

</div>

<!-- Chart modal (same SVG pattern as DlisApp) -->
{#if chart}
  <div
    class="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
    role="dialog"
    aria-modal="true"
    onclick={() => (chart = null)}
  >
    <div
      class="bg-white w-full sm:w-auto sm:rounded-xl rounded-t-xl shadow-xl overflow-hidden"
      onclick={e => e.stopPropagation()}
    >
      <!-- Modal header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div class="flex items-baseline gap-1.5">
          <span class="font-semibold text-sm text-gray-800">{chart.name}</span>
          {#if chart.units}
            <span class="text-xs text-gray-400">({chart.units})</span>
          {/if}
        </div>
        <button
          onclick={() => (chart = null)}
          class="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
          aria-label="Close"
        >×</button>
      </div>

      <!-- Chart body -->
      <div class="p-4">
        {#if chart.empty}
          <p class="text-gray-400 text-xs text-center py-8 px-12">
            No numeric data found for <strong>{chart.name}</strong>.
          </p>
        {:else}
          <svg
            viewBox="0 0 {chart.W} {chart.H}"
            width={chart.W}
            height={chart.H}
            class="overflow-visible"
            style="max-width:100%;height:auto"
          >
            <!-- Grid -->
            {#each chart.yTicks as t}
              <line x1={chart.PL} y1={t.py}
                    x2={chart.PL + chart.IW} y2={t.py}
                    stroke="#e5e7eb" stroke-width="1"/>
            {/each}

            <!-- Axes -->
            <line x1={chart.PL} y1={chart.PT}
                  x2={chart.PL} y2={chart.PT + chart.IH}
                  stroke="#9ca3af" stroke-width="1"/>
            <line x1={chart.PL}            y1={chart.PT + chart.IH}
                  x2={chart.PL + chart.IW} y2={chart.PT + chart.IH}
                  stroke="#9ca3af" stroke-width="1"/>

            <!-- Y tick labels -->
            {#each chart.yTicks as t}
              <text x={chart.PL - 4} y={t.py}
                    text-anchor="end" dominant-baseline="middle"
                    font-size="8" fill="#6b7280">{fmt(t.v)}</text>
            {/each}

            <!-- X tick labels -->
            {#each chart.xTicks as t, i}
              <text
                x={t.px} y={chart.PT + chart.IH + 14}
                text-anchor={i === 0 ? 'start' : i === chart.xTicks.length - 1 ? 'end' : 'middle'}
                dominant-baseline="auto" font-size="8" fill="#6b7280"
              >{fmt(t.v)}</text>
            {/each}

            <!-- Y axis label = depth -->
            <text
              x={chart.PL - 36} y={chart.PT + chart.IH / 2}
              transform="rotate(-90, {chart.PL - 36}, {chart.PT + chart.IH / 2})"
              text-anchor="middle" font-size="8" fill="#9ca3af"
            >{chart.indexName}</text>

            <!-- X axis label = curve value -->
            <text
              x={chart.PL + chart.IW / 2} y={chart.PT + chart.IH + 28}
              text-anchor="middle" font-size="8" fill="#9ca3af"
            >{chart.name}{chart.units ? ` (${chart.units})` : ''}</text>

            <!-- Curve -->
            <polyline
              points={chart.points}
              fill="none" stroke="#15803d" stroke-width="1.5"
              stroke-linejoin="round" stroke-linecap="round"
            />
          </svg>

          <p class="text-[0.65rem] text-gray-400 text-right mt-1">{chart.count} samples</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
