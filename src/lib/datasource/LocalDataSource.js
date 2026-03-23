/**
 * LocalDataSource
 * Builds a file tree from browser File API (webkitdirectory input).
 */

export class LocalDataSource {
  /** @param {FileList|File[]} files */
  buildTree(files) {
    const root = { name: '', type: 'dir', children: {} };
    for (const file of files) {
      const parts = file.webkitRelativePath.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          node.children[part] = { name: part, type: 'file' };
        } else {
          if (!node.children[part]) {
            node.children[part] = { name: part, type: 'dir', children: {} };
          }
          node = node.children[part];
        }
      }
    }
    return root;
  }
}

/**
 * Flatten a tree node into a sorted, depth-aware list for rendering.
 * Shared by both LocalDataSource and RemoteDataSource.
 *
 * @param {{ children: object }} node
 * @param {Set<string>} expanded
 * @param {number} depth
 * @param {string} parentPath
 * @returns {Array}
 */
export function flatten(node, expanded, depth = 0, parentPath = '') {
  const items = [];
  const entries = Object.values(node.children).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of entries) {
    const path = parentPath ? `${parentPath}/${child.name}` : child.name;
    items.push({
      name: child.name,
      type: child.type,
      depth,
      path,
      hasChildren: child.type === 'dir' && Object.keys(child.children || {}).length > 0
    });
    if (child.type === 'dir' && child.children && expanded.has(path)) {
      items.push(...flatten(child, expanded, depth + 1, path));
    }
  }
  return items;
}
