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

<Dropdown triggeredBy="#nav-menu-btn" bind:open class="z-50 w-44">
  <div class="px-4 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider">
    Apps
  </div>
  <DropdownDivider />
  <DropdownItem href="/about">About</DropdownItem>
</Dropdown>
