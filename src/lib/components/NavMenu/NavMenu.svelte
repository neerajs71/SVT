<script>
  import { Dropdown, DropdownItem, DropdownDivider } from 'flowbite-svelte';
  import { GridOutline } from 'flowbite-svelte-icons';

  let open = false;
</script>

<button
  on:click={() => (open = !open)}
  id="nav-menu-btn"
  class="fixed top-3 right-3 z-50 p-1.5 rounded-md bg-green-800 text-white hover:bg-green-700"
  aria-label="Open app menu"
>
  <GridOutline class="w-5 h-5" />
</button>

<Dropdown
  triggeredBy="#nav-menu-btn"
  bind:open
  class="z-50 w-40 bg-white border border-green-800 shadow-lg rounded-md py-0 overflow-hidden"
>
  <div class="px-3 py-1.5 text-xs font-bold text-green-800 uppercase tracking-wider bg-green-50 border-b border-green-800">
    Apps
  </div>
  <DropdownItem href="/" class="px-3 py-1.5 text-sm text-gray-700 hover:bg-green-50 hover:text-green-800">
    Home
  </DropdownItem>
  <DropdownDivider class="my-0 border-gray-200" />
  <DropdownItem href="/about" class="px-3 py-1.5 text-sm text-gray-700 hover:bg-green-50 hover:text-green-800">
    About
  </DropdownItem>
</Dropdown>
