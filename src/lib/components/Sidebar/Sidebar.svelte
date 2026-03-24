<script>
  import { Tooltip } from 'flowbite-svelte';
  import { FolderOpenSolid, FolderSolid, FileLinesOutline, CloudArrowUpOutline, DesktopPcOutline } from 'flowbite-svelte-icons';
  import { datasourceStore } from '$lib/datasource';

  let { open = $bindable(false) } = $props();

  let fileInput;
  let tooltipItem = $state(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);

  function handleFiles(e) {
    datasourceStore.loadLocalFiles(Array.from(e.target.files));
  }

  function showTooltip(e, item) {
    const rect = e.currentTarget.getBoundingClientRect();
    tooltipItem = item;
    tooltipX = rect.right + 6;
    tooltipY = rect.top + rect.height / 2;
  }

  function hideTooltip() {
    tooltipItem = null;
  }

  const visibleItems = $derived(
    datasourceStore.flatten(datasourceStore.tree, datasourceStore.expanded)
  );
</script>

{#if open}
  <aside style="width:10.4rem" class="flex-shrink-0 h-full bg-white border-r border-gray-200 flex flex-col overflow-hidden">
    <!-- Header band -->
    <div class="flex items-center gap-1 px-2 py-1 bg-green-50 border-b border-green-200">
      <FolderOpenSolid class="w-4 h-4 text-green-800 flex-shrink-0" />
      <span class="text-xs font-bold text-green-800 uppercase tracking-wider flex-1 truncate">Explorer</span>
      <button
        onclick={() => (open = false)}
        class="text-green-800 hover:text-green-600 p-0.5 leading-none flex-shrink-0 text-xs"
        aria-label="Close sidebar"
      >✕</button>
    </div>

    <!-- Hidden directory picker (local mode only) -->
    <input
      bind:this={fileInput}
      type="file"
      class="hidden"
      webkitdirectory
      onchange={handleFiles}
    />

    <!-- Tree or status -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden text-xs">
      {#if datasourceStore.loading}
        <p class="px-3 py-4 text-gray-400 text-center leading-snug">Loading remote…</p>
      {:else if datasourceStore.error}
        <p class="px-3 py-4 text-red-400 text-center leading-snug text-xs">{datasourceStore.error}</p>
      {:else if visibleItems.length === 0}
        <p class="px-3 py-4 text-gray-400 text-center leading-snug">
          {#if datasourceStore.mode === 'local'}
            Click <FolderOpenSolid class="inline w-3 h-3" /> to open a local folder
          {:else}
            No files found in remote folder
          {/if}
        </p>
      {:else}
        {#each visibleItems as item (item.path)}
          <button
            class="w-full text-left flex items-center py-0.5 pr-2 hover:bg-green-50 select-none"
            style="padding-left: {0.25 + item.depth * 0.75}rem"
            onclick={() => item.type === 'dir' && datasourceStore.toggleExpanded(item.path, item.id)}
            onmouseenter={(e) => showTooltip(e, item)}
            onmouseleave={hideTooltip}
          >
            <span class="w-3 flex-shrink-0 text-gray-400 text-center" style="font-size:0.55rem; line-height:1">
              {#if item.type === 'dir' && (item.hasChildren || item.id)}
                {datasourceStore.expanded.has(item.path) ? '▼' : '▶'}
              {/if}
            </span>
            {#if item.type === 'dir'}
              {#if datasourceStore.expanded.has(item.path)}
                <FolderOpenSolid class="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mr-1" />
              {:else}
                <FolderSolid class="w-3.5 h-3.5 text-yellow-400 flex-shrink-0 mr-1" />
              {/if}
            {:else}
              <FileLinesOutline class="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mr-1" />
            {/if}
            <span class="truncate text-gray-800">{item.name}</span>
          </button>
        {/each}
      {/if}
    </div>

    <!-- Bottom row 1: Remote / Local toggle -->
    <div class="border-t border-gray-200 px-2 py-1.5 flex justify-center">
      <button
        id="btn-toggle-mode"
        onclick={() => datasourceStore.toggleMode()}
        class="flex items-center gap-1.5 w-full justify-center px-2 py-1 rounded text-xs font-medium
               {datasourceStore.mode === 'local'
                 ? 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                 : 'bg-orange-50 text-orange-700 hover:bg-orange-100'}"
        aria-label="{datasourceStore.mode === 'local' ? 'Switch to Remote' : 'Switch to Local'}"
      >
        {#if datasourceStore.mode === 'local'}
          <DesktopPcOutline class="w-3.5 h-3.5 flex-shrink-0" />
          <span>Local</span>
        {:else}
          <CloudArrowUpOutline class="w-3.5 h-3.5 flex-shrink-0" />
          <span>Remote</span>
        {/if}
      </button>
      <Tooltip triggeredBy="#btn-toggle-mode" placement="top">
        {datasourceStore.mode === 'local' ? 'Switch to Remote mode' : 'Switch to Local mode'}
      </Tooltip>
    </div>

    <!-- Bottom row 2: Open directory (local only) -->
    {#if datasourceStore.mode === 'local'}
      <div class="border-t border-gray-200 px-2 py-1.5 flex justify-center">
        <button
          id="btn-open-dir"
          onclick={() => fileInput.click()}
          class="flex items-center gap-1.5 w-full justify-center px-2 py-1 rounded text-xs
                 text-gray-600 hover:bg-green-50 hover:text-green-800"
          aria-label="Open local directory"
        >
          <FolderOpenSolid class="w-3.5 h-3.5 flex-shrink-0" />
          <span>Open Folder</span>
        </button>
        <Tooltip triggeredBy="#btn-open-dir" placement="top">Open a local directory</Tooltip>
      </div>
    {/if}
  </aside>

  {#if tooltipItem}
    <div
      style="position:fixed; left:{tooltipX}px; top:{tooltipY}px; transform:translateY(-50%); z-index:9999;"
      class="px-2 py-1 text-xs bg-gray-900 text-white rounded whitespace-nowrap pointer-events-none shadow-lg"
    >
      {tooltipItem.name}
    </div>
  {/if}
{:else}
  <div class="flex-shrink-0 p-2">
    <button
      onclick={() => (open = true)}
      class="p-1.5 rounded-md bg-green-800 text-white hover:bg-green-700"
      aria-label="Open explorer"
    >
      <FolderOpenSolid class="w-5 h-5" />
    </button>
  </div>
{/if}
