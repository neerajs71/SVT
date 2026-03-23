<script>
  import { FolderOpenSolid, FolderSolid, FolderOutline, FileLinesOutline } from 'flowbite-svelte-icons';

  export let open = false;

  let fileInput;
  let tree = null;
  let expanded = new Set();

  function handleFiles(e) {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    tree = buildTree(files);
    // auto-expand the root folder
    const rootName = files[0].webkitRelativePath.split('/')[0];
    expanded = new Set([rootName]);
  }

  function buildTree(files) {
    const root = { name: '', children: {}, type: 'dir' };
    for (const file of files) {
      const parts = file.webkitRelativePath.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          node.children[part] = { name: part, type: 'file' };
        } else {
          if (!node.children[part]) {
            node.children[part] = { name: part, children: {}, type: 'dir' };
          }
          node = node.children[part];
        }
      }
    }
    return root;
  }

  function flatten(node, depth = 0, parentPath = '') {
    const items = [];
    const entries = Object.values(node.children).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of entries) {
      const path = parentPath ? `${parentPath}/${child.name}` : child.name;
      items.push({ name: child.name, type: child.type, depth, path, hasChildren: child.type === 'dir' && Object.keys(child.children).length > 0, node: child });
      if (child.type === 'dir' && expanded.has(path)) {
        items.push(...flatten(child, depth + 1, path));
      }
    }
    return items;
  }

  function toggleDir(path) {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    expanded = new Set(expanded);
  }

  $: visibleItems = tree ? flatten(tree) : [];
</script>

{#if open}
  <aside style="width:10.4rem" class="flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
    <!-- Header band -->
    <div class="flex items-center gap-1 px-2 py-1 bg-green-50 border-b border-green-200">
      <FolderOpenSolid class="w-4 h-4 text-green-800 flex-shrink-0" />
      <span class="text-xs font-bold text-green-800 uppercase tracking-wider flex-1 truncate">Explorer</span>
      <button
        on:click={() => fileInput.click()}
        title="Open folder"
        class="text-green-700 hover:text-green-900 p-0.5 flex-shrink-0"
        aria-label="Open local folder"
      >
        <FolderOpenSolid class="w-3.5 h-3.5" />
      </button>
      <button
        on:click={() => (open = false)}
        class="text-green-800 hover:text-green-600 p-0.5 leading-none flex-shrink-0 text-xs"
        aria-label="Close sidebar"
      >✕</button>
    </div>

    <!-- Hidden directory picker -->
    <input
      bind:this={fileInput}
      type="file"
      class="hidden"
      webkitdirectory
      on:change={handleFiles}
    />

    <!-- Tree or empty state -->
    <div class="flex-1 overflow-y-auto overflow-x-hidden text-xs">
      {#if visibleItems.length === 0}
        <p class="px-3 py-4 text-gray-400 text-center leading-snug">
          Click <FolderOpenSolid class="inline w-3 h-3" /> to open a local folder
        </p>
      {:else}
        {#each visibleItems as item (item.path)}
          <button
            class="w-full text-left flex items-center gap-1 py-0.5 pr-2 hover:bg-green-50 truncate"
            style="padding-left: {0.5 + item.depth * 0.75}rem"
            on:click={() => item.type === 'dir' && toggleDir(item.path)}
          >
            {#if item.type === 'dir'}
              {#if expanded.has(item.path)}
                <FolderOpenSolid class="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
              {:else}
                <FolderSolid class="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
              {/if}
            {:else}
              <FileLinesOutline class="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            {/if}
            <span class="truncate text-gray-800">{item.name}</span>
          </button>
        {/each}
      {/if}
    </div>
  </aside>
{:else}
  <div class="flex-shrink-0 p-2">
    <button
      on:click={() => (open = true)}
      class="p-1.5 rounded-md bg-green-800 text-white hover:bg-green-700"
      aria-label="Open explorer"
    >
      <FolderOpenSolid class="w-5 h-5" />
    </button>
  </div>
{/if}
