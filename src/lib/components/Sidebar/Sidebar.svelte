<script>
  import { Tooltip } from 'flowbite-svelte';
  import { FolderOpenSolid, FolderSolid, FileLinesOutline, CloudArrowUpOutline, DesktopPcOutline, TrashBinOutline } from 'flowbite-svelte-icons';
  import { datasourceStore } from '$lib/datasource';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';

  let { open = $bindable(false) } = $props();

  let fileInput;
  let tooltipItem   = $state(null);
  let tooltipX      = $state(0);
  let tooltipY      = $state(0);

  // Delete state
  let pendingDelete  = $state(null);   // path awaiting confirmation
  let deletingPath   = $state(null);   // path currently being deleted
  let deleteError    = $state('');

  // Resizable sidebar
  let sidebarWidth = $state(166);  // px, default ~10.4rem
  let dragging = false;
  let dragStartX = 0;
  let dragStartWidth = 0;

  function onDragStart(e) {
    dragging = true;
    dragStartX = e.clientX;
    dragStartWidth = sidebarWidth;
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    e.preventDefault();
  }
  function onDragMove(e) {
    if (!dragging) return;
    const delta = e.clientX - dragStartX;
    sidebarWidth = Math.max(120, Math.min(500, dragStartWidth + delta));
  }
  function onDragEnd() {
    dragging = false;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
  }

  // Legacy fallback: webkitdirectory <input> (no delete support)
  function handleFiles(e) {
    datasourceStore.loadLocalFiles(Array.from(e.target.files));
  }

  // Preferred: File System Access API (supports real file deletion)
  async function openFolder() {
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await datasourceStore.loadLocalFolder(dirHandle);
      } catch (e) {
        if (e.name !== 'AbortError') deleteError = e.message;
      }
    } else {
      fileInput.click();  // fallback to <input webkitdirectory>
    }
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

  // ── Delete logic ──────────────────────────────────────────────────────────

  function requestDelete(e, item) {
    e.stopPropagation();
    deleteError = '';
    if (pendingDelete === item.path) {
      confirmDelete(item);
    } else {
      pendingDelete = item.path;
      setTimeout(() => { if (pendingDelete === item.path) pendingDelete = null; }, 3000);
    }
  }

  async function confirmDelete(item) {
    pendingDelete  = null;
    deletingPath   = item.path;
    deleteError    = '';
    try {
      await datasourceStore.deleteItem(item.path, item.id);
      // Close any open tabs that reference the deleted item/subtree
      for (const tab of [...tabStore.tabs]) {
        if (tab.path?.startsWith(item.path)) tabStore.closeTab(tab.id);
      }
    } catch (e) {
      deleteError = e.message ?? String(e);
    } finally {
      deletingPath = null;
    }
  }

  function cancelDelete(e) {
    e.stopPropagation();
    pendingDelete = null;
  }

  const visibleItems = $derived(
    datasourceStore.flatten(datasourceStore.tree, datasourceStore.expanded)
  );
</script>

{#if open}
  <aside style="width:{sidebarWidth}px" class="relative flex-shrink-0 h-full bg-white border-r border-gray-200 flex flex-col overflow-hidden">
    <!-- Drag handle -->
    <div
      onpointerdown={onDragStart}
      class="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-blue-400 active:bg-blue-500 transition-colors"
      title="Drag to resize"
    ></div>
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

    <!-- Delete error banner -->
    {#if deleteError}
      <div class="px-2 py-1 bg-red-50 border-b border-red-200 text-red-700 text-xs flex items-start gap-1">
        <span class="flex-1 leading-snug">{deleteError}</span>
        <button onclick={() => deleteError = ''} class="flex-shrink-0 font-bold leading-none mt-0.5">✕</button>
      </div>
    {/if}

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
          {@const isPending  = pendingDelete  === item.path}
          {@const isDeleting = deletingPath   === item.path}
          <div
            class="group w-full flex items-center py-0.5 pr-1 hover:bg-green-50 select-none
                   {isPending  ? 'bg-red-50 hover:bg-red-50' : ''}
                   {isDeleting ? 'opacity-40 pointer-events-none' : ''}"
            style="padding-left: {0.25 + item.depth * 0.75}rem"
            onmouseenter={(e) => showTooltip(e, item)}
            onmouseleave={hideTooltip}
          >
            <!-- LEFT: delete / confirm / spinner -->
            {#if isDeleting}
              <span class="w-4 flex-shrink-0 text-gray-400 text-center animate-spin mr-0.5" style="font-size:0.65rem">⟳</span>
            {:else if isPending}
              <button
                onclick={(e) => { e.stopPropagation(); confirmDelete(item); }}
                class="flex-shrink-0 text-[0.55rem] bg-red-600 text-white rounded px-1 py-0.5 leading-none mr-0.5"
                title="Confirm — click to delete"
              >✓</button>
              <button
                onclick={cancelDelete}
                class="flex-shrink-0 text-[0.55rem] text-gray-400 hover:text-gray-600 leading-none mr-0.5"
                title="Cancel"
              >✕</button>
            {:else}
              <!-- Trash icon — appears on row hover -->
              <button
                onclick={(e) => requestDelete(e, item)}
                class="flex-shrink-0 w-4 opacity-0 group-hover:opacity-100 p-0.5 rounded
                       text-gray-300 hover:text-red-500 hover:bg-red-50 transition-opacity mr-0.5"
                title="{datasourceStore.mode === 'remote' ? 'Move to trash' : 'Remove from workspace'}"
              >
                <TrashBinOutline class="w-3 h-3" />
              </button>
            {/if}

            <!-- Expand arrow -->
            <span class="w-3 flex-shrink-0 text-gray-400 text-center" style="font-size:0.55rem; line-height:1">
              {#if item.type === 'dir' && (item.hasChildren || item.id)}
                {datasourceStore.expanded.has(item.path) ? '▼' : '▶'}
              {/if}
            </span>

            <!-- Icon + name (click to open/expand) -->
            <button
              class="flex-1 min-w-0 flex items-center py-0.5 text-left"
              onclick={() => item.type === 'dir'
                ? datasourceStore.toggleExpanded(item.path, item.id)
                : tabStore.openFile(item)}
            >
              {#if item.type === 'dir'}
                {#if datasourceStore.expanded.has(item.path)}
                  <FolderOpenSolid class="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mr-1" />
                {:else}
                  <FolderSolid class="w-3.5 h-3.5 text-yellow-400 flex-shrink-0 mr-1" />
                {/if}
              {:else}
                <FileLinesOutline class="w-3.5 h-3.5 text-gray-400 flex-shrink-0 mr-1" />
              {/if}
              <span class="truncate {isPending ? 'text-red-700 font-medium' : 'text-gray-800'}">{item.name}</span>
            </button>
          </div>
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
          onclick={openFolder}
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
