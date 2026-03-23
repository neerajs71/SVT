<script>
  import { Sidebar } from '$lib/components/Sidebar';
  let sidebarOpen = false;
</script>

<Sidebar bind:open={sidebarOpen} />

<main class="p-8 pl-16">
  <h1 class="text-3xl font-bold text-green-800">Hello, World!</h1>
  <p class="mt-2 text-gray-600">Welcome to my SvelteKit app hosted on Railway.</p>
</main>
