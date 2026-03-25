# CLAUDE.md — src/routes/

SvelteKit file-based routing. Each file maps to a URL.

---

## Files

### `+layout.svelte`
Root layout — wraps every page. Three responsibilities:
1. Imports `app.css` (Tailwind + Flowbite globally)
2. Renders `<NavMenu />` so the top-right app menu appears on every page
3. Injects `virtual-mouse.js` on `onMount` for tablet cursor emulation

```svelte
<script>
  import '../app.css';
  import { NavMenu } from '$lib/components/NavMenu';
  import { onMount } from 'svelte';
  let { children } = $props();

  onMount(() => {
    const s = document.createElement('script');
    s.src = '/virtual-mouse.js';
    document.body.appendChild(s);
  });
</script>

<NavMenu />
<div class="h-full overflow-hidden">
  {@render children()}
</div>
```

**Do not** add page-specific content here.

### `+page.svelte` — `/`
Home page. Renders the Sidebar file-browser alongside the `SimpleTabs` tab viewer.

```svelte
<script>
  import { Sidebar } from '$lib/components/Sidebar';
  import SimpleTabs from '$lib/components/SimpleTabs/SimpleTabs.svelte';
  let sidebarOpen = $state(false);
</script>

<div class="flex h-full overflow-hidden">
  <Sidebar bind:open={sidebarOpen} />
  <main class="flex-1 overflow-hidden">
    <SimpleTabs />
  </main>
</div>
```

### `about/+page.svelte` — `/about`
Static about page describing the tech stack and features.

### `apps/+page.svelte` — `/apps`
Placeholder page for the apps section.

### `api/drive/+server.js` — `GET /api/drive`
Server-side Google Drive proxy. See root `CLAUDE.md` for API details.

---

## Adding New Pages

1. Create `src/routes/<name>/+page.svelte`
2. Add a `DropdownItem` in `NavMenu.svelte` pointing to `/<name>`
3. If the page needs file browsing, use `<Sidebar bind:open={...} />` and `<SimpleTabs />`
