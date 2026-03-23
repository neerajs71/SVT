<script>
  import { Drawer, CloseButton, Sidebar, SidebarWrapper, SidebarItem, SidebarGroup } from 'flowbite-svelte';
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

<Drawer bind:hidden={open} placement="left" transitionType="fly" width="w-64" id="sidebar">
  <div class="flex items-center justify-between p-4 bg-green-800 text-white">
    <span class="font-bold tracking-widest text-sm">ACTIVE SIDEBAR</span>
    <CloseButton on:click={() => (open = false)} class="text-white" />
  </div>
  <Sidebar>
    <SidebarWrapper divClass="overflow-y-auto py-4 px-3 bg-gray-900 h-full">
      <SidebarGroup>
        <SidebarItem label="Home" href="/" />
        <SidebarItem label="About" href="/" />
        <SidebarItem label="Services" href="/" />
        <SidebarItem label="Contact" href="/" />
      </SidebarGroup>
    </SidebarWrapper>
  </Sidebar>
</Drawer>
