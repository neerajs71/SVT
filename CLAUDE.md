# CLAUDE.md — Project Root

This file enables Claude to fully understand and work with this project.

---

## Project Identity

- **Name:** SVTC — Well Data Viewer
- **Package name:** `svtc-hello-world`
- **Version:** `0.0.1`
- **Live URL:** https://svtc.up.railway.app/
- **GitHub:** https://github.com/pyenthu/SVTC

**What it does:** A browser-based well-data visualization application. Users open a local folder or browse a Google Drive repository to view well-log files (DLIS, LAS) and well schematics (WSON) in an IDE-like tabbed interface.

---

## Tech Stack

| Tool | Version | Role |
|------|---------|------|
| SvelteKit | ^2.0.0 | Full-stack framework |
| Svelte | ^5.0.0 | UI (uses runes — `$state`, `$props`, `$derived`) |
| Vite | ^6.0.0 | Build tool |
| TypeScript | via tsconfig | DLIS binary parser |
| Flowbite Svelte | ^1.31.0 | UI components (Drawer, Dropdown, CloseButton) |
| Flowbite Svelte Icons | ^3.1.0 | Icons (BarsOutline, GridOutline, etc.) |
| Flowbite | ^4.0.1 | Base theme |
| Tailwind CSS v4 | ^4.2.2 | Utility-first CSS |
| @tailwindcss/vite | ^4.2.2 | Tailwind Vite plugin |
| @sveltejs/adapter-node | ^5.0.0 | Node.js SSR adapter |
| Bun | 1.x | Package manager and runtime |
| Docker | — | Multi-stage containerised builds |
| Railway | — | Hosting, auto-deploys on git push to `main` |

---

## Key Design Decisions

1. **`"type": "module"` in package.json** — required because `@sveltejs/kit` is ESM-only.
2. **Bun instead of npm** — faster installs and builds. Use `bun install`, `bun run build`.
3. **Tailwind CSS v4 with `@tailwindcss/vite`** — plugin in `vite.config.js`; no `tailwind.config.js`.
4. **Svelte 5 runes everywhere** — state is `$state()`/`$props()`/`$derived()` inside class instances or component scripts. No legacy `writable()` stores.
5. **App registry pattern** — file extension → Svelte component mapping in `src/lib/apps/registry.js`. Add a new viewer by adding one entry.
6. **Flowbite Drawer API** — uses `open` prop (not deprecated `hidden`). Set `dismissable={false}` to suppress built-in close button; use `outsideclose={true}` to close on backdrop click.
7. **Multi-stage Dockerfile** — Stage 1 builds with all devDeps; Stage 2 is lean with only `build/` and prod deps.
8. **Railway uses Dockerfile** — `railway.toml` sets `builder = "DOCKERFILE"`. Every push to `main` triggers auto-redeploy.
9. **Google Drive service account** — credentials in `google-service-account.json` (git-ignored). Set via env vars in production.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `merge-to-main` | Active development — tracked as `main` on GitHub, auto-deploys to Railway |
| `master` | Stable mirror — periodically merged from `merge-to-main` |

```bash
# develop on merge-to-main
git checkout merge-to-main
# ... make changes ...
git push -u github merge-to-main:main   # deploys to Railway

# sync master
git checkout master
git merge merge-to-main
git push -u github master
git checkout merge-to-main
```

---

## Commands

```bash
bun install          # install dependencies
bun run dev          # start dev server (http://localhost:5173)
bun run build        # production build → ./build
node build           # run production server on port 3000
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_DRIVE_FOLDER_ID` | Yes (remote mode) | Root Drive folder ID or full Drive URL |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT` | One of two | JSON string of service account key |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH` | One of two | Path to service account JSON file |

Set in `.env` (local dev, git-ignored) or Railway environment config.

---

## File Structure

