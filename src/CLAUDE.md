# CLAUDE.md — src/

All application source code lives here.

---

## Files

### `app.html`
HTML shell. SvelteKit injects `%sveltekit.head%` and `%sveltekit.body%`. The `<html>` and `<body>` tags carry `class="h-full overflow-hidden"` — required for the full-height flex layout to work correctly. Do not add global scripts here.

### `app.css`
Single CSS entry point. Must contain exactly:

```css
@import 'tailwindcss';
@import 'flowbite/src/themes/default';
@source '../node_modules/flowbite-svelte/dist';
```

- Line 1: Tailwind CSS v4 (no config file needed)
- Line 2: Flowbite default colour theme
- Line 3: Tells Tailwind to scan Flowbite Svelte components so their classes are not purged

Imported once in `routes/+layout.svelte`.

---

## Subdirectories

### `routes/`
SvelteKit file-based routing. See `routes/CLAUDE.md`.

### `lib/components/`
Reusable UI components. Each component has its own folder with an `index.js` barrel export.

### `lib/tabs/`
`tabs.svelte.js` — `TabState` class using Svelte 5 runes. Singleton `tabStore` manages open tabs.

### `lib/datasource/`
Data source abstraction for local (browser File API) and remote (Google Drive) file trees. `store.svelte.js` exposes singleton `datasourceStore`.

### `lib/apps/`
File viewer apps. `registry.js` maps file extensions to Svelte components. Each app receives a `tab` prop: `{ id, name, ext, file, driveId }`.

### `lib/ts/dlis/`
TypeScript modules implementing a binary DLIS well-log parser.

---

## Conventions

- All reusable components: `lib/components/<ComponentName>/` with `index.js` barrel
- Import with `$lib` alias: `import { Sidebar } from '$lib/components/Sidebar'`
- Svelte 5 syntax: `$props()`, `$state()`, `$derived()`, `{@render children()}` — not `<slot>` or `export let`
- Tailwind utility classes only — no scoped `<style>` blocks unless unavoidable
- State classes use Svelte 5 runes (e.g. `class Foo { x = $state(0) }`) and export a singleton
