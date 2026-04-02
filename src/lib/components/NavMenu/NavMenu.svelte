<script>
  import { GridOutline } from 'flowbite-svelte-icons';

  let open = $state(false);

  function close(e) {
    if (!e.target.closest('#nav-menu-wrapper')) open = false;
  }
</script>

<svelte:window onclick={close} />

<div id="nav-menu-wrapper" class="fixed top-3 right-3 z-50">
  <button
    onclick={(e) => { e.stopPropagation(); open = !open; }}
    class="p-1.5 rounded-md bg-green-800 text-white hover:bg-green-700"
    aria-label="Open app menu"
  >
    <GridOutline class="w-5 h-5" />
  </button>

  {#if open}
    <div class="absolute right-0 mt-1 w-36 bg-white border border-green-800 rounded-md shadow-md overflow-hidden">
      <div class="px-3 py-1 text-xs font-bold text-green-800 uppercase tracking-wider bg-green-50 border-b border-green-200">
        Apps
      </div>
      <a href="/" onclick={() => (open = false)}
        class="block px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">
        Home
      </a>
      <a href="/samples" onclick={() => (open = false)}
        class="block px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">
        Samples
      </a>
      <hr class="border-gray-200" />
      <a href="/about" onclick={() => (open = false)}
        class="block px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">
        About
      </a>
    </div>
  {/if}
</div>
