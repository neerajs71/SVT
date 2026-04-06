# CLAUDE.md — src/

All application source code lives here.

---

## Entry Files

| File | Purpose |
|------|---------|
| `app.html` | HTML shell. `<html>` and `<body>` carry `class="h-full overflow-hidden"` — required for the full-height flex layout. Do not add scripts here. |
| `app.css` | Single CSS entry. Must contain exactly three lines: `@import 'tailwindcss'`, `@import 'flowbite/src/themes/default'`, `@source '../node_modules/flowbite-svelte/dist'`. Imported once in `+layout.svelte`. |

---

## Subdirectories

### `routes/`
SvelteKit file-based routing — pages and API endpoints. See `routes/CLAUDE.md`.

### `lib/components/`
Reusable UI components. Each has its own folder + `index.js` barrel export. See each component's `CLAUDE.md`.

### `lib/tabs/`
`tabs.svelte.js` — `TabState` class (Svelte 5 runes). Singleton `tabStore` manages open tabs.

Tab shape: `{ id, name, ext, file, handle, driveId, dirty }`
- `handle` — `FileSystemFileHandle` from `showDirectoryPicker` (desktop); `null` on iOS/Drive
- `dirty` — boolean, updated via `tabStore.setDirty(id, bool)` by each app

### `lib/datasource/`
Abstracts local (browser File API) and remote (Google Drive) file trees. Singleton `datasourceStore` from `store.svelte.js`.

### `lib/apps/`
File viewer + editor apps. `registry.js` maps extensions → Svelte components. See `apps/CLAUDE.md`.

### `lib/ts/dlis/`
TypeScript modules for binary DLIS well-log parsing. Entry: `ts/dlis/index.ts`.

---

## Conventions

- Components live at `lib/components/<Name>/` with `index.js` barrel; import via `$lib`
- Svelte 5 runes only: `$props()`, `$state()`, `$derived()`, `$effect()`, `{@render children()}`
- Tailwind utility classes only — scoped `<style>` blocks only when unavoidable
- State management: singleton class instances with `$state` fields; no Svelte stores
