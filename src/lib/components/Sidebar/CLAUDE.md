# CLAUDE.md — Sidebar

Collapsible file-browser sidebar built on Flowbite `Drawer`. Supports local folder upload (File System Access API on desktop, `<input webkitdirectory>` on iOS) and Google Drive browsing.

---

## Files

| File | Purpose |
|------|---------|
| `Sidebar.svelte` | Full sidebar component |
| `index.js` | Barrel export |

---

## Usage

```svelte
import { Sidebar } from '$lib/components/Sidebar';
let sidebarOpen = $state(false);

<Sidebar bind:open={sidebarOpen} />
```

`open` is the only prop. Use `bind:open` for two-way sync.

---

## Structure

| Part | Description |
|------|-------------|
| Hamburger button | `fixed top-2 left-0`, `BarsOutline` icon, toggles `open` |
| Drawer | `placement="left"`, `dismissable={false}`, `outsideclose={true}` |
| Header bar | Dark green, title, close button |
| File tree | Reads `datasourceStore`; click → `tabStore.openFile(item)`; folder toggle → `datasourceStore.toggleExpanded()` |
| Bottom bar | Mode toggle (local ↔ Drive) + Open Folder button |
| Resize handle | Drag right edge to resize sidebar width |

---

## Critical Drawer Props

```svelte
<Drawer bind:open placement="left" width="w-64"
        dismissable={false} outsideclose={true}>
```

- `dismissable={false}` — prevents Flowbite rendering a second X button
- Use `open` prop not deprecated `hidden`
- Always `bind:open`, not one-way `open={open}`

---

## File Handle Behaviour

- Desktop Chrome/Edge via `showDirectoryPicker` → tree nodes carry a `FileSystemFileHandle`; `tabStore` stores it as `tab.handle` for in-place saving
- iOS / legacy `<input webkitdirectory>` → no handle; `tab.handle` is `null`; apps show Download button instead of Save
