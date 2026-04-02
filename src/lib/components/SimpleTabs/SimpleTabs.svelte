<script>
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { getApp } from '$lib/apps/registry.js';
</script>

{#if tabStore.tabs.length === 0}
  <div class="h-full flex items-center justify-center text-gray-400 text-sm select-none">
    Open a file from the explorer to get started
  </div>
{:else}
  <div class="flex flex-col h-full overflow-hidden">

    <!-- Tab bar -->
    <div class="flex items-end border-b border-gray-200 bg-gray-50 overflow-x-auto flex-shrink-0">
      {#each tabStore.tabs as tab (tab.id)}
        {@const isActive = tab.id === tabStore.activeId}
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-r border-gray-200 flex-shrink-0 max-w-[160px] min-w-0
                 {isActive
                   ? 'bg-white text-green-800 border-t-2 border-t-green-700 -mb-px'
                   : 'bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700'}"
          onclick={() => tabStore.setActive(tab.id)}
          title={tab.name}
        >
          <span class="truncate flex-1 min-w-0">{tab.name}</span>
          <span
            class="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 leading-none"
            role="button"
            tabindex="0"
            aria-label="Close {tab.name}"
            onclick={(e) => { e.stopPropagation(); tabStore.closeTab(tab.id); }}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tabStore.closeTab(tab.id); } }}
          >✕</span>
        </button>
      {/each}
    </div>

    <!-- Tab contents — all mounted, active one visible -->
    <div class="flex-1 overflow-hidden relative">
      {#each tabStore.tabs as tab (tab.id)}
        {@const AppComponent = getApp(tab.ext)}
        <div class="absolute inset-0 overflow-hidden"
             style="display:{tab.id === tabStore.activeId ? 'block' : 'none'}">
          <AppComponent tab={tab} />
        </div>
      {/each}
    </div>

  </div>
{/if}
