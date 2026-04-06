<script>
  /**
   * CustomApp — renders a dynamically compiled .svelte component.
   *
   * Flow:
   *  1. Read source from tab.file (local) or Drive
   *  2. POST source to /api/compile — returns transformed JS
   *  3. Load the JS as a blob URL module
   *  4. mount() the default export into the container div
   *
   * The compiled component has access to all $lib modules via window.__SVTC__
   * (set up by initLibs() below) and receives `tab` as a prop.
   */

  import { mount, unmount } from 'svelte';
  import { initLibs } from '$lib/ai/libs.js';

  let { tab } = $props();

  let container = $state(null);
  let status = $state('loading'); // 'loading' | 'error' | 'ready'
  let errorMsg = $state('');
  let mounted = null;

  $effect(() => {
    if (!container) return;

    // Re-run whenever tab changes
    void loadAndMount(tab);

    return () => {
      if (mounted) { unmount(mounted); mounted = null; }
    };
  });

  async function loadAndMount(currentTab) {
    status = 'loading';
    errorMsg = '';

    // Clean up any previous instance
    if (mounted) { unmount(mounted); mounted = null; }

    try {
      // 1. Set up the __SVTC__ globals (no-op if already done)
      await initLibs();

      // 2. Read source
      let source;
      if (currentTab.file) {
        source = await currentTab.file.text();
      } else if (currentTab.driveId) {
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(currentTab.driveId)}`);
        if (!res.ok) throw new Error(`Drive fetch failed (${res.status})`);
        source = await res.text();
      } else {
        throw new Error('No file source available');
      }

      // 3. Compile on server
      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `Compile failed (${res.status})`);

      // 4. Load compiled JS as blob URL
      const blob = new Blob([data.code], { type: 'text/javascript' });
      const url = URL.createObjectURL(blob);

      let Component;
      try {
        const mod = await import(/* @vite-ignore */ url);
        Component = mod.default;
      } finally {
        URL.revokeObjectURL(url);
      }

      if (typeof Component !== 'function') {
        throw new Error('Component did not export a default function');
      }

      // 5. Mount into container
      status = 'ready';
      // Wait a tick for the DOM to update after status change
      await new Promise(r => setTimeout(r, 0));
      mounted = mount(Component, { target: container, props: { tab: currentTab } });

    } catch (e) {
      status = 'error';
      errorMsg = e.message;
    }
  }
</script>

<div class="flex flex-col w-full h-full overflow-hidden bg-white">
  <!-- Status bar -->
  {#if status === 'loading'}
    <div class="flex items-center gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 text-sm text-gray-500">
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
      </svg>
      Compiling {tab.name}…
    </div>
  {:else if status === 'error'}
    <div class="flex flex-col gap-2 p-4 bg-red-50 border-b border-red-200">
      <div class="flex items-center gap-2 text-sm font-semibold text-red-700">
        <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Compile error — {tab.name}
      </div>
      <pre class="text-xs text-red-600 bg-red-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">{errorMsg}</pre>
      <button
        onclick={() => loadAndMount(tab)}
        class="self-start px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700"
      >Retry</button>
    </div>
  {/if}

  <!-- Compiled component mounts here -->
  <div bind:this={container} class="flex-1 overflow-auto"></div>
</div>
