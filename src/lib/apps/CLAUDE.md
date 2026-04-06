# CLAUDE.md — src/lib/apps/

File viewer and editor apps. Each app is a Svelte component registered against one or more file extensions.

---

## App Registry (`registry.js`)

Maps extensions → Svelte components. `getApp(ext)` resolves a component; falls back to `GenericApp`.

| Extension(s) | Component | Type |
|-------------|-----------|------|
| `.txt` `.md` `.json` `.xml` `.csv` `.log` `.js` `.ts` `.py` | `GenericApp` | Text editor |
| `.las` `.las2` | `LasApp` | ASCII well-log viewer |
| `.dlis` `.dlis1` | `DlisApp` | Binary well-log viewer |
| `.wson` | `WsonApp` | Well schematic editor |
| `.tpl` | `TplApp` | Plot template editor |
| `.dgeo` | `DgeoApp` | Geological cross-section editor |
| `.wflow` | `WorkflowApp` | Petrophysics node-graph editor |

**Adding a new file type:** import the component and add one line to `appRegistry` in `registry.js`.

---

## Tab Prop

Every app receives a single `tab` prop:

```js
{
  id:      string,              // unique key (file path)
  name:    string,              // display filename
  ext:     string,              // e.g. '.las'
  file:    File | null,         // local File object
  handle:  FileSystemFileHandle | null,  // desktop only
  driveId: string | null,       // Google Drive file ID
  dirty:   boolean,             // managed by app via tabStore.setDirty()
}
```

---

## Shared Utilities (`shared/`)

### `fileActions.js`
```js
saveToHandle(handle, content)   // writes to disk via File System Access API
downloadBlob(name, content, mime) // triggers browser file download
```

### `WellTrackView.svelte`
Multi-track depth-aligned well-log display used by both `LasApp` and `DlisApp`.

---

## App Patterns

### Viewer-only apps (LasApp, DlisApp)
- Load file on `onMount`; store `rawBuffer` for download
- No dirty state — files are read-only
- Header bar has: filename, file metadata, **⬇ Download** button

### Editor apps (GenericApp, WsonApp, TplApp, DgeoApp, WorkflowApp)
- Track dirty state (`$derived` or `$state`) and call `tabStore.setDirty(tab.id, dirty)`
- **Save** button: `saveToHandle` if `tab.handle` available, else falls back to download
- **Download** button: always available, serialises current in-memory state
- Ctrl/Cmd+S keyboard shortcut via `<svelte:window onkeydown>`

### Content loading pattern (all apps)
```js
if (tab.file) {
  // local: read from File object
} else if (tab.driveId) {
  // remote: fetch from /api/drive?fileId=
}
```

---

## Subdirectory Guide

| Directory | App | Notes |
|-----------|-----|-------|
| `generic/` | `GenericApp` | `<textarea>` with dirty tracking and save/download |
| `las/` | `LasApp` | `parseLASFile` → `processCurves` → `buildLasTracks` → `WellTrackView` |
| `dlis/` | `DlisApp` | `parseDLISFile` → `processChannelsAndFrames` → `WellTrackView` |
| `wson/` | `WsonApp` | JSON schematic + SVG render; component shapes from `static/compjson/`; catalogue from `/api/schematic` |
| `tpl/` | `TplApp` | Plot template JSON; curve-slot assignment from open LAS/DLIS tabs; sub-apps in `tpl/subapps/` |
| `dgeo/` | `DgeoApp` | SVG geological cross-section; horizon drag-edit; JSON serialisation |
| `workflow/` | `WorkflowApp` | Node-graph petrophysics engine — see `workflow/CLAUDE.md` |
