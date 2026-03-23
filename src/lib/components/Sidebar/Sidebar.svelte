<script>
  import { Drawer, CloseButton } from 'flowbite-svelte';
  import { BarsOutline } from 'flowbite-svelte-icons';

  export let open = false;
</script>

<button
  on:click={() => (open = true)}
  class="fixed top-4 left-4 z-50 p-2 rounded-lg bg-green-800 text-white hover:bg-green-700"
  aria-label="Open sidebar"
>
  <BarsOutline class="w-6 h-6" />
</button>

<Drawer open={open} placement="left" width="w-64" id="sidebar" on:clickOutside={() => (open = false)}>
  <div class="flex items-center justify-between p-4 bg-green-800 text-white">
    <span class="font-bold tracking-widest text-sm">ACTIVE SIDEBAR</span>
    <CloseButton on:click={() => (open = false)} class="text-white focus:ring-0" />
  </div>
  <nav class="flex flex-col py-4 bg-gray-900 h-full">
    <a href="/" class="px-6 py-3 text-gray-300 hover:bg-gray-700 hover:text-white font-sans">Home</a>
    <a href="/" class="px-6 py-3 text-gray-300 hover:bg-gray-700 hover:text-white font-sans">About</a>
    <a href="/" class="px-6 py-3 text-gray-300 hover:bg-gray-700 hover:text-white font-sans">Services</a>
    <a href="/" class="px-6 py-3 text-gray-300 hover:bg-gray-700 hover:text-white font-sans">Contact</a>
  </nav>
</Drawer>
