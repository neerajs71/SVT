# CLAUDE.md — src/lib/components/Sidebar/

Collapsible file-browser sidebar built on Flowbite Svelte `Drawer`. Supports local folder upload and Google Drive browsing.

---

## Files

| File | Purpose |
|------|---------|
| `Sidebar.svelte` | Full sidebar component |
| `index.js` | Barrel export |

---

## Usage

```svelte
<script>
  import { Sidebar } from '$lib/components/Sidebar';
  let sidebarOpen = $state(false);
</script>

<Sidebar bind:open={sidebarOpen} />
```

`open` is the only prop. Use `bind:open` for two-way sync.

---

## Component Breakdown

### Hamburger Button
```svelte
<button
  onclick={() => (open = !open)}
  class="fixed top-2 left-0 z-50 p-1 rounded-r-md bg-green-800 text-white hover:bg-green-700"
>
  <BarsOutline class="w-4 h-4" />
</button>
```
- `fixed top-2 left-0` — flush to the left edge
- `rounded-r-md` — only right side rounded (edge-attached look)
- Icon: `BarsOutline` from `flowbite-svelte-icons` (not `MenuOutline` — that export doesn't exist)

### Drawer (Flowbite)
```svelte
<Drawer bind:open placement="left" width="w-64" id="sidebar"
        dismissable={false} outsideclose={true}>
```

| Prop | Value | Reason |
|------|-------|--------|
| `bind:open` | — | Two-way binding |
| `placement` | `"left"` | Slides in from left |
| `width` | `"w-64"` | 256 px |
| `dismissable` | `false` | Suppresses Flowbite's built-in X (we provide our own) |
| `outsideclose` | `true` | Clicking backdrop closes drawer |

**Critical:** `dismissable={false}` is required — without it two X buttons appear.

### Sidebar Header
Dark green (`bg-green-800`) bar with title and a `CloseButton` that sets `open = false`.

### File Tree
- Reads from `datasourceStore` (from `$lib/datasource`)
- Clicking a file calls `tabStore.openFile(item)` (from `$lib/tabs/tabs.svelte.js`)
- Folders expand/collapse via `datasourceStore.toggleExpanded(path, id)`
- Remote folders are lazy-loaded on first expand

### Bottom Buttons
- **Mode toggle** — switches between local and remote (Google Drive)
- **Open Folder** — shown in local mode only; triggers `<input webkitdirectory>`

---

## Known Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| Two X buttons | `dismissable` defaults to `true` | Set `dismissable={false}` |
| Sidebar never opens | Using deprecated `hidden` prop | Use `open` prop |
| Close button doesn't work | One-way `open={open}` | Use `bind:open` |
| Sidebar opens but content empty | Using Flowbite `SidebarItem` inside `Drawer` | Use plain `<a>` or `<button>` tags |
