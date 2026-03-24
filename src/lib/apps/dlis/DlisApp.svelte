<script>
  import { onMount } from 'svelte';
  import { parseDLISFile, processChannelsAndFrames } from './utils.js';

  let { tab } = $props();

  let loading = $state(true);
  let error = $state(null);
  let parseResult = $state(null);
  let channels = $state([]);
  let frames = $state([]);
  let totalEFLRs = $state(0);
  let fileSize = $state(0);

  let activeSection = $state('overview');

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

      parseResult = await parseDLISFile(buffer);
      ({ channels, frames, totalEFLRs } = processChannelsAndFrames(parseResult));
    } catch (e) {
      error = e.message;
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

  const logicalFiles = $derived(parseResult?.logicalFiles ?? []);
</script>

<div class="h-full flex flex-col overflow-hidden bg-white text-sm">

  {#if loading}
    <div class="flex-1 flex items-center justify-center text-gray-400">
      Parsing {tab.name}…
    </div>

  {:else if error}
    <div class="flex-1 flex flex-col items-center justify-center gap-2 text-red-500 p-6">
      <span class="font-medium">Failed to parse DLIS file</span>
      <span class="text-xs text-red-400">{error}</span>
    </div>

  {:else}
    <!-- Header bar -->
    <div class="flex-shrink-0 flex items-center gap-4 px-4 py-2 border-b border-gray-200 bg-gray-50">
      <span class="font-mono text-xs text-gray-500 truncate flex-1">{tab.name}</span>
      <span class="text-xs text-gray-400">{formatBytes(fileSize)}</span>
      <span class="text-xs text-gray-400">v{parseResult?.storageUnitLabel?.version ?? '?'}.00</span>
      <span class="text-xs text-gray-400">{logicalFiles.length} logical file{logicalFiles.length !== 1 ? 's' : ''}</span>
    </div>

    <!-- Section tabs -->
    <div class="flex-shrink-0 flex border-b border-gray-200">
      {#each [['overview','Overview'], ['channels','Channels'], ['frames','Frames']] as [id, label]}
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
              </tr>
            </thead>
            <tbody>
              {#each channels as ch, i}
                <tr class="{i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-green-50">
                  <td class="px-3 py-1 border border-gray-200 font-mono font-medium text-green-800">{ch.name}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-600">{ch.longName || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-500">{ch.units || '—'}</td>
                  <td class="px-3 py-1 border border-gray-200 text-gray-400 font-mono text-[0.65rem]">{ch.logicalFile || '—'}</td>
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
      {/if}

    </div>
  {/if}
</div>
