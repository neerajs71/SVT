import { LocalDataSource, flatten } from './LocalDataSource.js';
import { RemoteDataSource } from './RemoteDataSource.js';

const local = new LocalDataSource();
const remote = new RemoteDataSource();

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
  mode = $state('remote');
  tree = $state(null);
  expanded = $state(new Set());
  loading = $state(true);
  error = $state(null);

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

  /**
   * Load from a FileSystemDirectoryHandle (File System Access API).
   * Enables real file deletion via removeEntry().
   */
  async loadLocalFolder(dirHandle) {
    this.loading = true;
    this.error = null;
    try {
      const tree = await local.buildTreeFromHandle(dirHandle);
      // Wrap in a virtual root to match legacy shape ({ name:'', children:{...} })
      this.tree = { name: '', type: 'dir', children: { [dirHandle.name]: tree } };
      this.expanded = new Set([dirHandle.name]);
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  /**
   * Legacy: load from webkitdirectory FileList (no delete support).
   */
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

  /**
   * Delete an item from the workspace.
   *
   * Local mode (File System Access API):
   *   Calls parentHandle.removeEntry(name) to delete from disk,
   *   then removes from in-memory tree.
   *
   * Local mode (legacy FileList):
   *   Removes from in-memory tree only (no disk access).
   *
   * Remote mode:
   *   Trashes the file in Google Drive, then removes from in-memory tree.
   *
   * @param {string} path  - slash-separated path in the tree
   * @param {string|null} id - Drive file ID (remote only)
   */
  async deleteItem(path, id) {
    const parts = path.split('/');
    const name  = parts[parts.length - 1];

    if (this.mode === 'remote') {
      if (id) await remote.trashFile(id);
    } else {
      // Local: try File System Access API deletion
      const parentParts = parts.slice(0, -1);
      const parentNode  = parentParts.length
        ? getNodeByPath(this.tree, parentParts.join('/'))
        : this.tree;

      if (parentNode?.handle) {
        // Real deletion from disk
        await parentNode.handle.removeEntry(name, { recursive: true });
      }
      // If no handle (legacy input), just remove from tree silently
    }

    // Remove from in-memory tree
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

    // Clean up expanded state for deleted folder
    if (this.expanded.has(path)) {
      const next = new Set(this.expanded);
      next.delete(path);
      this.expanded = next;
    }
  }

  flatten(tree, expanded) {
    return tree ? flatten(tree, expanded) : [];
  }
}

export const datasourceStore = new DatasourceState();

// Auto-fetch remote tree on load
remote.fetchTree()
  .then(tree => { datasourceStore.tree = tree; datasourceStore.loading = false; })
  .catch(err => { datasourceStore.loading = false; datasourceStore.error = err.message; });
