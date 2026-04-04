<script>
  import { onMount } from 'svelte';

  let { tab } = $props();

  let content   = $state('');
  let original  = $state('');
  let dirty     = $derived(content !== original);
  let loading   = $state(true);
  let error     = $state(null);
  let saving    = $state(false);
  let saveError = $state(null);

  const canSave = $derived(!!tab.handle && typeof tab.handle.createWritable === 'function');

  onMount(async () => {
    try {
      if (tab.file) {
        content = await tab.file.text();
      } else if (tab.driveId) {
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`);
        if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
        content = await res.text();
      } else {
        content = '(no content source available)';
      }
      original = content;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  });

  async function save() {
    if (!canSave || saving) return;
    saving = true;
    saveError = null;
    try {
      const w = await tab.handle.createWritable();
      await w.write(content);
      await w.close();
      original = content;
    } catch (e) {
      saveError = e.message;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
}} />

<div class="h-full flex flex-col overflow-hidden bg-white">
  {#if loading}
    <div class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      Loading {tab.name}…
    </div>
  {:else if error}
    <div class="flex-1 flex items-center justify-center text-red-500 text-sm p-4">
      Error: {error}
    </div>
  {:else}
    <!-- Header bar -->
    <div class="px-3 py-1.5 border-b border-gray-200 bg-gray-50 flex items-center gap-2 flex-shrink-0">
      <span class="text-xs text-gray-500 font-mono flex-1 truncate">
        {tab.name}{#if dirty}<span class="text-orange-500 ml-1">•</span>{/if}
      </span>
      {#if canSave}
        <button
          onclick={save}
          disabled={!dirty || saving}
          class="text-xs px-2 py-0.5 rounded border
                 {dirty && !saving
                   ? 'border-blue-400 text-blue-600 hover:bg-blue-50 active:bg-blue-100'
                   : 'border-gray-200 text-gray-300 cursor-default'}"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      {:else}
        <span class="text-xs text-gray-300" title="Read-only: file handle not available (Drive or iOS)">
          Read-only
        </span>
      {/if}
    </div>

    <!-- Save error banner -->
    {#if saveError}
      <div class="px-3 py-1.5 bg-red-50 border-b border-red-200 text-xs text-red-600 flex items-center gap-2 flex-shrink-0">
        <span class="flex-1">{saveError}</span>
        <button onclick={() => saveError = null} class="text-red-400 hover:text-red-600">✕</button>
      </div>
    {/if}

    <!-- Editable content -->
    <textarea
      bind:value={content}
      spellcheck="false"
      class="flex-1 p-4 text-xs font-mono text-gray-800 leading-relaxed resize-none outline-none bg-white"
    ></textarea>
  {/if}
</div>