```
/
├── CLAUDE.md                        # ← you are here
├── README.md
├── Dockerfile                       # multi-stage bun build
├── .dockerignore                    # excludes node_modules, .svelte-kit, build, package-lock.json
├── .env                             # environment variables (not committed)
├── .gitignore
├── railway.toml                     # Railway: builder=DOCKERFILE
├── package.json                     # type=module, bun scripts
├── bun.lock                         # bun lockfile
├── tsconfig.json                    # TypeScript config for DLIS parser
├── svelte.config.js                 # adapter-node
├── vite.config.js                   # tailwindcss() + sveltekit() plugins
├── google-service-account.json      # Google service account credentials (git-ignored)
├── static/
│   ├── virtual-mouse.js             # Touch → mouse event emulator
│   └── compjson/                    # WSON component shape definitions (JSON)
│       ├── FLOW_CONTROL.*.json
│       ├── MISC.*.json
│       ├── PACKERS.*.json
│       ├── TUBING_HANGER.*.json
│       ├── PBR.*.json
│       └── *.json                   # legacy flat-name shapes
└── src/
    ├── CLAUDE.md                    # src-level guide
    ├── app.css                      # Tailwind + Flowbite CSS entry
    ├── app.html                     # HTML shell (h-full overflow-hidden on html/body)
    ├── routes/
    │   ├── CLAUDE.md                # routes guide
    │   ├── +layout.svelte           # mounts NavMenu, loads app.css, injects virtual-mouse.js
    │   ├── +page.svelte             # Home: Sidebar + SimpleTabs
    │   ├── about/
    │   │   └── +page.svelte         # About page
    │   ├── apps/
    │   │   └── +page.svelte         # Apps placeholder page
    │   └── api/
    │       └── drive/
    │           └── +server.js       # Google Drive proxy (list + download)
    └── lib/
        ├── components/
        │   ├── NavMenu/
        │   │   ├── CLAUDE.md
        │   │   ├── NavMenu.svelte   # Fixed top-right apps menu (Flowbite Dropdown)
        │   │   └── index.js
        │   ├── Sidebar/
        │   │   ├── CLAUDE.md
        │   │   ├── Sidebar.svelte   # Flowbite Drawer file-browser
        │   │   └── index.js
        │   └── SimpleTabs/
        │       └── SimpleTabs.svelte  # Tab bar + active-tab app renderer
        ├── tabs/
        │   └── tabs.svelte.js       # TabState class (Svelte 5 runes)
        ├── datasource/
        │   ├── LocalDataSource.js   # Builds tree from browser File objects
        │   ├── RemoteDataSource.js  # Google Drive folder tree + download
        │   ├── store.svelte.js      # DatasourceState class (Svelte 5 runes)
        │   └── index.js             # barrel export
        └── apps/
            ├── registry.js          # ext → component map + getApp(ext) helper
            ├── generic/
            │   └── GenericApp.svelte  # Plain-text viewer for misc file types
            ├── dlis/
            │   ├── DlisApp.svelte     # DLIS binary well-log viewer
            │   └── utils.js
            ├── las/
            │   ├── LasApp.svelte      # LAS ASCII well-log viewer
            │   ├── parser.js
            │   └── utils.js
            ├── wson/
            │   └── WsonApp.svelte     # Well schematic viewer (WSON format)
            ├── shared/
            │   └── WellTrackView.svelte  # Multi-track well-log display (shared by DLIS + LAS)
            └── (TypeScript DLIS parser lives at src/lib/ts/dlis/)
```

---

## Architecture: How a File Gets Opened

1. **User selects a file** in `Sidebar.svelte` (local folder upload or Drive tree click).
2. `tabStore.openFile(item)` is called — adds a tab `{ id, name, ext, file, driveId }`.
3. `SimpleTabs.svelte` renders the tab bar and calls `getApp(tab.ext)` from `registry.js`.
4. The resolved component (e.g. `LasApp`) is rendered with `tab` as its only prop.
5. The app component reads from `tab.file` (local) or fetches via `/api/drive?fileId=` (remote).

---

## App Registry

`src/lib/apps/registry.js` maps extensions to components:

| Extension | Component | Description |
|-----------|-----------|-------------|
| `.dlis`, `.dlis1` | `DlisApp` | Binary DLIS well-log parser & viewer |
| `.las`, `.las2` | `LasApp` | ASCII LAS well-log parser & viewer |
| `.wson` | `WsonApp` | Well schematic viewer with SVG rendering |
| `.txt`, `.md`, `.json`, `.xml`, `.csv`, `.log`, `.js`, `.ts`, `.py` | `GenericApp` | Raw text viewer |

**To add a new file type:** import the component and add one line to `appRegistry` in `registry.js`.

---

## State Management

### TabState (`src/lib/tabs/tabs.svelte.js`)
Svelte 5 runes class, exported as singleton `tabStore`.

