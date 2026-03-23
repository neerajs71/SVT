# CLAUDE.md — src/routes/

SvelteKit file-based routing. Each file here maps to a URL route.

---

## Files

### `+layout.svelte`
Root layout — wraps every page. Only responsibility is importing `app.css` so Tailwind and Flowbite styles are available globally.

```svelte
<script>
  import '../app.css';
</script>

<slot />
```

**Important:** Do not add page-specific content here. Keep it as a pure CSS loader.

### `+page.svelte`
The single page at `/`. Renders the Hello World content and mounts the Sidebar.

```svelte
<script>
  import { Sidebar } from '$lib/components/Sidebar';
  let sidebarOpen = false;
</script>

<Sidebar bind:open={sidebarOpen} />

<main class="p-8 pl-16">
  <h1 class="text-3xl font-bold text-green-800">Hello, World!</h1>
  <p class="mt-2 text-gray-600">Welcome to my SvelteKit app hosted on Railway.</p>
</main>
```

**Key points:**
- `sidebarOpen` is the single source of truth for sidebar state
- `bind:open={sidebarOpen}` keeps parent and Sidebar in two-way sync
- `pl-16` gives left padding so content clears the hamburger button
- Heading colour is Tailwind `text-green-800` (dark green, `#006400`)

---

## Adding New Pages

Create `src/routes/about/+page.svelte` for `/about`, etc. Import and use the Sidebar the same way if the new page needs it.
