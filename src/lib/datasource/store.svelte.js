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
  mode = $state('local');
  tree = $state(null);
  expanded = $state(new Set());
  loading = $state(false);
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

  flatten(tree, expanded) {
    return tree ? flatten(tree, expanded) : [];
  }
}

export const datasourceStore = new DatasourceState();
