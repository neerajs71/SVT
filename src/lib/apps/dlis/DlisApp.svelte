<script>
  import { onMount } from 'svelte';
  import { parseDLISFile, processChannelsAndFrames, extractCurveData, extractAllCurvesForTracks } from './utils.js';
  import WellTrackView from '$lib/apps/shared/WellTrackView.svelte';
  import { downloadBlob } from '$lib/apps/shared/fileActions.js';

  let { tab } = $props();

  let loading = $state(true);
  let error = $state(null);
  let diagnostic = $state(null);
  let parseResult = $state(null);
  let channels = $state([]);
  let frames = $state([]);
  let totalEFLRs = $state(0);
  let fileSize = $state(0);

  let activeSection = $state('overview');
  let logView       = $state(null);  // extractAllCurvesForTracks() output
  let rawBuffer     = $state(null);  // kept for download

  // Chart modal state — null means closed
  let chart = $state(null);

  function download() {
    if (rawBuffer) downloadBlob(tab.name, rawBuffer, 'application/octet-stream');
  }

  onMount(async () => {
    try {
      let buffer;
      if (tab.file) {
        buffer = await tab.file.arrayBuffer();
        fileSize = tab.file.size;
      } else if (tab.driveId) {
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const blob = await res.blob();
        buffer = await blob.arrayBuffer();
        fileSize = buffer.byteLength;
      } else {
        throw new Error('No file source available.');
      }

      rawBuffer = buffer;
      parseResult = await parseDLISFile(buffer);
      ({ channels, frames, totalEFLRs } = processChannelsAndFrames(parseResult));
      logView = extractAllCurvesForTracks(parseResult);
    } catch (e) {
      error = e.message;
      diagnostic = e.diagnostic ?? null;
    } finally {
      loading = false;
    }
  });

  function formatBytes(bytes) {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0, v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(1)} ${units[i]}`;
  }

  function fmt(n, digits = 3) {
    if (!isFinite(n)) return String(n);
    const s = n.toPrecision(digits);
    return parseFloat(s).toString(); // strip trailing zeros
  }

  /** Build a chart descriptor for the modal, or null if no data. */
  function openChart(ch) {
    const raw = extractCurveData(parseResult, ch.name);
    if (!raw) { chart = { empty: true, channelName: ch.name, units: ch.units }; return; }

    // pairs: [depth, value]
    const pairs = raw.xs
      .map((x, i) => [x, raw.ys[i]])
      .filter(([d, v]) => isFinite(d) && isFinite(v));

    if (!pairs.length) { chart = { empty: true, channelName: ch.name, units: ch.units }; return; }

    const depths = pairs.map(p => p[0]);
    const values = pairs.map(p => p[1]);
    const dMin = Math.min(...depths), dMax = Math.max(...depths);
    const vMin = Math.min(...values), vMax = Math.max(...values);
    const dRange = dMax - dMin || 1;
    const vRange = vMax - vMin || 1;

    // Taller layout — log-track style
    const W = 260, H = 320, PL = 52, PR = 14, PT = 14, PB = 36;
    const IW = W - PL - PR, IH = H - PT - PB;

    // Depth on Y (min at top → max at bottom), curve value on X
    const sx = v => PL + ((v - vMin) / vRange) * IW;
    const sy = d => PT + ((d - dMin) / dRange) * IH;

    const points = pairs.map(([d, v]) => `${sx(v).toFixed(1)},${sy(d).toFixed(1)}`).join(' ');

    // Y ticks = depth, X ticks = value
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => ({ v: dMin + t * dRange, py: sy(dMin + t * dRange) }));
    const xTicks = [0, 0.5, 1].map(t => ({ v: vMin + t * vRange, px: sx(vMin + t * vRange) }));

    chart = {
      empty: false,
      channelName: ch.name,
      units: ch.units,
      indexName: raw.indexName,
      count: pairs.length,
      W, H, PL, PR, PT, PB, IW, IH,
      points, yTicks, xTicks,
    };
  }

  const logicalFiles = $derived(parseResult?.logicalFiles ?? []);
</script>

<div class="h-full flex flex-col overflow-hidden bg-white text-sm">

  {#if loading}
    <div class="flex-1 flex items-center justify-center text-gray-400">
      Parsing {tab.name}…
    </div>

  {:else if error}
    <div class="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <span class="font-medium text-red-500">Failed to parse DLIS file</span>
      <span class="text-xs text-red-400 max-w-xs">{error}</span>
      {#if diagnostic}
        <div class="mt-1 max-w-xs w-full">
          <div class="text-[0.6rem] text-gray-400 mb-1 text-left">First 80 bytes (printable):</div>
          <pre class="text-[0.6rem] text-gray-600 bg-gray-100 rounded p-2 text-left overflow-x-auto whitespace-pre-wrap break-all">{diagnostic}</pre>
        </div>
      {/if}
    </div>

  {:else}
    <!-- Header bar -->
    <div class="flex-shrink-0 flex items-center gap-4 px-4 py-2 border-b border-gray-200 bg-gray-50">
      <span class="font-mono text-xs text-gray-500 truncate flex-1">{tab.name}</span>
      <span class="text-xs text-gray-400">{formatBytes(fileSize)}</span>
      <span class="text-xs text-gray-400">v{parseResult?.storageUnitLabel?.version ?? '?'}.00</span>
      <span class="text-xs text-gray-400">{logicalFiles.length} logical file{logicalFiles.length !== 1 ? 's' : ''}</span>
      <button onclick={download} class="text-xs px-2 py-0.5 rounded border border-gray-300 text-gray-500 hover:bg-gray-100 active:bg-gray-200" title="Download file">⬇ Download</button>
    </div>

    <!-- Section tabs -->
    <div class="flex-shrink-0 flex border-b border-gray-200">
      {#each [['overview','Overview'], ['channels','Channels'], ['frames','Frames'], ['log','Log']] as [id, label]}
        <button
          class="px-4 py-1.5 text-xs font-medium border-b-2 transition-colors
                 {activeSection === id
                   ? 'border-green-700 text-green-800'
                   : 'border-transparent text-gray-500 hover:text-gray-700'}"
          onclick={() => (activeSection = id)}
        >{label}{#if id === 'channels'} ({channels.length}){/if}{#if id === 'frames'} ({frames.length}){/if}</button>
      {/each}
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-4">

      {#if activeSection === 'overview'}
        <div class="grid grid-cols-2 gap-3 max-w-lg">
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">File size</div>
            <div class="font-medium">{formatBytes(fileSize)}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">DLIS version</div>
            <div class="font-medium">V{parseResult?.storageUnitLabel?.version ?? '?'}.00</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Logical files</div>
            <div class="font-medium">{logicalFiles.length}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Total EFLRs</div>
            <div class="font-medium">{totalEFLRs}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Channels</div>
            <div class="font-medium">{channels.length}</div>
          </div>
          <div class="bg-gray-50 rounded p-3">
            <div class="text-xs text-gray-500 mb-0.5">Frames</div>
            <div class="font-medium">{frames.length}</div>
          </div>
        </div>

        {#if parseResult?.storageUnitLabel?.ssi}
          <div class="mt-4 text-xs text-gray-400 font-mono">{parseResult.storageUnitLabel.ssi.trim()}</div>
        {/if}

      {:else if activeSection === 'channels'}
        {#if channels.length === 0}
          <p class="text-gray-400">No channels found.</p>
        {:else}
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="bg-gray-100 text-gray-600 text-left">
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Name</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Long name</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Units</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Logical file</th>
                <th class="px-2 py-1.5 border border-gray-200 font-medium w-8 text-center">Plot</th>
              </tr>
            </thead>
            <tbody>
              {#each channels as ch, i}
                <tr class="{i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-green-50">
                  <td class="px-3 py-1 border border-gray-200 font-mono font-medium text-green-800">{ch.name}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-600">{ch.longName || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-500">{ch.units || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-400 font-mono text-[0.65rem]">{ch.logicalFile || '—'}</td>
                  <td class="px-2 py-1 border border-gray-200 text-center">
                    <button
                      onclick={() => openChart(ch)}
                      title="Plot {ch.name}"
                      class="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-green-100 text-gray-400 hover:text-green-700 transition-colors"
                    >
                      <!-- Simple bar-chart icon -->
                      <svg viewBox="0 0 12 12" width="12" height="12" fill="currentColor">
                        <rect x="0" y="7" width="3" height="5"/>
                        <rect x="4.5" y="4" width="3" height="8"/>
                        <rect x="9" y="1" width="3" height="11"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

      {:else if activeSection === 'frames'}
        {#if frames.length === 0}
          <p class="text-gray-400">No frames found.</p>
        {:else}
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="bg-gray-100 text-gray-600 text-left">
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Name</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Index type</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Min</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Max</th>
                <th class="px-3 py-1.5 border border-gray-200 font-medium">Logical file</th>
              </tr>
            </thead>
            <tbody>
              {#each frames as fr, i}
                <tr class="{i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-green-50">
                  <td class="px-3 py-1 border border-gray-200 font-mono font-medium text-green-800">{fr.name}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-600">{fr.indexType || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-500">{fr.indexMin || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-500">{fr.indexMax || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-400 font-mono text-[0.65rem]">{fr.logicalFile || '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
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
      {/if}

    </div>
  {/if}

</div>

<!-- Chart modal -->
{#if chart}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center"
    role="dialog"
    aria-modal="true"
    onclick={() => (chart = null)}
  >
    <!-- Panel — slides up on mobile, centred on larger screens -->
    <div
      class="bg-white w-full sm:w-auto sm:rounded-xl rounded-t-xl shadow-xl overflow-hidden"
      onclick={e => e.stopPropagation()}
    >
      <!-- Modal header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div class="flex items-baseline gap-1.5">
          <span class="font-semibold text-sm text-gray-800">{chart.channelName}</span>
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
            No numeric curve data found for <strong>{chart.channelName}</strong>.
          </p>
        {:else}
          <!-- Pure SVG line chart -->
          <svg
            viewBox="0 0 {chart.W} {chart.H}"
            width={chart.W}
            height={chart.H}
            class="overflow-visible"
            style="max-width:100%;height:auto"
          >
            <!-- Light grid lines -->
            {#each chart.yTicks as t}
              <line
                x1={chart.PL} y1={t.py}
                x2={chart.PL + chart.IW} y2={t.py}
                stroke="#e5e7eb" stroke-width="1"
              />
            {/each}

            <!-- Axes -->
            <line x1={chart.PL} y1={chart.PT} x2={chart.PL} y2={chart.PT + chart.IH}
                  stroke="#9ca3af" stroke-width="1"/>
            <line x1={chart.PL} y1={chart.PT + chart.IH} x2={chart.PL + chart.IW} y2={chart.PT + chart.IH}
                  stroke="#9ca3af" stroke-width="1"/>

            <!-- Y axis tick labels -->
            {#each chart.yTicks as t}
              <text
                x={chart.PL - 4} y={t.py}
                text-anchor="end" dominant-baseline="middle"
                font-size="8" fill="#6b7280"
              >{fmt(t.v)}</text>
            {/each}

            <!-- X axis tick labels -->
            {#each chart.xTicks as t, i}
              <text
                x={t.px} y={chart.PT + chart.IH + 14}
                text-anchor={i === 0 ? 'start' : i === chart.xTicks.length - 1 ? 'end' : 'middle'}
                dominant-baseline="auto"
                font-size="8" fill="#6b7280"
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
            >{chart.channelName}{chart.units ? ` (${chart.units})` : ''}</text>

            <!-- The curve -->
            <polyline
              points={chart.points}
              fill="none"
              stroke="#15803d"
              stroke-width="1.5"
              stroke-linejoin="round"
              stroke-linecap="round"
            />
          </svg>

          <p class="text-[0.65rem] text-gray-400 text-right mt-1">{chart.count} samples</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
