<script>
  import { Drawer, CloseButton } from 'flowbite-svelte';
  import { BarsOutline } from 'flowbite-svelte-icons';

  export let open = false;
</script>

<button
  on:click={() => (open = !open)}
  class="fixed top-3 left-3 z-50 p-1.5 rounded-md bg-green-800 text-white hover:bg-green-700"
  aria-label="Open sidebar"
>
  <BarsOutline class="w-5 h-5" />
</button>

<Drawer bind:open placement="left" width="w-64" id="sidebar" dismissable={false} outsideclose={true}>
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
