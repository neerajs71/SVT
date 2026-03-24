/**
 * Tab Store (Svelte 5 runes)
 *
 * Each tab:
 *   { id, name, ext, file, driveId }
 *
 *   - id:      unique key (file path)
 *   - name:    display name (filename)
 *   - ext:     lowercase extension including dot, e.g. '.las'
 *   - file:    File object (local mode) or null
 *   - driveId: Google Drive file ID (remote mode) or null
 */

class TabState {
  tabs = $state([]);
  activeId = $state(null);

  get activeTab() {
    return this.tabs.find(t => t.id === this.activeId) ?? null;
  }

  openFile(item) {
    // If already open, just activate it
    if (this.tabs.find(t => t.id === item.path)) {
      this.activeId = item.path;
      return;
    }

    const ext = item.name.includes('.')
      ? '.' + item.name.split('.').pop().toLowerCase()
      : '';

    this.tabs.push({
      id: item.path,
      name: item.name,
      ext,
      file: item.file ?? null,
      driveId: item.id ?? null,
    });
    this.activeId = item.path;
  }

  closeTab(id) {
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    this.tabs.splice(idx, 1);

    if (this.activeId === id) {
      // Activate the nearest remaining tab
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? null;
      this.activeId = next?.id ?? null;
    }
  }

  setActive(id) {
    this.activeId = id;
  }
}

export const tabStore = new TabState();
