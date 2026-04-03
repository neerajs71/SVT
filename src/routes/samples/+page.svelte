<script>
  import { onMount } from 'svelte';

  // ── Local samples state ──────────────────────────────────────────────────────
  let localFiles  = $state([]);
  let localError  = $state('');
  let localBusy   = $state(false);
  let localUploadInput;

  // ── Drive state ──────────────────────────────────────────────────────────────
  let driveStack  = $state([]);   // [{id, name}] breadcrumb
  let driveItems  = $state([]);   // files/folders in current Drive folder
  let driveError  = $state('');
  let driveBusy   = $state(false);

  /** Parse a fetch Response error into a readable string */
  async function readError(res) {
    const text = await res.text();
    try { return JSON.parse(text)?.message ?? text; } catch { return text; }
  }

  // ── Status toast ─────────────────────────────────────────────────────────────
  let toast = $state('');
  let toastTimer;

  function showToast(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 3500);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function fmtSize(bytes) {
    if (bytes < 1024)       return `${bytes} B`;
    if (bytes < 1024**2)    return `${(bytes/1024).toFixed(1)} KB`;
    return `${(bytes/1024**2).toFixed(2)} MB`;
  }

  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  // ── Local samples API ─────────────────────────────────────────────────────────

  async function refreshLocal() {
    localBusy = true; localError = '';
    try {
      const res = await fetch('/api/samples');
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();
      localFiles = data.files;
    } catch (e) { localError = e.message; }
    finally { localBusy = false; }
  }

  async function uploadLocalFile(fileObj) {
    const fd = new FormData();
    fd.append('file', fileObj);
    const res = await fetch('/api/samples', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await readError(res));
    return res.json();
  }

  async function deleteLocalFile(name) {
    if (!confirm(`Delete "${name}" from samples?`)) return;
    localBusy = true;
    try {
      const res = await fetch(`/api/samples?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await readError(res));
      showToast(`Deleted ${name}`);
      await refreshLocal();
    } catch (e) { localError = e.message; }
    finally { localBusy = false; }
  }

  async function handleLocalUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    localBusy = true; localError = '';
    try {
      for (const f of files) await uploadLocalFile(f);
      showToast(`Uploaded ${files.length} file(s) to samples`);
      await refreshLocal();
    } catch (e) { localError = e.message; }
    finally { localBusy = false; e.target.value = ''; }
  }

  // ── Drive API ─────────────────────────────────────────────────────────────────

  function currentDriveFolderId() {
    return driveStack.length ? driveStack[driveStack.length - 1].id : null;
  }

  async function refreshDrive(folderId) {
    driveBusy = true; driveError = '';
    try {
      const params = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
      const res = await fetch(`/api/drive${params}`);
      if (!res.ok) throw new Error(await readError(res));
      const node = await res.json();
      driveItems = Object.values(node.children ?? {}).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch (e) { driveError = e.message; }
    finally { driveBusy = false; }
  }

  async function driveNavigate(item) {
    driveStack = [...driveStack, { id: item.id, name: item.name }];
    await refreshDrive(item.id);
  }

  async function driveBack() {
    driveStack = driveStack.slice(0, -1);
    await refreshDrive(currentDriveFolderId());
  }

  async function driveGoTo(idx) {
    driveStack = driveStack.slice(0, idx + 1);
    await refreshDrive(currentDriveFolderId());
  }

  // ── Copy: Drive file → local samples ─────────────────────────────────────────
  async function copyToLocal(item) {
    driveBusy = true;
    try {
      const res = await fetch(`/api/drive?fileId=${encodeURIComponent(item.id)}`);
      if (!res.ok) throw new Error(await readError(res));
      const blob = await res.blob();
      const file = new File([blob], item.name, { type: blob.type });
      await uploadLocalFile(file);
      showToast(`Copied "${item.name}" → samples`);
      await refreshLocal();
    } catch (e) { driveError = e.message; }
    finally { driveBusy = false; }
  }

  onMount(() => {
    refreshLocal();
    refreshDrive(null);
  });
</script>

<!-- Toast -->
{#if toast}
  <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-green-800 text-white text-sm rounded-lg shadow-lg pointer-events-none">
    {toast}
  </div>
{/if}

<div class="flex h-full overflow-hidden bg-gray-50">

  <!-- ── Left panel: Local Samples ──────────────────────────────────────────── -->
  <div class="flex flex-col w-1/2 border-r border-gray-300 overflow-hidden">

    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shrink-0">
      <div>
        <h2 class="text-sm font-bold text-gray-800">Local Samples</h2>
        <p class="text-xs text-gray-500">static/samples/ — served at /samples/</p>
      </div>
      <div class="flex gap-2">
        <button
          onclick={refreshLocal}
          disabled={localBusy}
          class="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50"
        >Refresh</button>
        <button
          onclick={() => localUploadInput?.click()}
          disabled={localBusy}
          class="px-2 py-1 text-xs rounded bg-green-700 hover:bg-green-600 text-white disabled:opacity-50"
        >+ Upload</button>
        <input bind:this={localUploadInput} type="file" multiple class="hidden" onchange={handleLocalUpload} />
      </div>
    </div>

    <!-- Error -->
    {#if localError}
      <div class="flex items-start gap-2 px-3 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200 shrink-0">
        <span class="flex-1 break-words">{localError}</span>
        <button onclick={() => (localError = '')} class="shrink-0 font-bold text-red-500 leading-none">✕</button>
      </div>
    {/if}

    <!-- File list -->
    <div class="flex-1 overflow-y-auto">
      {#if localBusy && localFiles.length === 0}
        <div class="p-4 text-xs text-gray-400">Loading…</div>
      {:else if localFiles.length === 0}
        <div class="p-4 text-xs text-gray-400">No files in static/samples/</div>
      {:else}
        <div class="divide-y divide-gray-100">
          {#each localFiles as f (f.name)}
            <div class="flex flex-col px-3 py-2 hover:bg-white gap-1">
              <div class="flex items-center justify-between gap-2">
                <a href={`/samples/${encodeURIComponent(f.name)}`} target="_blank"
                   class="text-xs text-blue-700 hover:underline font-mono break-all leading-snug flex-1">
                  {f.name}
                </a>
                <span class="text-xs text-gray-400 whitespace-nowrap shrink-0">{fmtSize(f.size)}</span>
              </div>
              <div class="flex gap-1.5">
                <button
                  onclick={() => deleteLocalFile(f.name)}
                  disabled={localBusy}
                  class="px-2 py-0.5 rounded text-xs bg-red-50 active:bg-red-200 text-red-700 disabled:opacity-40 border border-red-100"
                >Delete</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Footer hint -->
    <div class="px-4 py-2 text-xs text-gray-400 bg-white border-t border-gray-100 shrink-0">
      {localFiles.length} file(s) · upload from your device with "+ Upload"
    </div>
  </div>

  <!-- ── Right panel: Google Drive ─────────────────────────────────────────── -->
  <div class="flex flex-col w-1/2 overflow-hidden">

    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 shrink-0">
      <div>
        <h2 class="text-sm font-bold text-gray-800">Google Drive</h2>
        <!-- Breadcrumb -->
        <div class="flex items-center gap-1 text-xs text-gray-500 mt-0.5 flex-wrap">
          <button onclick={() => { driveStack = []; refreshDrive(null); }}
            class="hover:text-green-700 hover:underline">Root</button>
          {#each driveStack as crumb, i}
            <span>/</span>
            {#if i === driveStack.length - 1}
              <span class="text-gray-800 font-medium">{crumb.name}</span>
            {:else}
              <button onclick={() => driveGoTo(i)}
                class="hover:text-green-700 hover:underline">{crumb.name}</button>
            {/if}
          {/each}
        </div>
      </div>
      <div class="flex gap-2">
        {#if driveStack.length}
          <button onclick={driveBack} disabled={driveBusy}
            class="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50">← Back</button>
        {/if}
        <button onclick={() => refreshDrive(currentDriveFolderId())} disabled={driveBusy}
          class="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50">Refresh</button>
      </div>
    </div>

    <!-- Error -->
    {#if driveError}
      <div class="flex items-start gap-2 px-3 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200 shrink-0">
        <span class="flex-1 break-words">{driveError}</span>
        <button onclick={() => (driveError = '')} class="shrink-0 font-bold text-red-500 leading-none">✕</button>
      </div>
    {/if}

    <!-- File list -->
    <div class="flex-1 overflow-y-auto">
      {#if driveBusy && driveItems.length === 0}
        <div class="p-4 text-xs text-gray-400">Loading…</div>
      {:else if driveItems.length === 0}
        <div class="p-4 text-xs text-gray-400">
          {driveError ? '' : 'This folder is empty.'}
        </div>
      {:else}
        <div class="divide-y divide-gray-100">
          {#each driveItems as item (item.id)}
            <div class="flex flex-col px-3 py-2 hover:bg-white gap-1">
              {#if item.type === 'dir'}
                <button onclick={() => driveNavigate(item)}
                  class="flex items-center gap-1.5 text-xs text-gray-800 font-mono text-left break-all leading-snug hover:text-green-700">
                  📁 {item.name}
                </button>
              {:else}
                <span class="flex items-start gap-1.5 text-xs text-gray-800 font-mono break-all leading-snug">
                  📄 {item.name}
                </span>
                <div class="flex gap-1.5">
                  <button
                    onclick={() => copyToLocal(item)}
                    disabled={driveBusy || localBusy}
                    class="px-2 py-0.5 rounded text-xs bg-green-50 active:bg-green-200 text-green-700 disabled:opacity-40 border border-green-100"
                  >→ Samples</button>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Footer hint -->
    <div class="px-4 py-2 text-xs text-gray-400 bg-white border-t border-gray-100 shrink-0">
      {driveItems.length} item(s) · "→ Samples" copies file to local samples
    </div>
  </div>
</div>
