# SVTC — Available Libraries for Generated Components

When generating `.svelte` components for this app, you can import from the following paths only. All other imports will fail at runtime.

---

## `$lib/tabs/tabs.svelte.js`
```js
import { tabStore } from '$lib/tabs/tabs.svelte.js';

tabStore.tabs             // $state — array of open tabs
tabStore.activeTab        // $derived — current tab object or null
tabStore.activeId         // $state — id string of active tab
tabStore.openFile(item)   // open a file: { name, path, file?, handle?, id? }
tabStore.closeTab(id)     // close a tab by id
tabStore.setActive(id)    // switch to a tab
tabStore.setDirty(id, bool) // mark tab as dirty (unsaved)
```

Each tab object shape:
```js
{ id, name, ext, file, handle, driveId, dirty }
// file    — File object (local mode) or null
// handle  — FileSystemFileHandle or null
// driveId — Google Drive file ID or null
```

---

## `$lib/datasource/store.svelte.js`
```js
import { datasourceStore } from '$lib/datasource/store.svelte.js';

datasourceStore.mode      // 'local' | 'remote'
datasourceStore.tree      // file tree root node or null
datasourceStore.loading   // boolean
datasourceStore.error     // string | null
```

---

## `$lib/apps/las/parser.js`
```js
import { parseLas } from '$lib/apps/las/parser.js';

parseLas(text: string) → {
  version: string | null,
  wrap: boolean,
  nullValue: number,         // null/absent value marker (e.g. -999.25)
  well: {                    // well header fields
    [mnem]: { value, unit, desc }
  },
  curves: [                  // curve definitions in order
    { mnem, unit, desc }
  ],
  params: [                  // optional parameter section
    { mnem, unit, value, desc }
  ],
  data: number[][]           // rows[depth index] × cols[curve index]
}
```

---

## `$lib/apps/shared/fileActions.js`
```js
import { saveToHandle, downloadBlob } from '$lib/apps/shared/fileActions.js';

saveToHandle(handle, content)              // write to FileSystemFileHandle
downloadBlob(filename, content, mime?)     // trigger browser file download
```

---

## Tab prop — always injected by the viewer

Every generated component receives `tab` as a prop automatically:
```js
let { tab } = $props();
// tab.name    — filename e.g. "my-chart.svelte"
// tab.ext     — '.svelte'
// tab.file    — File object (local) or null
// tab.handle  — FileSystemFileHandle or null
// tab.driveId — Google Drive file ID or null
```

To read the file's raw text from inside the component:
```js
const text = tab.file ? await tab.file.text()
           : await fetch(`/api/drive?fileId=${tab.driveId}`).then(r => r.text());
```

---

## Rules for generated components

1. **Svelte 5 runes only** — `$state`, `$derived`, `$effect`, `$props`. No legacy stores.
2. **Tailwind CSS** for all styling — no `<style>` blocks.
3. **Only import from paths listed above** — any other `$lib` import will fail.
4. **No `import` from npm packages** — all deps must come from the list above or be native browser APIs.
5. The component renders in a full-size container — use `class="w-full h-full"` on the root element.
6. Load data inside `$effect` or `onMount` using async/await.
