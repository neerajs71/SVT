<script>
  import { Sidebar } from '$lib/components/Sidebar';
  import SimpleTabs from '$lib/components/SimpleTabs/SimpleTabs.svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { onMount } from 'svelte';
  let sidebarOpen = $state(false);

  onMount(async () => {
    try {
      const res = await fetch('/api/dev-tabs');
      if (!res.ok) return;
      const files = await res.json();
      for (const f of files) {
        tabStore.openFile(f);
      }
    } catch { /* ignore in local mode */ }
  });
</script>

<div class="flex h-full overflow-hidden">
  <Sidebar bind:open={sidebarOpen} />
  <main class="flex-1 overflow-hidden">
    <SimpleTabs />
  </main>
</div>
