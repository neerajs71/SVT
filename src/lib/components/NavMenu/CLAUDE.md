# CLAUDE.md — src/lib/components/NavMenu/

Fixed top-right apps menu button that opens a Flowbite Dropdown to navigate between routes.

---

## Files

| File | Purpose |
|------|---------|
| `NavMenu.svelte` | `GridOutline` button + Flowbite Dropdown |
| `index.js` | Barrel export |

---

## Usage

Mounted once in `+layout.svelte` — appears on every page. No props.

```svelte
<script>
  import { NavMenu } from '$lib/components/NavMenu';
</script>
<NavMenu />
```

---

## Styling

- Button: `fixed top-3 right-3 z-50 p-1.5 rounded-md bg-green-800 text-white`
- Icon: `GridOutline` from `flowbite-svelte-icons`
- Dropdown triggered by `id="nav-menu-btn"` on the button

---

## Current Routes

| Label | Path | Description |
|-------|------|-------------|
| About | `/about` | Tech stack and feature overview |

---

## Adding a New Route

1. Create `src/routes/<name>/+page.svelte`
2. Add a `DropdownItem` in `NavMenu.svelte`:

```svelte
<DropdownItem href="/<name>">Label</DropdownItem>
```
