import { LocalDataSource, flatten } from './LocalDataSource.js';
import { RemoteDataSource } from './RemoteDataSource.js';

const local = new LocalDataSource();
const remote = new RemoteDataSource();

// ── File templates for new-file creation ─────────────────────────────────────
const TEMPLATES = {
  '.wflow': JSON.stringify({ version: '1.0', nodes: [], wires: [] }, null, 2),
  '.dgeo':  JSON.stringify({ version: '1.0', domain: { x: { min: 0, max: 10 }, y: { min: 0, max: 5000 } }, horizons: [] }, null, 2),
  '.tpl':   JSON.stringify({ title: 'New Template', depth: { min: 0, max: 5000, unit: 'm' }, panels: [], curveDefinitions: [], fileSlots: {} }, null, 2),
};

// ── IndexedDB helpers — persist FileSystemDirectoryHandles across sessions ───
const IDB_DB    = 'svtc-workspaces';
const IDB_STORE = 'handles';
const MAX_RECENT = 5;

function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: 'name' });
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function idbSave(handle) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ name: handle.name, handle, savedAt: Date.now() });
    tx.oncomplete = res;
    tx.onerror    = () => rej(tx.error);
  });
}

async function idbLoadAll() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () =>
      res((req.result ?? []).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_RECENT));
    req.onerror = () => rej(req.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

function getNodeByPath(tree, path) {
  const parts = path.split('/');
  let node = tree;
  for (const part of parts) {
    if (!node.children || !node.children[part]) return null;
    node = node.children[part];
  }
  return node;
}

class DatasourceState {
  mode          = $state('local');   // default to local
  tree          = $state(null);
  expanded      = $state(new Set());
  loading       = $state(false);
  error         = $state(null);
  recentHandles = $state([]);        // [{ name, handle, savedAt }]

  /** Call from onMount in Sidebar to populate recent workspaces list. */
  async initRecentWorkspaces() {
    if (typeof indexedDB === 'undefined') return;
    try { this.recentHandles = await idbLoadAll(); } catch { /* ignore */ }
  }

  /** Re-open a persisted handle — browser will prompt for permission. */
  async reopenWorkspace(entry) {
    if (!entry?.handle) return;
    try {
      const perm = await entry.handle.requestPermission({ mode: 'readwrite' });
      if (perm !== 'granted') return;
      await this.loadLocalFolder(entry.handle);
    } catch (e) {
      this.error = e.message;
    }
  }

  toggleMode() {
    const newMode = this.mode === 'local' ? 'remote' : 'local';
    this.mode = newMode;
    this.tree = null;
    this.expanded = new Set();
    this.error = null;

    if (newMode === 'remote') {
      this.loading = true;
      remote.fetchTree()
        .then(tree => { this.tree = tree; this.loading = false; })
        .catch(err => { this.loading = false; this.error = err.message; });
    } else {
      this.loading = false;
    }
  }

  async loadLocalFolder(dirHandle) {
    this.loading = true;
    this.error = null;
    try {
      const tree = await local.buildTreeFromHandle(dirHandle);
      this.tree = { name: '', type: 'dir', children: { [dirHandle.name]: tree } };
      this.expanded = new Set([dirHandle.name]);
      // Persist handle for recent workspaces
      if (typeof indexedDB !== 'undefined') {
        await idbSave(dirHandle).catch(() => {});
        this.recentHandles = await idbLoadAll().catch(() => this.recentHandles);
      }
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  loadLocalFiles(files) {
    if (!files || !files.length) return;
    this.tree = local.buildTree(files);
    this.expanded = new Set([files[0].webkitRelativePath.split('/')[0]]);
    this.error = null;
  }

  toggleExpanded(path, id) {
    const next = new Set(this.expanded);
    if (next.has(path)) {
      next.delete(path);
      this.expanded = next;
      return;
    }
    next.add(path);
    if (this.mode === 'remote' && id) {
      const node = getNodeByPath(this.tree, path);
      if (node && Object.keys(node.children).length === 0) {
        remote.fetchFolder(id)
          .then(data => {
            const n = getNodeByPath(this.tree, path);
            if (n) n.children = data.children;
            this.tree = { ...this.tree };
          })
          .catch(err => console.error('[store] lazy-load failed:', err));
      }
    }
    this.expanded = next;
  }

  async deleteItem(path, id) {
    const parts = path.split('/');
    const name  = parts[parts.length - 1];

    if (this.mode === 'remote') {
      if (id) await remote.trashFile(id);
    } else {
      const parentParts = parts.slice(0, -1);
      const parentNode  = parentParts.length
        ? getNodeByPath(this.tree, parentParts.join('/'))
        : this.tree;

      if (parentNode?.handle) {
        await parentNode.handle.removeEntry(name, { recursive: true });
      }
    }

    const removeFromNode = (node, parts) => {
      if (parts.length === 1) {
        const children = { ...node.children };
        delete children[parts[0]];
        return { ...node, children };
      }
      const [head, ...tail] = parts;
      if (!node.children?.[head]) return node;
      return {
        ...node,
        children: { ...node.children, [head]: removeFromNode(node.children[head], tail) }
      };
    };

    this.tree = removeFromNode(this.tree, parts);

    if (this.expanded.has(path)) {
      const next = new Set(this.expanded);
      next.delete(path);
      this.expanded = next;
    }
  }

  /**
   * Create a new file or folder inside a directory that was opened via
   * the File System Access API (has a handle). Local mode only.
   *
   * @param {string} parentPath  — path of the parent dir in the tree
   * @param {string} name        — new file/folder name
   * @param {boolean} isDir      — true = directory, false = file
   * @param {string} [ext]       — file extension (used to pick template content)
   */
  async createItem(parentPath, name, isDir, ext = '') {
    const node = getNodeByPath(this.tree, parentPath);
    if (!node?.handle) throw new Error('File creation requires Chrome or Edge on desktop — not supported on this browser');

    let childHandle;
    if (isDir) {
      childHandle = await node.handle.getDirectoryHandle(name, { create: true });
    } else {
      childHandle = await node.handle.getFileHandle(name, { create: true });
      const content = TEMPLATES[ext] ?? '';
      if (content) {
        const writable = await childHandle.createWritable();
        await writable.write(content);
        await writable.close();
      }
    }

    // Insert new node into the tree (immutable update)
    const newChild = isDir
      ? { name, type: 'dir', handle: childHandle, children: {} }
      : { name, type: 'file', handle: childHandle, file: null };

    const insert = (treeNode, parts) => {
      if (parts.length === 1) {
        return { ...treeNode, children: { ...treeNode.children, [name]: newChild } };
      }
      const [head, ...tail] = parts;
      return {
        ...treeNode,
        children: { ...treeNode.children, [head]: insert(treeNode.children[head], tail) }
      };
    };
    this.tree = insert(this.tree, parentPath.split('/'));

    // Auto-expand the parent
    if (!this.expanded.has(parentPath)) {
      const next = new Set(this.expanded);
      next.add(parentPath);
      this.expanded = next;
    }
  }

  flatten(tree, expanded) {
    return tree ? flatten(tree, expanded) : [];
  }
}

export const datasourceStore = new DatasourceState();
