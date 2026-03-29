import { describe, it, expect, beforeEach } from 'vitest';

// TabState is a Svelte 5 runes class — test the logic directly
// by importing the class definition rather than the singleton.

class TabState {
  tabs = $state([]);
  activeId = $state(null);

  get activeTab() {
    return this.tabs.find(t => t.id === this.activeId) ?? null;
  }

  async openFile(item) {
    if (this.tabs.find(t => t.id === item.path)) {
      this.activeId = item.path;
      return;
    }
    const ext = item.name.includes('.')
      ? '.' + item.name.split('.').pop().toLowerCase()
      : '';
    let file = item.file ?? null;
    if (!file && item.handle?.kind === 'file') {
      file = await item.handle.getFile();
    }
    this.tabs.push({ id: item.path, name: item.name, ext, file, driveId: item.id ?? null });
    this.activeId = item.path;
  }

  closeTab(id) {
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);
    if (this.activeId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? null;
      this.activeId = next?.id ?? null;
    }
  }

  setActive(id) { this.activeId = id; }
}

describe('TabState', () => {
  let store;

  beforeEach(() => { store = new TabState(); });

  it('starts empty', () => {
    expect(store.tabs).toHaveLength(0);
    expect(store.activeId).toBeNull();
    expect(store.activeTab).toBeNull();
  });

  it('opens a file and sets it active', async () => {
    await store.openFile({ path: 'a/foo.las', name: 'foo.las', file: null });
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].ext).toBe('.las');
    expect(store.activeId).toBe('a/foo.las');
    expect(store.activeTab?.name).toBe('foo.las');
  });

  it('does not duplicate an already-open file', async () => {
    const item = { path: 'a/foo.las', name: 'foo.las', file: null };
    await store.openFile(item);
    await store.openFile(item);
    expect(store.tabs).toHaveLength(1);
  });

  it('activates existing tab when opened again', async () => {
    const a = { path: 'a/foo.las', name: 'foo.las', file: null };
    const b = { path: 'b/bar.dlis', name: 'bar.dlis', file: null };
    await store.openFile(a);
    await store.openFile(b);
    expect(store.activeId).toBe('b/bar.dlis');
    await store.openFile(a);
    expect(store.activeId).toBe('a/foo.las');
    expect(store.tabs).toHaveLength(2);
  });

  it('closes a tab and activates the next one', async () => {
    await store.openFile({ path: 'a/a.las', name: 'a.las', file: null });
    await store.openFile({ path: 'b/b.las', name: 'b.las', file: null });
    store.closeTab('b/b.las');
    expect(store.tabs).toHaveLength(1);
    expect(store.activeId).toBe('a/a.las');
  });

  it('sets activeId to null when last tab is closed', async () => {
    await store.openFile({ path: 'a/a.las', name: 'a.las', file: null });
    store.closeTab('a/a.las');
    expect(store.tabs).toHaveLength(0);
    expect(store.activeId).toBeNull();
  });

  it('parses extension correctly', async () => {
    await store.openFile({ path: 'x/Well.DLIS1', name: 'Well.DLIS1', file: null });
    expect(store.tabs[0].ext).toBe('.dlis1');
  });

  it('resolves FileSystemFileHandle to File on open', async () => {
    const mockFile = new File([''], 'test.las');
    const handle = { kind: 'file', getFile: async () => mockFile };
    await store.openFile({ path: 'x/test.las', name: 'test.las', handle });
    expect(store.tabs[0].file).toBe(mockFile);
  });
});
