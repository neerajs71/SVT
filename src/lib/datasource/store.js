/**
 * Datasource Store
 *
 * Single source of truth for:
 *   - mode:     'local' | 'remote'
 *   - tree:     the current file tree (null = nothing loaded)
 *   - expanded: Set of expanded folder paths
 *   - loading:  true while remote fetch is in progress
 *   - error:    error message string or null
 *
 * The Sidebar only imports this store — it never touches LocalDataSource
 * or RemoteDataSource directly.
 */

import { writable } from 'svelte/store';
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

function createDatasourceStore() {
  const { subscribe, update } = writable({
    mode: 'local',
    tree: null,
    expanded: new Set(),
    loading: false,
    error: null
  });

  return {
    subscribe,

    /** Toggle between 'local' and 'remote'. Switching to remote triggers a fetch. */
    toggleMode() {
      update(s => {
        const newMode = s.mode === 'local' ? 'remote' : 'local';

        if (newMode === 'remote') {
          remote
            .fetchTree()
            .then(tree => update(s => ({ ...s, tree, loading: false, error: null })))
            .catch(err => update(s => ({ ...s, loading: false, error: err.message })));

          return { ...s, mode: newMode, tree: null, expanded: new Set(), loading: true, error: null };
        }

        // Switching back to local: clear remote tree, await user to pick directory
        return { ...s, mode: newMode, tree: null, expanded: new Set(), loading: false, error: null };
      });
    },

    /** Called when the user picks a local directory. */
    loadLocalFiles(files) {
      if (!files || !files.length) return;
      const tree = local.buildTree(files);
      const rootName = files[0].webkitRelativePath.split('/')[0];
      update(s => ({ ...s, tree, expanded: new Set([rootName]), error: null }));
    },

    /** Toggle a folder open/closed in the tree. Lazy-loads remote children on first expand. */
    toggleExpanded(path, id) {
      update(s => {
        const next = new Set(s.expanded);
        if (next.has(path)) {
          next.delete(path);
          return { ...s, expanded: next };
        }
        next.add(path);
        // Lazy-load remote folder children if not yet fetched
        if (s.mode === 'remote' && id) {
          const node = getNodeByPath(s.tree, path);
          if (node && Object.keys(node.children).length === 0) {
            remote.fetchFolder(id)
              .then(data => {
                update(s2 => {
                  const n = getNodeByPath(s2.tree, path);
                  if (n) n.children = data.children;
                  return { ...s2, tree: { ...s2.tree } };
                });
              })
              .catch(err => console.error('[store] lazy-load failed:', err));
          }
        }
        return { ...s, expanded: next };
      });
    },

    /**
     * Flatten the current tree into a renderable list.
     * Pure function — safe to call in reactive $: statements.
     *
     * @param {{ children: object }|null} tree
     * @param {Set<string>} expanded
     * @returns {Array}
     */
    flatten(tree, expanded) {
      return tree ? flatten(tree, expanded) : [];
    }
  };
}

export const datasourceStore = createDatasourceStore();
