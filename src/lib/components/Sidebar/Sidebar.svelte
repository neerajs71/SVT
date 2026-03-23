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

<Drawer bind:open placement="left" width="w-52" id="sidebar" dismissable={false} outsideclose={true}>
  <div class="flex items-center justify-between px-3 py-1 bg-green-50 border-b border-green-200">
    <span class="text-xs font-bold text-green-800 uppercase tracking-wider">Navigation</span>
    <CloseButton on:click={() => (open = false)} class="text-green-800 focus:ring-0 p-0.5" />
  </div>
  <nav class="flex flex-col bg-white h-full">
    <a href="/" class="px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">Home</a>
    <hr class="border-gray-200" />
    <a href="/about" class="px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">About</a>
    <hr class="border-gray-200" />
    <a href="/" class="px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">Services</a>
    <hr class="border-gray-200" />
    <a href="/" class="px-3 py-1.5 text-sm text-gray-800 hover:bg-green-50 hover:text-green-800">Contact</a>
  </nav>
</Drawer>
