<script>
  import { Sidebar } from '$lib/components/Sidebar';
  import SimpleTabs from '$lib/components/SimpleTabs/SimpleTabs.svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { datasourceStore } from '$lib/datasource/store.svelte.js';
  import { SAMPLE_TABS } from '$lib/samples/index.js';

  let sidebarOpen = $state(false);
  let samplesOpened = false;

  // Traverse the Drive tree, lazy-loading folders as needed, then open the file
  async function openByPath(fullPath) {
    const parts = fullPath.split('/');
    let node = datasourceStore.tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!node?.children) return;

      // Lazy-load folder if empty
      if (node.type === 'dir' && node.id && Object.keys(node.children).length === 0) {
        const res = await fetch(`/api/drive?folderId=${encodeURIComponent(node.id)}`);
        if (!res.ok) return;
        const data = await res.json();
        node.children = data.children ?? {};
      }

      // Case-insensitive lookup
      const child = node.children[part]
        ?? Object.values(node.children).find(c => c.name.toLowerCase() === part.toLowerCase());
      if (!child) return; // path not found

      if (i === parts.length - 1) {
        // This is the file — open it (same as sidebar click)
        tabStore.openFile({ name: child.name, id: child.id, path: fullPath });
      } else {
        node = child;
      }
    }
  }

  // When tree first loads, open sample tabs once
  $effect(() => {
    if (!samplesOpened && datasourceStore.tree && !datasourceStore.loading) {
      samplesOpened = true;
      for (const path of SAMPLE_TABS) openByPath(path);
    }
  });
</script>

<div class="flex h-full overflow-hidden">
  <Sidebar bind:open={sidebarOpen} />
  <main class="flex-1 overflow-hidden">
    <SimpleTabs />
  </main>
</div>
