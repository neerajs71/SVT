<script>
  import { Sidebar } from '$lib/components/Sidebar';
  import SimpleTabs from '$lib/components/SimpleTabs/SimpleTabs.svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { onMount } from 'svelte';
  let sidebarOpen = $state(false);

  // Dev: auto-open one file of each type on load
  const DEV_EXTS = ['.wson', '.dlis', '.las'];

  function findFiles(node, results = {}, parentPath = '') {
    if (!node) return results;
    const path = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (node.type === 'file') {
      const ext = node.name.includes('.') ? '.' + node.name.split('.').pop().toLowerCase() : '';
      if (DEV_EXTS.includes(ext) && !results[ext]) {
        results[ext] = { ...node, path };
      }
    }
    if (node.children) {
      for (const child of Object.values(node.children)) {
        findFiles(child, results, path);
        if (Object.keys(results).length === DEV_EXTS.length) break;
      }
    }
    return results;
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/drive');
      if (!res.ok) return;
      const tree = await res.json();
      const found = findFiles(tree);
      for (const ext of DEV_EXTS) {
        if (found[ext]) tabStore.openFile(found[ext]);
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
