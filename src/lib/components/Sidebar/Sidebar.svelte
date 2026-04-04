<script>
  import { onMount } from 'svelte';
  import { FolderOpenSolid, FolderSolid, FileLinesOutline, CloudArrowUpOutline, DesktopPcOutline, TrashBinOutline } from 'flowbite-svelte-icons';
  import { datasourceStore } from '$lib/datasource';
  import { ephemeralStore, FILE_TYPES } from '$lib/datasource/EphemeralStore.svelte.js';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';

  let { open = $bindable(false) } = $props();

  // ── Sidebar tab: 'local' | 'remote' | 'working' ──────────────────────────
  let sidebarTab = $state(datasourceStore.mode);

  function setTab(tab) {
    sidebarTab = tab;
    if (tab === 'local' && datasourceStore.mode !== 'local') datasourceStore.toggleMode();
    if (tab === 'remote' && datasourceStore.mode !== 'remote') datasourceStore.toggleMode();
  }

  // ── Working tab state ─────────────────────────────────────────────────────
  let newFileExt  = $state('.tpl');
  let newFileName = $state('');
  let showNewForm = $state(false);
  let renamingId  = $state(null);
  let renameVal   = $state('');

  function openNewForm(ext) {
    newFileExt  = ext;
    const t = FILE_TYPES.find(f => f.ext === ext);
    newFileName = t ? `new-${t.label.toLowerCase().replace(/\s+/g, '-')}${ext}` : `new${ext}`;
    showNewForm = true;
  }

  function confirmNew() {
    if (!newFileName.trim()) return;
    let name = newFileName.trim();
    if (!name.endsWith(newFileExt)) name += newFileExt;
    const eph = ephemeralStore.create(name, newFileExt);
    tabStore.openFile(ephemeralStore.toTabItem(eph));
    showNewForm = false;
    newFileName = '';
  }

  function openEph(eph) {
    tabStore.openFile(ephemeralStore.toTabItem(eph));
  }

  function downloadEph(eph) {
    const blob = new Blob([eph.content], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = eph.name; a.click();
    URL.revokeObjectURL(url);
  }

  async function sendToSamples(eph) {
    try {
      const fd = new FormData();
      fd.append('file', new File([eph.content], eph.name));
      const res = await fetch('/api/samples', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    }
  }

  let fileInput;
  let tooltipItem   = $state(null);
  let tooltipX      = $state(0);
  let tooltipY      = $state(0);

  // Delete state
  let pendingDelete  = $state(null);
  let deletingPath   = $state(null);
  let deleteError    = $state('');

  // Create state
  const CREATE_OPTIONS = [
    { label: 'New Folder',       type: 'dir',  ext: '',       icon: '📁', default: 'new-folder'    },
    { label: 'Blank File',       type: 'file', ext: '.txt',   icon: '📄', default: 'untitled.txt'  },
    { label: 'Workflow',         type: 'file', ext: '.wflow', icon: '🔗', default: 'workflow.wflow' },
    { label: 'Geological',       type: 'file', ext: '.dgeo',  icon: '🗺', default: 'geology.dgeo'  },
    { label: 'Plot Template',    type: 'file', ext: '.tpl',   icon: '📊', default: 'template.tpl'  },
  ];
  let creating     = $state(null);  // null | { path, step:'menu'|'naming', type, ext, name }
  let createBusy   = $state(false);
  let createError  = $state('');
  let createMenuX  = $state(0);
  let createMenuY  = $state(0);
  let nameInputEl;

  function openCreateMenu(e, item) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    createMenuX = rect.right + 6;
    createMenuY = rect.top;
    creating = { path: item.path, step: 'menu', type: null, ext: null, name: '' };
    createError = '';
  }

  function selectCreateType(opt) {
    creating = { ...creating, step: 'naming', type: opt.type, ext: opt.ext, name: opt.default };
    // focus input on next tick
    setTimeout(() => nameInputEl?.focus(), 30);
  }

  async function confirmCreate() {
    if (!creating || !creating.name.trim()) return;
    createBusy = true; createError = '';
    try {
      await datasourceStore.createItem(creating.path, creating.name.trim(), creating.type === 'dir', creating.ext);
      creating = null;
    } catch (e) {
      createError = e.message;
    } finally {
      createBusy = false;
    }
  }

  function cancelCreate(e) {
    e?.stopPropagation();
    creating = null;
    createError = '';
  }

  function handleCreateKeydown(e) {
    if (e.key === 'Enter')  confirmCreate();
    if (e.key === 'Escape') cancelCreate();
  }

  let recentOpen = $state(false);

  onMount(() => datasourceStore.initRecentWorkspaces());

  // Resizable sidebar
  let sidebarWidth = $state(220);  // px
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

    <!-- ── Working tab content ───────────────────────────────────────────── -->
    {#if sidebarTab === 'working'}
      <!-- New file form / type picker -->
      {#if showNewForm}
        <div class="border-b border-gray-200 px-2 py-2 flex flex-col gap-1.5">
          <div class="flex items-center gap-1 flex-wrap">
            {#each FILE_TYPES as ft}
              <button
                onclick={() => newFileExt = ft.ext}
                class="text-[10px] px-1.5 py-0.5 rounded border transition-colors
                       {newFileExt === ft.ext
                         ? 'bg-green-700 text-white border-green-700'
                         : 'border-gray-200 text-gray-500 hover:bg-gray-50'}"
              >{ft.icon} {ft.ext}</button>
            {/each}
          </div>
          <input
            type="text"
            bind:value={newFileName}
            onkeydown={(e) => { if (e.key === 'Enter') confirmNew(); if (e.key === 'Escape') showNewForm = false; }}
            class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500"
            placeholder="file name"
          />
          <div class="flex gap-1.5">
            <button onclick={confirmNew}
              class="flex-1 text-xs py-1 rounded bg-green-700 text-white font-semibold hover:bg-green-600">
              Create
            </button>
            <button onclick={() => showNewForm = false}
              class="text-xs px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      {:else}
        <div class="border-b border-gray-200 px-2 py-1.5">
          <button
            onclick={() => openNewForm('.tpl')}
            class="flex items-center gap-1.5 w-full justify-center px-2 py-1.5 rounded text-xs
                   text-gray-600 hover:bg-green-50 hover:text-green-800 border border-dashed border-gray-200
                   hover:border-green-300 transition-colors"
          >
            <span class="font-bold text-green-700">+</span>
            <span>New file</span>
          </button>
        </div>
      {/if}

      <!-- File list -->
      <div class="flex-1 overflow-y-auto text-xs">
        {#if ephemeralStore.files.length === 0}
          <p class="px-3 py-6 text-gray-400 text-center leading-snug">
            No files yet.<br>Create a file to get started.
          </p>
        {:else}
          {#each ephemeralStore.files as eph (eph.id)}
            <div class="flex items-center gap-1 px-2 py-0.5 hover:bg-green-50 group">
              {#if renamingId === eph.id}
                <input
                  type="text"
                  bind:value={renameVal}
                  class="flex-1 text-xs border border-blue-300 rounded px-1 py-0.5 focus:outline-none"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') { ephemeralStore.rename(eph.id, renameVal); renamingId = null; }
                    if (e.key === 'Escape') renamingId = null;
                  }}
                  onblur={() => renamingId = null}
                />
              {:else}
                <FileLinesOutline class="w-3.5 h-3.5 text-green-600 flex-shrink-0 mr-0.5" />
                <button
                  class="flex-1 min-w-0 text-left truncate text-gray-800 py-0.5"
                  onclick={() => openEph(eph)}
                  ondblclick={() => { renamingId = eph.id; renameVal = eph.name; }}
                  title={eph.name}
                >{eph.name}</button>
                <!-- Action buttons (visible on hover) -->
                <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button onclick={() => downloadEph(eph)}
                    class="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                    title="Download">⬇</button>
                  <button onclick={() => sendToSamples(eph)}
                    class="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-green-600 hover:bg-green-50 text-[10px] font-bold"
                    title="Send to Samples folder">S</button>
                  <button onclick={() => ephemeralStore.remove(eph.id)}
                    class="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                    title="Delete">✕</button>
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>

    <!-- ── Local workspace controls (top of local tab) ─────────────────── -->
    {:else if sidebarTab === 'local'}
      {@const currentName = datasourceStore.tree ? Object.keys(datasourceStore.tree.children ?? {})[0] : null}
      {@const otherRecent = datasourceStore.recentHandles.filter(e => e.name !== currentName)}

      {#if currentName}
        <!-- Current workspace row -->
        <div class="border-b border-gray-200 px-2 py-1.5 flex items-center gap-1.5">
          <FolderOpenSolid class="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
          <span class="flex-1 text-xs text-gray-700 font-medium truncate" title={currentName}>{currentName}</span>
          <button
            onclick={openFolder}
            class="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-500
                   hover:bg-green-50 hover:text-green-700 hover:border-green-300 transition-colors"
            title="Change workspace"
          >Change</button>
        </div>
      {:else}
        <!-- No workspace: Open Folder prompt -->
        <div class="border-b border-gray-200 px-2 py-1.5">
          <button
            onclick={openFolder}
            class="flex items-center gap-1.5 w-full justify-center px-2 py-1.5 rounded text-xs
                   text-gray-600 hover:bg-green-50 hover:text-green-800 border border-dashed border-gray-200
                   hover:border-green-300 transition-colors"
          >
            <FolderOpenSolid class="w-3.5 h-3.5 flex-shrink-0" />
            <span>Open Folder</span>
          </button>
        </div>
      {/if}

      <!-- Recent workspaces (collapsible) -->
      {#if otherRecent.length > 0}
        <div class="border-b border-gray-200">
          <button
            onclick={() => recentOpen = !recentOpen}
            class="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold
                   text-gray-400 uppercase tracking-wide hover:bg-gray-50 transition-colors"
          >
            <span class="flex-1 text-left">Recent</span>
            <span style="font-size:0.55rem">{recentOpen ? '▼' : '▶'}</span>
          </button>
          {#if recentOpen}
            <div class="pb-1">
              {#each otherRecent as entry}
                <button
                  onclick={() => datasourceStore.reopenWorkspace(entry)}
                  class="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-gray-600
                         hover:bg-green-50 hover:text-green-800 transition-colors"
                  title={entry.name}
                >
                  <FolderSolid class="w-3 h-3 text-yellow-400 flex-shrink-0" />
                  <span class="truncate">{entry.name}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/if}

    <!-- Tree or status (local / remote only) -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden text-xs" class:hidden={sidebarTab === 'working'}>
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
            class="w-full flex items-center py-0.5 pr-1 hover:bg-green-50 select-none
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
              <!-- + button (folders only, local mode, handle available) -->
              {#if item.type === 'dir' && datasourceStore.mode === 'local'}
                {#if item.handle}
                  <button
                    onclick={(e) => openCreateMenu(e, item)}
                    class="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded
                           text-green-600 hover:bg-green-100 active:bg-green-200 font-bold text-sm leading-none mr-0.5"
                    title="Create file or folder here"
                  >+</button>
                {:else}
                  <span
                    class="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded
                           text-gray-300 cursor-not-allowed font-bold text-sm leading-none mr-0.5"
                    title="File creation is not supported on iOS — use a desktop browser"
                  >+</span>
                {/if}
              {:else}
                <span class="w-5 flex-shrink-0 mr-0.5"></span>
              {/if}
              <!-- Trash icon -->
              <button
                onclick={(e) => requestDelete(e, item)}
                class="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded
                       text-gray-400 hover:text-red-500 hover:bg-red-50 active:bg-red-100 mr-0.5"
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

    <!-- ── Bottom tab bar: Local | Remote | Working ───────────────────── -->
    <div class="border-t border-gray-200 flex">
      <button onclick={() => setTab('local')}
        class="flex-1 flex flex-col items-center justify-center py-1.5 text-[10px] font-semibold transition-colors
               {sidebarTab === 'local' ? 'bg-green-700 text-white' : 'text-gray-500 hover:bg-gray-50'}"
        aria-label="Local files">
        <DesktopPcOutline class="w-3.5 h-3.5" />
        <span>Local</span>
      </button>
      <button onclick={() => setTab('remote')}
        class="flex-1 flex flex-col items-center justify-center py-1.5 text-[10px] font-semibold transition-colors
               {sidebarTab === 'remote' ? 'bg-green-700 text-white' : 'text-gray-500 hover:bg-gray-50'}"
        aria-label="Remote files">
        <CloudArrowUpOutline class="w-3.5 h-3.5" />
        <span>Remote</span>
      </button>
      <button onclick={() => setTab('working')}
        class="flex-1 flex flex-col items-center justify-center py-1.5 text-[10px] font-semibold transition-colors
               {sidebarTab === 'working' ? 'bg-green-700 text-white' : 'text-gray-500 hover:bg-gray-50'}"
        aria-label="Working files">
        <svg class="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="12" height="10" rx="1.5"/>
          <line x1="5" y1="7" x2="11" y2="7"/><line x1="5" y1="10" x2="9" y2="10"/>
          <path d="M5 3V2M11 3V2" stroke-linecap="round"/>
        </svg>
        <span>Working</span>
      </button>
    </div>
  </aside>

  {#if tooltipItem}
    <div
      style="position:fixed; left:{tooltipX}px; top:{tooltipY}px; transform:translateY(-50%); z-index:9999;"
      class="px-2 py-1 text-xs bg-gray-900 text-white rounded whitespace-nowrap pointer-events-none shadow-lg"
    >
      {tooltipItem.name}
    </div>
  {/if}

  <!-- Create file/folder popup -->
  {#if creating}
    <!-- Backdrop -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      role="button"
      tabindex="-1"
      class="fixed inset-0 z-[9998]"
      onclick={cancelCreate}
    ></div>

    <div
      style="position:fixed; left:{createMenuX}px; top:{createMenuY}px; z-index:9999;"
      class="bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden text-xs min-w-[170px]"
    >
      {#if creating.step === 'menu'}
        <!-- Type picker -->
        <div class="px-2 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
          Create in <span class="text-gray-700 font-bold">{creating.path.split('/').pop()}</span>
        </div>
        {#each CREATE_OPTIONS as opt}
          <button
            onclick={() => selectCreateType(opt)}
            class="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-green-50 hover:text-green-800 transition-colors"
          >
            <span>{opt.icon}</span>
            <span>{opt.label}</span>
            {#if opt.ext}<span class="ml-auto text-[9px] text-gray-400">{opt.ext}</span>{/if}
          </button>
        {/each}

      {:else}
        <!-- Name input -->
        <div class="px-2 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
          {creating.type === 'dir' ? '📁' : '📄'} Name
        </div>
        <div class="p-2 flex flex-col gap-1.5">
          <input
            bind:this={nameInputEl}
            type="text"
            class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-green-500"
            bind:value={creating.name}
            onkeydown={handleCreateKeydown}
            placeholder="file name"
          />
          {#if createError}
            <p class="text-red-600 text-[10px] leading-snug">{createError}</p>
          {/if}
          <div class="flex gap-1.5">
            <button
              onclick={confirmCreate}
              disabled={createBusy || !creating.name.trim()}
              class="flex-1 py-1 rounded bg-green-700 text-white text-[11px] font-semibold hover:bg-green-600 disabled:opacity-50"
            >{createBusy ? '…' : 'Create'}</button>
            <button
              onclick={cancelCreate}
              class="px-2 py-1 rounded border border-gray-200 text-gray-500 text-[11px] hover:bg-gray-50"
            >Cancel</button>
          </div>
        </div>
      {/if}
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