```js
tabStore.openFile(item)   // { path, name, file?, id? }
tabStore.closeTab(id)
tabStore.setActive(id)
tabStore.activeTab        // getter → current tab object or null
tabStore.tabs             // $state([]) array
tabStore.activeId         // $state(null)
```

### DatasourceState (`src/lib/datasource/store.svelte.js`)
Svelte 5 runes class, exported as singleton `datasourceStore`.

```js
datasourceStore.mode          // 'local' | 'remote'
datasourceStore.tree          // null | tree node
datasourceStore.expanded      // Set of expanded paths
datasourceStore.loading       // boolean
datasourceStore.error         // null | string

datasourceStore.toggleMode()              // switch local ↔ remote
datasourceStore.loadLocalFiles(files)     // load browser File objects
datasourceStore.toggleExpanded(path, id)  // expand/collapse + lazy-load remote
datasourceStore.flatten(tree, expanded)   // flatten tree for rendering
```

---

## API Endpoint: `GET /api/drive`

Server-side Google Drive proxy. Uses JWT service-account auth with 1-hour token cache.

| Query param | Effect |
|-------------|--------|
| _(none)_ | Return root folder tree (2 levels deep) |
| `folderId=<id>` | Return children of a specific folder |
| `fileId=<id>` | Stream file download |

---

## DLIS TypeScript Parser (`src/lib/ts/dlis/`)

Custom binary DLIS parser written in TypeScript. Entry point: `src/lib/ts/dlis/index.ts`.

| Module | Purpose |
|--------|---------|
| `core/parser.ts` | Top-level parse function |
| `readers/RCReader.ts` | Raw-chunk byte reader |
| `records/VisibleRecord.ts` | Visible record extraction |
| `records/LogicalRecord.ts` | Logical record assembly |
| `records/LogicalRecordSegment.ts` | Segment parsing |
| `files/LogicalFile.ts` | Logical file structure |
| `files/StorageUnitLabel.ts` | SUL parsing |
| `components/Component.ts` | EFLR component parsing |
| `common/types.ts` | Shared TypeScript types |
| `common/utils.ts` | Byte-level utilities |

---

## WSON Component Shapes (`static/compjson/`)

JSON files defining SVG rendering instructions for well completion components. Naming convention:

- `CATEGORY.COMPONENT_NAME.json` — canonical library entries (e.g. `PACKERS.PACKER_RH.json`)
- `camelCase.json` — legacy flat-name entries (e.g. `packerPermanent.json`)

`WsonApp.svelte` fetches these at runtime by component name to render the schematic.

---

## Component Conventions

- All reusable components live under `src/lib/components/<ComponentName>/`
- Each folder has an `index.js` barrel export
- Import with `$lib` alias: `import { Sidebar } from '$lib/components/Sidebar'`
- Styling is Tailwind utility classes only — no scoped `<style>` blocks
- Svelte 5 syntax: `$props()`, `$state()`, `$derived()`, `{@render children()}` (not `<slot>`)

---

## Layout

`+layout.svelte` does three things:
1. Imports `app.css` globally
2. Mounts `<NavMenu />` on every page (fixed top-right)
3. Injects `virtual-mouse.js` on `onMount` for tablet cursor emulation

---

## Recreating From Scratch

```bash
# 1. Create SvelteKit project
bunx create-svelte@latest my-app && cd my-app

# 2. Add "type": "module" to package.json

# 3. Install dependencies
bun add flowbite-svelte flowbite flowbite-svelte-icons
bun add -d tailwindcss @tailwindcss/vite

# 4. vite.config.js → plugins: [tailwindcss(), sveltekit()]

# 5. src/app.css:
#   @import 'tailwindcss';
#   @import 'flowbite/src/themes/default';
#   @source '../node_modules/flowbite-svelte/dist';

# 6. Build core components:
#   - src/lib/components/Sidebar/  (see Sidebar/CLAUDE.md)
#   - src/lib/components/NavMenu/  (see NavMenu/CLAUDE.md)
#   - src/lib/components/SimpleTabs/SimpleTabs.svelte
#   - src/lib/tabs/tabs.svelte.js
#   - src/lib/datasource/  (LocalDataSource, RemoteDataSource, store.svelte.js)
#   - src/lib/apps/registry.js + viewer components

# 7. bun run build && node build
```
