<script>
  import { Sidebar } from '$lib/components/Sidebar';
  let sidebarOpen = false;
</script>

<div class="flex min-h-screen">
  <Sidebar bind:open={sidebarOpen} />
  <main class="flex-1 p-8">
    <h1 class="text-3xl font-bold text-green-800">Hello, World!</h1>
    <p class="mt-2 text-gray-600">Welcome to my SvelteKit app hosted on Railway.</p>
  </main>
</div>
