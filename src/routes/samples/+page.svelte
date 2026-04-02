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
  let driveUploadInput;

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
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      localFiles = data.files;
    } catch (e) { localError = e.message; }
    finally { localBusy = false; }
  }

  async function uploadLocalFile(fileObj) {
    const fd = new FormData();
    fd.append('file', fileObj);
    const res = await fetch('/api/samples', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function deleteLocalFile(name) {
    if (!confirm(`Delete "${name}" from samples?`)) return;
    localBusy = true;
    try {
      const res = await fetch(`/api/samples?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
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
      if (!res.ok) throw new Error(await res.text());
      const node = await res.json();
      // node.children is an object {name: {name, type, id, children?}}
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
      if (!res.ok) throw new Error(await res.text());
      const blob = await res.blob();
      const file = new File([blob], item.name, { type: blob.type });
      await uploadLocalFile(file);
      showToast(`Copied "${item.name}" → samples`);
      await refreshLocal();
    } catch (e) { driveError = e.message; }
    finally { driveBusy = false; }
  }

  // ── Copy: local file → Drive ─────────────────────────────────────────────────
  async function copyToDrive(localFile) {
    const folderId = currentDriveFolderId();
    if (!folderId) { driveError = 'Navigate into a Drive folder first'; return; }

    localBusy = true;
    try {
      // Download the local sample file from the static server
      const res = await fetch(`/samples/${encodeURIComponent(localFile.name)}`);
      if (!res.ok) throw new Error(`Cannot read local file: ${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], localFile.name, { type: blob.type });

      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch(`/api/drive?folderId=${encodeURIComponent(folderId)}`, {
        method: 'POST', body: fd
      });
      if (!up.ok) throw new Error(await up.text());
      showToast(`Uploaded "${localFile.name}" → Drive`);
      await refreshDrive(folderId);
    } catch (e) { localError = e.message; }
    finally { localBusy = false; }
  }

  // ── Upload a computer file directly to Drive ──────────────────────────────────
  async function handleDriveUpload(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const folderId = currentDriveFolderId();
    if (!folderId) { driveError = 'Navigate into a Drive folder first'; e.target.value = ''; return; }

    driveBusy = true; driveError = '';
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        const res = await fetch(`/api/drive?folderId=${encodeURIComponent(folderId)}`, {
          method: 'POST', body: fd
        });
        if (!res.ok) throw new Error(await res.text());
      }
      showToast(`Uploaded ${files.length} file(s) to Drive`);
      await refreshDrive(folderId);
    } catch (e) { driveError = e.message; }
    finally { driveBusy = false; e.target.value = ''; }
  }

  // ── Drive: trash file ─────────────────────────────────────────────────────────
  async function deleteDriveFile(item) {
    if (!confirm(`Move "${item.name}" to Drive trash?`)) return;
    driveBusy = true;
    try {
      const res = await fetch(`/api/drive?fileId=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      showToast(`Trashed "${item.name}"`);
      await refreshDrive(currentDriveFolderId());
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
      <div class="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200 shrink-0">{localError}</div>
    {/if}

    <!-- File list -->
    <div class="flex-1 overflow-y-auto">
      {#if localBusy && localFiles.length === 0}
        <div class="p-4 text-xs text-gray-400">Loading…</div>
      {:else if localFiles.length === 0}
        <div class="p-4 text-xs text-gray-400">No files in static/samples/</div>
      {:else}
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="text-left px-3 py-2 font-medium text-gray-600">Name</th>
              <th class="text-right px-3 py-2 font-medium text-gray-600">Size</th>
              <th class="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each localFiles as f (f.name)}
              <tr class="border-b border-gray-100 hover:bg-white group">
                <td class="px-3 py-2 text-gray-800 font-mono truncate max-w-0 w-full">
                  <a href={`/samples/${encodeURIComponent(f.name)}`} target="_blank"
                     class="hover:underline text-blue-700">{f.name}</a>
                </td>
                <td class="px-3 py-2 text-right text-gray-500 whitespace-nowrap">{fmtSize(f.size)}</td>
                <td class="px-2 py-1 whitespace-nowrap">
                  <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      title="Copy to current Drive folder"
                      onclick={() => copyToDrive(f)}
                      disabled={localBusy || driveBusy || !currentDriveFolderId()}
                      class="px-1.5 py-0.5 rounded text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 disabled:opacity-40"
                    >→ Drive</button>
                    <button
                      title="Delete from samples"
                      onclick={() => deleteLocalFile(f.name)}
                      disabled={localBusy}
                      class="px-1.5 py-0.5 rounded text-xs bg-red-50 hover:bg-red-100 text-red-700 disabled:opacity-40"
                    >✕</button>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Footer hint -->
    <div class="px-4 py-2 text-xs text-gray-400 bg-white border-t border-gray-100 shrink-0">
      {localFiles.length} file(s) · "→ Drive" copies to the open Drive folder
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
        <button
          onclick={() => driveUploadInput?.click()}
          disabled={driveBusy || !currentDriveFolderId()}
          title={currentDriveFolderId() ? 'Upload to this Drive folder' : 'Navigate into a folder first'}
          class="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
        >+ Upload</button>
        <input bind:this={driveUploadInput} type="file" multiple class="hidden" onchange={handleDriveUpload} />
      </div>
    </div>

    <!-- Error -->
    {#if driveError}
      <div class="px-4 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200 shrink-0">{driveError}</div>
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
        <table class="w-full text-xs">
          <thead class="sticky top-0 bg-gray-50 border-b border-gray-200">
            <tr>
              <th class="text-left px-3 py-2 font-medium text-gray-600">Name</th>
              <th class="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {#each driveItems as item (item.id)}
              <tr class="border-b border-gray-100 hover:bg-white group">
                <td class="px-3 py-2 text-gray-800 font-mono truncate max-w-0 w-full">
                  {#if item.type === 'dir'}
                    <button onclick={() => driveNavigate(item)}
                      class="flex items-center gap-1.5 hover:text-green-700 hover:underline text-left w-full">
                      <span class="text-gray-400">📁</span>{item.name}
                    </button>
                  {:else}
                    <span class="flex items-center gap-1.5">
                      <span class="text-gray-400">📄</span>{item.name}
                    </span>
                  {/if}
                </td>
                <td class="px-2 py-1 whitespace-nowrap">
                  {#if item.type === 'file'}
                    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        title="Copy to local samples"
                        onclick={() => copyToLocal(item)}
                        disabled={driveBusy || localBusy}
                        class="px-1.5 py-0.5 rounded text-xs bg-green-50 hover:bg-green-100 text-green-700 disabled:opacity-40"
                      >→ Samples</button>
                      <button
                        title="Move to Drive trash"
                        onclick={() => deleteDriveFile(item)}
                        disabled={driveBusy}
                        class="px-1.5 py-0.5 rounded text-xs bg-red-50 hover:bg-red-100 text-red-700 disabled:opacity-40"
                      >✕</button>
                    </div>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Footer hint -->
    <div class="px-4 py-2 text-xs text-gray-400 bg-white border-t border-gray-100 shrink-0">
      {driveItems.length} item(s) · "→ Samples" copies to local samples · "✕" moves to Drive trash
    </div>
  </div>
</div>
