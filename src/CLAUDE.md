# CLAUDE.md — src/

This directory contains all application source code.

---

## Files

### `app.html`
The HTML shell. SvelteKit injects head and body content via `%sveltekit.head%` and `%sveltekit.body%`. Do not add global scripts or styles here — use `app.css` and `+layout.svelte` instead.

### `app.css`
The single CSS entry point. Must contain exactly:

```css
@import 'tailwindcss';
@import 'flowbite/src/themes/default';
@source '../node_modules/flowbite-svelte/dist';
```

- Line 1: loads Tailwind CSS v4 (no config file needed)
- Line 2: loads Flowbite's default colour theme
- Line 3: tells Tailwind to scan Flowbite Svelte components for class names (required so Flowbite utility classes are not purged)

This file is imported once in `routes/+layout.svelte` so it applies globally.

---

## Subdirectories

### `routes/`
SvelteKit file-based routing. See `routes/CLAUDE.md`.

### `lib/components/Sidebar/`
The reusable Sidebar component. See `lib/components/Sidebar/CLAUDE.md`.

---

## Conventions

- All reusable components live under `lib/components/<ComponentName>/`
- Each component folder has an `index.js` barrel export
- Import components with the `$lib` alias: `import { Sidebar } from '$lib/components/Sidebar'`
- Styling is done exclusively with Tailwind utility classes — no scoped `<style>` blocks unless unavoidable
