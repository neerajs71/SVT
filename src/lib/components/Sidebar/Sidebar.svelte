<script>
  import { BarsOutline } from 'flowbite-svelte-icons';
  export let open = false;
</script>

{#if open}
  <aside class="w-52 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
    <div class="flex items-center justify-between px-3 py-1 bg-green-50 border-b border-green-200">
      <span class="text-xs font-bold text-green-800 uppercase tracking-wider">Navigation</span>
      <button
        on:click={() => (open = false)}
        class="text-green-800 hover:text-green-600 p-0.5 leading-none"
        aria-label="Close sidebar"
      >✕</button>
    </div>
    <nav class="flex flex-col">
      <a href="/" class="px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">Home</a>
      <hr class="border-gray-200" />
      <a href="/about" class="px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">About</a>
      <hr class="border-gray-200" />
      <a href="/" class="px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">Services</a>
      <hr class="border-gray-200" />
      <a href="/" class="px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">Contact</a>
    </nav>
  </aside>
{:else}
  <div class="flex-shrink-0 p-2">
    <button
      on:click={() => (open = true)}
      class="p-1.5 rounded-md bg-green-800 text-white hover:bg-green-700"
      aria-label="Open sidebar"
    >
      <BarsOutline class="w-5 h-5" />
    </button>
  </div>
{/if}
