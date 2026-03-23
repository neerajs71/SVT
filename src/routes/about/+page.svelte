<script>
  import { Sidebar } from '$lib/components/Sidebar';
  let sidebarOpen = false;
</script>

<Sidebar bind:open={sidebarOpen} />

<main class="p-8 pl-16 max-w-2xl">
  <a href="/" class="text-sm text-green-800 hover:underline mb-6 inline-block">← Back to Home</a>

  <h1 class="text-3xl font-bold text-green-800 mb-4">About This App</h1>

  <p class="text-gray-600 mb-4">
    SVTC is a SvelteKit Hello World application deployed on Railway. It serves as a
    foundation for building modular, component-driven web apps with a fast and modern stack.
  </p>

  <h2 class="text-xl font-semibold text-green-800 mb-2">Tech Stack</h2>
  <ul class="list-disc list-inside text-gray-600 space-y-1 mb-4">
    <li>SvelteKit — full-stack web framework</li>
    <li>Flowbite Svelte — UI component library</li>
    <li>Tailwind CSS v4 — utility-first styling</li>
    <li>Bun — fast package manager and runtime</li>
    <li>Docker — containerised multi-stage builds</li>
    <li>Railway — hosting with auto-deploy on push</li>
  </ul>

  <h2 class="text-xl font-semibold text-green-800 mb-2">Features</h2>
  <ul class="list-disc list-inside text-gray-600 space-y-1">
    <li>Collapsible sidebar with navigation links</li>
    <li>Apps menu (top-right) for navigating between routes</li>
    <li>Modular component structure under <code class="bg-gray-100 px-1 rounded">src/lib/components/</code></li>
  </ul>
</main>
