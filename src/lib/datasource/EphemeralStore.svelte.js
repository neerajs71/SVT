/**
 * EphemeralStore — in-memory virtual workspace for mobile/no-filesystem use.
 *
 * Files live in $state only; nothing is persisted to disk.
 * Each file exposes a fake FileSystemFileHandle so apps can save normally
 * (saveToHandle writes back into this store instead of disk).
 */

// ── Default content for each supported type ──────────────────────────────────
const TEMPLATES = {
  '.tpl': JSON.stringify({
    title: 'New Template',
    fileSlots: { F1: null },
    indexCurve: { fileSlot: 'F1', curveMnemonic: 'DEPT', unit: 'ft' },
    depth: { min: 0, max: 5000, unit: 'ft', scale: '1:200', visibleMin: 0, visibleMax: 5000 },
    panels: [],
    curveDefinitions: [],
  }, null, 2),

  '.wflow': JSON.stringify({ version: '1.0', nodes: [], wires: [] }, null, 2),

  '.dgeo': JSON.stringify({
    version: '1.0',
    domain: { x: { min: 0, max: 10 }, y: { min: 0, max: 5000 } },
    horizons: [],
  }, null, 2),

  '.wson': JSON.stringify({
    openHole: [], casedHole: [], cementing: [],
    strata: [], perforations: [], completions: [], profile: [],
  }, null, 2),

  '.txt':  '',
  '.json': '{}',
};

export const FILE_TYPES = [
  { label: 'Plot Template', ext: '.tpl',   icon: '📊' },
  { label: 'Workflow',      ext: '.wflow', icon: '🔗' },
  { label: 'Geological',    ext: '.dgeo',  icon: '🗺' },
  { label: 'Schematic',     ext: '.wson',  icon: '🛢' },
  { label: 'Text',          ext: '.txt',   icon: '📄' },
  { label: 'JSON',          ext: '.json',  icon: '{ }' },
];

// ── Store class ───────────────────────────────────────────────────────────────
class EphemeralStore {
  /** @type {{ id:string, name:string, ext:string, content:string }[]} */
  files = $state([]);

  /** Create a new file and return its record. */
  create(name, ext) {
    const id = `eph_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const content = TEMPLATES[ext] ?? '';
    const file = { id, name, ext, content };
    this.files = [...this.files, file];
    return file;
  }

  /** Update content of an existing file (called by ephemeral handle). */
  _updateContent(id, content) {
    this.files = this.files.map(f => f.id === id ? { ...f, content } : f);
  }

  /** Delete a file. */
  remove(id) {
    this.files = this.files.filter(f => f.id !== id);
  }

  /** Rename a file. */
  rename(id, newName) {
    this.files = this.files.map(f => f.id === id ? { ...f, name: newName } : f);
  }

  /**
   * Build a tab-compatible item for tabStore.openFile().
   * The handle's createWritable() writes back into this store.
   */
  toTabItem(eph) {
    const store = this;
    const file = new File([eph.content], eph.name, { type: 'application/octet-stream' });
    const handle = {
      kind: 'file',
      name: eph.name,
      _ephemeralId: eph.id,
      createWritable: async () => {
        let buf = '';
        return {
          write: async (chunk) => { buf += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk); },
          close: async () => { store._updateContent(eph.id, buf); },
        };
      },
    };
    return {
      name: eph.name,
      ext:  eph.ext,
      path: `working/${eph.name}`,
      file,
      handle,
      id:   null,
    };
  }
}

export const ephemeralStore = new EphemeralStore();
