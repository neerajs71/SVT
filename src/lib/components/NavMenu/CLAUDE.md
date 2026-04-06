# CLAUDE.md — NavMenu

Fixed top-right navigation menu. A `GridOutline` icon button opens a Flowbite Dropdown to navigate between app routes.

---

## Files

| File | Purpose |
|------|---------|
| `NavMenu.svelte` | Icon button + Flowbite Dropdown |
| `index.js` | Barrel export |

---

## Usage

Mounted once in `+layout.svelte`. No props.

```svelte
import { NavMenu } from '$lib/components/NavMenu';
<NavMenu />
```

---

## Adding a Route

1. Create `src/routes/<name>/+page.svelte`
2. Add inside the Dropdown in `NavMenu.svelte`:

```svelte
<DropdownItem href="/<name>">Label</DropdownItem>
```

---

## Styling Notes

- Button: `fixed top-3 right-3 z-50 p-1.5 rounded-md bg-green-800 text-white`
- Icon: `GridOutline` from `flowbite-svelte-icons`
- Dropdown triggered by `id="nav-menu-btn"` matching `triggeredBy` on `<Dropdown>`
