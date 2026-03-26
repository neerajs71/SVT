<script>
  import { Sidebar } from '$lib/components/Sidebar';
  import SimpleTabs from '$lib/components/SimpleTabs/SimpleTabs.svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { onMount } from 'svelte';
  let sidebarOpen = $state(false);

  // Dev: auto-open one file of each type on load
  const DEV_EXTS = ['.wson', '.dlis', '.las'];

  async function fetchFolder(folderId) {
    const res = await fetch(`/api/drive?folderId=${encodeURIComponent(folderId)}`);
    if (!res.ok) return {};
    const data = await res.json();
    return data.children || {};
  }

  // BFS with lazy folder fetching to find first file of each target extension
  async function findFilesDeep(tree) {
    const results = {};
    const queue = [];

    for (const child of Object.values(tree.children || {})) {
      queue.push({ node: child, path: child.name });
    }

    while (queue.length > 0 && Object.keys(results).length < DEV_EXTS.length) {
      const { node, path } = queue.shift();

      if (node.type === 'file') {
        const ext = node.name.includes('.') ? '.' + node.name.split('.').pop().toLowerCase() : '';
        if (DEV_EXTS.includes(ext) && !results[ext]) {
          results[ext] = { ...node, path };
        }
      } else {
        let children = node.children || {};
        if (Object.keys(children).length === 0 && node.id) {
          children = await fetchFolder(node.id);
        }
        for (const child of Object.values(children)) {
          queue.push({ node: child, path: `${path}/${child.name}` });
        }
      }
    }

    return results;
  }

  onMount(async () => {
    try {
      const res = await fetch('/api/drive');
      if (!res.ok) return;
      const tree = await res.json();
      const found = await findFilesDeep(tree);
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
