# CLAUDE.md — src/routes/

SvelteKit file-based routing. Each file/folder maps to a URL.

---

## Pages

| File | URL | Purpose |
|------|-----|---------|
| `+layout.svelte` | all | Root layout — imports `app.css`, mounts `<NavMenu />`, injects `virtual-mouse.js` |
| `+page.svelte` | `/` | Home — `<Sidebar>` + `<SimpleTabs>` side by side |
| `about/+page.svelte` | `/about` | Static about page |
| `apps/+page.svelte` | `/apps` | Placeholder |

### `+layout.svelte` responsibilities
1. `import '../app.css'` — Tailwind + Flowbite globally
2. `<NavMenu />` — fixed top-right on every page
3. `onMount` injects `virtual-mouse.js` from `/static/` for tablet cursor emulation

---

## API Endpoints

| Endpoint | File | Description |
|----------|------|-------------|
| `GET /api/drive` | `api/drive/+server.js` | Google Drive proxy. No params → folder tree; `?folderId=` → children; `?fileId=` → stream download. JWT service-account auth with 1-hour token cache. |
| `GET /api/schematic` | `api/schematic/+server.js` | WSON component catalogue search from `comp_list.xlsx`. |
| `GET /api/samples` | `api/samples/+server.js` | List files in `static/samples/`. |
| `POST /api/samples` | `api/samples/+server.js` | Upload a file into `static/samples/`. |
| `DELETE /api/samples?name=` | `api/samples/+server.js` | Delete a file from `static/samples/`. |
| `GET /api/dev-tabs` | `api/dev-tabs/+server.js` | Read `activeTabs.json` from Drive to auto-open tabs (dev helper). |

---

## Adding a New Page

1. Create `src/routes/<name>/+page.svelte`
2. Add a `DropdownItem` in `NavMenu.svelte` pointing to `/<name>`
3. For a file-browser page, compose `<Sidebar bind:open={...} />` + `<SimpleTabs />`
