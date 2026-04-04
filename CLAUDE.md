# CLAUDE.md — SVTC Well Data Viewer

**Live:** https://svtc.up.railway.app/ · **Repo:** https://github.com/pyenthu/SVTC

A browser-based well-data visualisation app. Users open a local folder or browse Google Drive to view well-log files (DLIS, LAS), plot templates (TPL), geological cross-sections (DGEO), petrophysics workflows (WFLOW), and well schematics (WSON) in an IDE-like tabbed interface.

---

## Tech Stack

| Tool | Role |
|------|------|
| SvelteKit ^2 + Svelte ^5 | Full-stack framework; runes syntax throughout |
| Vite ^6 + @tailwindcss/vite | Build; Tailwind CSS v4 (no config file) |
| Flowbite Svelte ^1 | UI components (Drawer, Dropdown, CloseButton) |
| @sveltejs/adapter-node ^5 | Node.js SSR production adapter |
| Bun 1.x | Package manager and runtime |
| Docker + Railway | Multi-stage container builds; auto-deploys on push to `main` |

---

## Commands

```bash
bun install        # install dependencies
bun run dev        # dev server → http://localhost:5173
bun run build      # production build → ./build
node build         # run production server on :3000
```

---

## Key Design Decisions

1. **Svelte 5 runes everywhere** — `$state`, `$derived`, `$effect`, `$props`. No legacy stores.
2. **App registry pattern** — `src/lib/apps/registry.js` maps `ext → SvelteComponent`. Add one line to support a new file type.
3. **Tab prop shape** — every app receives `tab: { id, name, ext, file, handle, driveId, dirty }`.
   - `file` — `File` object (local) or `null`
   - `handle` — `FileSystemFileHandle` (desktop picker) or `null` (iOS/Drive)
   - `dirty` — set via `tabStore.setDirty(id, bool)` from each app; drives tab-bar indicator
4. **Shared file actions** — `src/lib/apps/shared/fileActions.js` exports `saveToHandle(handle, content)` and `downloadBlob(name, content, mime)`. All apps use these.
5. **Tailwind CSS v4** — plugin in `vite.config.js`; no `tailwind.config.js`.
6. **Flowbite Drawer** — use `open` prop (not `hidden`); `dismissable={false}` + `outsideclose={true}`.
7. **Multi-stage Dockerfile** — Stage 1 builds; Stage 2 runs with `build/` + prod deps only.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_DRIVE_FOLDER_ID` | remote mode | Root Drive folder ID or full URL |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT` | one of two | JSON string of service-account key |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH` | one of two | Path to service-account JSON file |

Set in `.env` (local, git-ignored) or Railway environment config.

---

## File Structure

```
/
├── CLAUDE.md                         ← you are here
├── Dockerfile                        # multi-stage bun build
├── railway.toml                      # builder = DOCKERFILE
├── package.json                      # type=module, bun scripts
├── svelte.config.js                  # adapter-node
├── vite.config.js                    # tailwindcss() + sveltekit() plugins
├── static/
│   ├── virtual-mouse.js              # touch → mouse emulator (tablet)
│   ├── comp_list.xlsx                # WSON component catalogue
│   └── compjson/                     # WSON SVG shape definitions (JSON)
└── src/
    ├── app.html                      # HTML shell (h-full overflow-hidden)
    ├── app.css                       # Tailwind + Flowbite CSS entry
    ├── routes/                       # SvelteKit pages + API — see routes/CLAUDE.md
    └── lib/
        ├── components/               # Reusable UI — see each component's CLAUDE.md
        │   ├── NavMenu/
        │   ├── Sidebar/
        │   ├── SimpleTabs/
        │   └── FloatingPanel/
        ├── tabs/
        │   └── tabs.svelte.js        # TabState singleton (tabStore)
        ├── datasource/
        │   ├── LocalDataSource.js
        │   ├── RemoteDataSource.js
        │   └── store.svelte.js       # DatasourceState singleton (datasourceStore)
        ├── apps/                     # File viewer apps — see apps/CLAUDE.md
        │   ├── registry.js
        │   ├── shared/               # fileActions.js, WellTrackView.svelte
        │   ├── generic/              # .txt .md .json .csv .xml etc.
        │   ├── las/                  # .las .las2
        │   ├── dlis/                 # .dlis .dlis1
        │   ├── wson/                 # .wson
        │   ├── tpl/                  # .tpl  (plot template)
        │   ├── dgeo/                 # .dgeo (geological cross-section)
        │   └── workflow/             # .wflow — see workflow/CLAUDE.md
        └── ts/dlis/                  # TypeScript binary DLIS parser
```

---

## Architecture: How a File Opens

1. User clicks a file in **Sidebar** → `tabStore.openFile(item)`
2. Tab `{ id, name, ext, file, handle, driveId, dirty: false }` is pushed to `tabStore.tabs`
3. **SimpleTabs** renders the tab bar (orange `●` on dirty tabs) and the active app
4. `getApp(tab.ext)` from `registry.js` resolves the Svelte component
5. The app loads content from `tab.file` (local) or `GET /api/drive?fileId=` (remote)
6. Editable apps call `tabStore.setDirty(tab.id, bool)`; save via `saveToHandle` or `downloadBlob`

---

## State Singletons

### `tabStore` — `lib/tabs/tabs.svelte.js`
```js
tabStore.tabs           // $state([]) — open tabs
tabStore.activeId       // $state(null)
tabStore.activeTab      // $derived — current tab or null
tabStore.openFile(item)
tabStore.closeTab(id)
tabStore.setActive(id)
tabStore.setDirty(id, bool)
```

### `datasourceStore` — `lib/datasource/store.svelte.js`
```js
datasourceStore.mode               // 'local' | 'remote'
datasourceStore.tree               // file tree root or null
datasourceStore.loading / .error
datasourceStore.toggleMode()
datasourceStore.loadLocalFiles(files)
datasourceStore.toggleExpanded(path, id)
datasourceStore.flatten(tree, expanded)
```

---

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/drive` | Google Drive proxy — list folder or stream file |
| `GET /api/schematic` | WSON component catalogue search (from `comp_list.xlsx`) |
| `GET /api/samples` | List files in `static/samples/` |
| `POST /api/samples` | Upload a sample file |
| `DELETE /api/samples?name=` | Delete a sample file |
| `GET /api/dev-tabs` | Auto-open tabs from Drive `activeTabs.json` |

---

## Branch / Deploy

```bash
git push -u origin main     # → neerajs71/SVT (internal)
git push pyenthu main       # → pyenthu/SVTC (GitHub, triggers Railway redeploy)
```
