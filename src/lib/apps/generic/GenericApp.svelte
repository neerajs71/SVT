<script>
  import { onMount } from 'svelte';

  let { tab } = $props();

  let content = $state(null);
  let loading = $state(true);
  let error = $state(null);

  onMount(async () => {
    try {
      if (tab.file) {
        // Local mode — read from File object
        content = await tab.file.text();
      } else if (tab.driveId) {
        // Remote mode — fetch via API
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`);
        if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
        content = await res.text();
      } else {
        content = '(no content source available)';
      }
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  });
</script>

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
    <div class="px-3 py-1.5 border-b border-gray-200 bg-gray-50 text-xs text-gray-500 font-mono flex-shrink-0">
      {tab.name}
    </div>
    <pre class="flex-1 overflow-auto p-4 text-xs font-mono text-gray-800 leading-relaxed whitespace-pre-wrap break-words">{content}</pre>
  {/if}
</div>
