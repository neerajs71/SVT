<script>
  /**
   * WorkflowApp — root component for .wflow files.
   * Registered in registry.js for the '.wflow' extension.
   *
   * Props: { tab }  — standard app tab prop
   */
  import { onMount } from 'svelte';
  import { parseWorkflow, serialiseWorkflow, createNode } from './format.js';
  import { execute } from './engine.js';
  import { NODE_TYPES } from './nodes/registry.js';
  import NodeCanvas  from './components/NodeCanvas.svelte';
  import NodePalette from './components/NodePalette.svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { saveToHandle, downloadBlob } from '$lib/apps/shared/fileActions.js';

  const { tab } = $props();

  // ── Graph state ───────────────────────────────────────────────────────────────
  let nodes = $state([]);
  let wires = $state([]);

  // ── Execution results ─────────────────────────────────────────────────────────
  let results = $state(new Map());
  let errors  = $state(new Map());
  let running = $state(false);
  let runError = $state('');

  // ── Dirty tracking ────────────────────────────────────────────────────────────
  let _loadedJson = $state('');
  const _currentJson = $derived(serialiseWorkflow(nodes, wires));
  const dirty = $derived(_currentJson !== _loadedJson);
  $effect(() => { tabStore.setDirty(tab.id, dirty); });

  // ── File slot data (from open LAS/DLIS tabs) ──────────────────────────────────
  // Populated when user assigns files to CurveSource nodes.
  // Key: slot label (e.g. 'F1'), value: { depths, curves: Map<mnemonic, Float64Array> }
  let slotData = $state(new Map());

  // ── Load .wflow file ──────────────────────────────────────────────────────────
  async function loadFile() {
    if (!tab) return;
    try {
      let text;
      if (tab.file) {
        text = await tab.file.text();
      } else if (tab.driveId) {
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`);
        if (!res.ok) throw new Error(await res.text());
        text = await res.text();
      } else {
        return;
      }
      const wf = parseWorkflow(text);
      nodes = wf.nodes ?? [];
      wires = wf.wires ?? [];
      _loadedJson = serialiseWorkflow(nodes, wires);
    } catch (e) {
      runError = `Load error: ${e.message}`;
    }
  }

  // ── Save / Download ───────────────────────────────────────────────────────────
  let saveError = $state('');
  async function save() {
    const json = _currentJson;
    if (tab.handle) {
      try {
        await saveToHandle(tab.handle, json);
        _loadedJson = json;
      } catch (e) {
        saveError = e.message;
      }
    } else {
      downloadBlob(tab?.name ?? 'workflow.wflow', json, 'application/json');
    }
  }

  function download() {
    downloadBlob(tab?.name ?? 'workflow.wflow', _currentJson, 'application/json');
  }

  // ── Execute pipeline ──────────────────────────────────────────────────────────
  async function run() {
    running = true;
    runError = '';
    try {
      const { results: r, errors: e } = execute(nodes, wires, slotData);
      results = r;
      errors  = e;
      if (e.has('__graph__')) runError = e.get('__graph__');
    } catch (e) {
      runError = e.message;
    } finally {
      running = false;
    }
  }

  // ── Fit viewport ──────────────────────────────────────────────────────────────
  // (NodeCanvas handles zoom; this just triggers a reset via key)
  let canvasKey = $state(0);
  function fitView() { canvasKey++; }

  // ── Toolbar actions ───────────────────────────────────────────────────────────
  function clearAll() {
    if (!confirm('Clear all nodes and wires?')) return;
    nodes = [];
    wires = [];
    results = new Map();
    errors  = new Map();
  }

  // ── Add node from palette ─────────────────────────────────────────────────────
  function addNode(typeId) {
    const def = NODE_TYPES[typeId];
    if (!def) return;
    // Place new node offset from last node, or at default position
    const last = nodes[nodes.length - 1];
    const pos  = last
      ? { x: last.pos.x + 220, y: last.pos.y }
      : { x: 80, y: 80 };
    // Build default params from def
    const params = {};
    for (const p of def.params) params[p.key] = p.default;
    nodes = [...nodes, createNode(typeId, pos, params)];
  }

  onMount(loadFile);
</script>

<svelte:window onkeydown={(e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
}} />

<div class="flex flex-col h-full overflow-hidden bg-gray-950">

  <!-- ── Toolbar ── -->
  <div class="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700 shrink-0">
    <span class="text-xs font-bold text-gray-300 mr-2 truncate max-w-[160px]">
      {#if dirty}<span class="text-orange-400 mr-1">●</span>{/if}{tab?.name ?? 'Workflow'}
    </span>

    <button
      onclick={run}
      disabled={running || nodes.length === 0}
      class="flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-green-700 hover:bg-green-600 text-white font-semibold disabled:opacity-50 transition-colors"
    >
      {running ? '⏳' : '▶'} Run
    </button>

    <button
      onclick={save}
      class="px-2 py-1 text-xs rounded transition-colors
             {dirty ? 'bg-blue-700 hover:bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200'}"
      title={tab.handle ? 'Save to disk (Ctrl+S)' : 'Download file'}
    >{tab.handle ? '💾 Save' : '↓ Save'}</button>

    <button
      onclick={download}
      class="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
      title="Download current workflow"
    >⬇ Download</button>

    <button
      onclick={fitView}
      class="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200 transition-colors"
    >⊞ Fit</button>

    <button
      onclick={clearAll}
      class="px-2 py-1 text-xs rounded bg-gray-700 hover:bg-red-800 text-gray-200 transition-colors"
    >✕ Clear</button>

    <!-- Stats -->
    <span class="text-[10px] text-gray-500 ml-auto">
      {nodes.length} nodes · {wires.length} wires
    </span>

    <!-- Error badges -->
    {#if saveError}
      <span class="text-[10px] text-red-400 bg-red-950 px-2 py-0.5 rounded max-w-xs truncate cursor-pointer" title={saveError} onclick={() => saveError = ''}>
        💾 {saveError}
      </span>
    {/if}
    {#if runError}
      <span class="text-[10px] text-red-400 bg-red-950 px-2 py-0.5 rounded max-w-xs truncate" title={runError}>
        ⚠ {runError}
      </span>
    {/if}
  </div>

  <!-- ── Main area: palette + canvas ── -->
  <div class="flex flex-1 overflow-hidden">

    <!-- Node palette -->
    <NodePalette onAddNode={addNode} />

    <!-- Canvas -->
    {#key canvasKey}
      <NodeCanvas
        {nodes}
        {wires}
        {results}
        {errors}
        onNodesChange={n => (nodes = n)}
        onWiresChange={w => (wires = w)}
      />
    {/key}
  </div>
</div>
