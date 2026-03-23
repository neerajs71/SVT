# CLAUDE.md — src/lib/components/NavMenu/

App navigation menu — fixed top-right button that opens a dropdown to navigate between app routes.

---

## Files

| File | Purpose |
|------|---------|
| `NavMenu.svelte` | Grid icon button + Flowbite Dropdown |
| `index.js` | Barrel export |

---

## Usage

Mounted once in `+layout.svelte` so it appears on every page:

```svelte
<script>
  import { NavMenu } from '$lib/components/NavMenu';
</script>

<NavMenu />
<slot />
```

No props — fully self-contained.

---

## Adding a New App / Route

1. Create the route: `src/routes/<name>/+page.svelte`
2. Add a `DropdownItem` in `NavMenu.svelte`:

```svelte
<DropdownItem href="/<name>">App Name</DropdownItem>
```

---

## Component Notes

- Uses Flowbite `Dropdown` triggered by `#nav-menu-btn` ID
- Icon: `GridOutline` from `flowbite-svelte-icons` (represents apps grid)
- Button mirrors the Sidebar hamburger style: `fixed top-3 right-3 z-50 p-1.5 rounded-md bg-green-800`
- Dropdown has an **Apps** section header and a divider before the links

## Current Routes

| Label | Path | Description |
|-------|------|-------------|
| About | `/about` | Tech stack and feature overview of the app |
