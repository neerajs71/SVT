<script>
  import { Sidebar } from '$lib/components/Sidebar';
  let sidebarOpen = false;
</script>

<Sidebar bind:open={sidebarOpen} />

<main class:shifted={sidebarOpen}>
  <h1>Hello, World!</h1>
  <p>Welcome to my SvelteKit app hosted on Railway.</p>
</main>

<style>
  main {
    padding: 2rem 2rem 2rem 4rem;
    transition: margin-left 0.3s ease;
    font-family: sans-serif;
  }

  main.shifted {
    margin-left: 240px;
  }

  h1 {
    color: #006400;
  }

  p {
    color: #333;
  }
</style>
