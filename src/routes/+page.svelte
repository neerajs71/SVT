<script>
  import { Sidebar } from '$lib/components/Sidebar';
  import SimpleTabs from '$lib/components/SimpleTabs/SimpleTabs.svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { onMount } from 'svelte';

  const { data } = $props();
  let sidebarOpen = $state(false);

  onMount(() => {
    for (const f of data.devTabs ?? []) {
      tabStore.openFile(f);
    }
  });
</script>

<div class="flex h-full overflow-hidden">
  <Sidebar bind:open={sidebarOpen} />
  <main class="flex-1 overflow-hidden">
    <SimpleTabs />
  </main>
</div>
