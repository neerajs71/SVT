import { describe, it, expect } from 'vitest';
import { LocalDataSource, flatten } from './LocalDataSource.js';

// ── LocalDataSource.buildTree ─────────────────────────────────────────────────

describe('LocalDataSource.buildTree', () => {
  const src = new LocalDataSource();

  function makeFile(relativePath) {
    const f = new File([''], relativePath.split('/').pop());
    Object.defineProperty(f, 'webkitRelativePath', { value: relativePath });
    return f;
  }

  it('builds a flat tree from a single file', () => {
    const tree = src.buildTree([makeFile('myFolder/log.las')]);
    expect(tree.children['myFolder']).toBeDefined();
    expect(tree.children['myFolder'].children['log.las'].type).toBe('file');
  });

  it('builds nested folders', () => {
    const files = [
      makeFile('root/wells/W1/data.dlis'),
      makeFile('root/wells/W2/data.las'),
    ];
    const tree = src.buildTree(files);
    expect(tree.children['root'].children['wells'].children['W1']).toBeDefined();
    expect(tree.children['root'].children['wells'].children['W2']).toBeDefined();
  });

  it('stores File reference on leaf nodes', () => {
    const f = makeFile('folder/sample.las');
    const tree = src.buildTree([f]);
    expect(tree.children['folder'].children['sample.las'].file).toBe(f);
  });
});

// ── flatten ───────────────────────────────────────────────────────────────────

describe('flatten', () => {
  const tree = {
    name: '',
    type: 'dir',
    children: {
      folderA: {
        name: 'folderA', type: 'dir',
        children: {
          'file1.las': { name: 'file1.las', type: 'file' },
          'file2.dlis': { name: 'file2.dlis', type: 'file' },
        }
      },
      folderB: {
        name: 'folderB', type: 'dir',
        children: {
          'nested.wson': { name: 'nested.wson', type: 'file' }
        }
      }
    }
  };

  it('returns only top-level items when nothing expanded', () => {
    const items = flatten(tree, new Set());
    expect(items).toHaveLength(2);
    expect(items.map(i => i.name)).toEqual(['folderA', 'folderB']);
  });

  it('expands a folder when its path is in the expanded set', () => {
    const items = flatten(tree, new Set(['folderA']));
    // folderA + 2 children + folderB = 4
    expect(items).toHaveLength(4);
    const names = items.map(i => i.name);
    expect(names).toContain('file1.las');
    expect(names).toContain('file2.dlis');
  });

  it('assigns correct depth values', () => {
    const items = flatten(tree, new Set(['folderA']));
    const folderA = items.find(i => i.name === 'folderA');
    const file1   = items.find(i => i.name === 'file1.las');
    expect(folderA.depth).toBe(0);
    expect(file1.depth).toBe(1);
  });

  it('builds correct slash-separated paths', () => {
    const items = flatten(tree, new Set(['folderA']));
    expect(items.find(i => i.name === 'file1.las').path).toBe('folderA/file1.las');
  });

  it('sorts dirs before files', () => {
    const mixed = {
      name: '', type: 'dir',
      children: {
        'zfile.las': { name: 'zfile.las', type: 'file' },
        'aFolder':   { name: 'aFolder',   type: 'dir', children: {} },
      }
    };
    const items = flatten(mixed, new Set());
    expect(items[0].type).toBe('dir');
    expect(items[1].type).toBe('file');
  });
});
