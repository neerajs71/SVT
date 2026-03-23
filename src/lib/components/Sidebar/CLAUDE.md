# CLAUDE.md — src/lib/components/Sidebar/

Reusable collapsible sidebar built on the Flowbite Svelte `Drawer` component.

---

## Files

| File | Purpose |
|------|---------|
| `Sidebar.svelte` | The full sidebar component |
| `index.js` | Barrel export — `export { default as Sidebar } from './Sidebar.svelte'` |

---

## Usage

```svelte
<script>
  import { Sidebar } from '$lib/components/Sidebar';
  let sidebarOpen = false;
</script>

<Sidebar bind:open={sidebarOpen} />
```

`open` is the only prop. Use `bind:open` for two-way sync so the parent can read/write sidebar state.

---

## Component Breakdown

### Hamburger Button
```svelte
<button
  on:click={() => (open = !open)}
  class="fixed top-2 left-0 z-50 p-1 rounded-r-md bg-green-800 text-white hover:bg-green-700"
>
  <BarsOutline class="w-4 h-4" />
</button>
```
- `fixed top-2 left-0` — flush to the left edge of the screen
- `rounded-r-md` — only right side rounded (attached-to-edge look)
- `p-1` + `w-4 h-4` — extra small size
- Toggles `open` on every click (`!open`)
- `z-50` keeps it above page content but the Drawer sits above it when open

### Drawer (Flowbite)
```svelte
<Drawer bind:open placement="left" width="w-64" id="sidebar"
        dismissable={false} outsideclose={true}>
```

| Prop | Value | Reason |
|------|-------|--------|
| `bind:open` | — | Two-way binding so CloseButton can update parent state |
| `placement` | `"left"` | Slides in from the left |
| `width` | `"w-64"` | 256px wide |
| `dismissable` | `false` | Disables Flowbite's built-in X button (we provide our own) |
| `outsideclose` | `true` | Clicking the backdrop closes the drawer |

**Critical:** `dismissable={false}` is required. Without it the `Dialog` component inside `Drawer` renders its own `CloseButton`, resulting in two X buttons.

### Sidebar Header
```svelte
<div class="flex items-center justify-between p-4 bg-green-800 text-white">
  <span class="font-bold tracking-widest text-sm">ACTIVE SIDEBAR</span>
  <CloseButton on:click={() => (open = false)} class="text-white focus:ring-0" />
</div>
```
- Dark green (`bg-green-800`) header bar
- `ACTIVE SIDEBAR` label in bold small caps
- Single X close button — sets `open = false`

### Nav Links
```svelte
<nav class="flex flex-col py-4 bg-gray-900 h-full">
  <a href="/" class="px-6 py-3 text-gray-300 hover:bg-gray-700 hover:text-white font-sans">Home</a>
  ...
</nav>
```
Plain `<a>` tags with Tailwind hover states on a dark (`bg-gray-900`) background. **Do not** use Flowbite `SidebarItem` components — they conflict with the Drawer and fail to render content.

---

## Known Pitfalls

| Issue | Cause | Fix |
|-------|-------|-----|
| Two X close buttons appear | `dismissable` defaults to `true` in Flowbite's `Dialog` | Set `dismissable={false}` on `<Drawer>` |
| Sidebar never opens | Using deprecated `hidden` prop | Use `open` prop (Flowbite Svelte v1+) |
| Sidebar opens but content is empty | Using Flowbite `SidebarItem` inside `Drawer` | Use plain `<a>` tags instead |
| Close button doesn't work | `open={open}` is one-way | Use `bind:open` for two-way binding |

---

## Icons

Uses `flowbite-svelte-icons`. The hamburger icon is `BarsOutline` (not `MenuOutline` — that export does not exist in the installed version).

```js
import { BarsOutline } from 'flowbite-svelte-icons';
```
