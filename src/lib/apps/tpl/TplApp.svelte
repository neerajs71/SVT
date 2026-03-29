<script>
  import { onMount } from 'svelte';
  import { parseTpl, extractLasCurve, getLasWellName, collectFiles } from './parser.js';
  import { parseLAS } from '$lib/apps/las/parser.js';
  import { datasourceStore } from '$lib/datasource/store.svelte.js';
  import { FloatingPanel } from '$lib/components/FloatingPanel';

  const { tab } = $props();

  // ── State ────────────────────────────────────────────────────────────────
  let tpl      = $state(null);
  let loading  = $state(true);
  let error    = $state('');

  // slot key → { name, wellName, las }
  let slotFiles = $state({});

  // Which slot is being picked
  let pickingSlot = $state(null);

  // Editing overlays
  let editingPanel = $state(null);
  let editingCurve = $state(null);

  // ── Layout constants ─────────────────────────────────────────────────────
  const DEPTH_W  = 64;
  const CHART_H  = 600;
  const HEADER_H = 64;
  const XAXIS_H  = 28;
  const TOTAL_H  = HEADER_H + CHART_H + XAXIS_H;

  // ── Load TPL ─────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      let text;
      if (tab.file) {
        text = await tab.file.text();
      } else if (tab.driveId) {
        const ctl = new AbortController();
        const tid = setTimeout(() => ctl.abort(), 30_000);
        try {
          const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`, { signal: ctl.signal });
          if (!res.ok) throw new Error(`Drive fetch failed: ${res.status}`);
          text = await res.text();
        } finally { clearTimeout(tid); }
      } else {
        throw new Error('No file source');
      }
      tpl = parseTpl(text);
    } catch (e) {
      error = e.name === 'AbortError' ? 'Timed out — please retry' : (e.message ?? String(e));
    } finally {
      loading = false;
    }
  });

  // ── Workspace file list (for slot picker) ────────────────────────────────
  const DATA_EXTS = ['.las', '.las2', '.dlis', '.dlis1'];

  const workspaceFiles = $derived.by(() => {
    const tree = datasourceStore.tree;
    if (!tree) return [];
    return collectFiles(tree).filter(f =>
      DATA_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
    );
  });

  // Group workspace files by well name (using cached LAS header if already loaded)
  const filesByWell = $derived.by(() => {
    const groups = {};
    for (const f of workspaceFiles) {
      // Check if already loaded in a slot — use that well name
      const loaded = Object.values(slotFiles).find(s => s.name === f.name);
      const well = loaded?.wellName ?? f.name.replace(/\.[^.]+$/, '');
      if (!groups[well]) groups[well] = [];
      groups[well].push(f);
    }
    return groups;
  });

  // ── Assign file to slot ──────────────────────────────────────────────────
  async function assignFile(slotKey, item) {
    try {
      let text;
      if (item.file) {
        text = await item.file.text();
      } else if (item.id) {
        const ctl = new AbortController();
        const tid = setTimeout(() => ctl.abort(), 30_000);
        try {
          const res = await fetch(`/api/drive?fileId=${encodeURIComponent(item.id)}`, { signal: ctl.signal });
          if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
          text = await res.text();
        } finally { clearTimeout(tid); }
      }
      const las = parseLAS(text);
      const wellName = getLasWellName(las, item.name);
      slotFiles = { ...slotFiles, [slotKey]: { name: item.name, wellName, las } };
    } catch (e) {
      console.error('[TplApp] assignFile:', e);
    }
    pickingSlot = null;
  }

  function clearSlot(slotKey) {
    const next = { ...slotFiles };
    delete next[slotKey];
    slotFiles = next;
  }

  // ── Derived: curves grouped by panel ────────────────────────────────────
  const panelCurves = $derived.by(() => {
    if (!tpl) return {};
    const map = {};
    for (const c of (tpl.curveDefinitions ?? [])) {
      if (!map[c.trackId]) map[c.trackId] = [];
      map[c.trackId].push(c);
    }
    return map;
  });

  const totalSvgW = $derived(
    tpl ? DEPTH_W + (tpl.panels ?? []).reduce((s, p) => s + p.width, 0) : 0
  );

  // ── Depth helpers ────────────────────────────────────────────────────────
  function dMin() { return tpl?.depth?.visibleMin ?? tpl?.depth?.min ?? 0; }
  function dMax() { return tpl?.depth?.visibleMax ?? tpl?.depth?.max ?? 5000; }
  function dRange() { return (dMax() - dMin()) || 1; }
  function sy(d) { return HEADER_H + ((d - dMin()) / dRange()) * CHART_H; }

  const depthTicks = $derived.by(() => {
    if (!tpl) return [];
    return Array.from({ length: 11 }, (_, i) => {
      const d = dMin() + (i / 10) * dRange();
      return { d, py: sy(d) };
    });
  });

  // ── Per-panel helpers ────────────────────────────────────────────────────
  function isLog(panel) { return panel.gridType === 'logarithmic'; }

  function xToPixel(panel, value) {
    const w = panel.width;
    if (isLog(panel)) {
      const lMin = Math.log10(Math.max(panel.xMin, 1e-10));
      const lMax = Math.log10(Math.max(panel.xMax, 1e-10));
      const lv   = Math.log10(Math.max(value, 1e-10));
      return ((lv - lMin) / (lMax - lMin || 1)) * w;
    }
    return ((value - panel.xMin) / ((panel.xMax - panel.xMin) || 1)) * w;
  }

  function gridLines(panel) {
    const w = panel.width;
    if (isLog(panel)) {
      const lines = [];
      const lMin = Math.log10(Math.max(panel.xMin, 1e-10));
      const lMax = Math.log10(Math.max(panel.xMax, 1e-10));
      const lRange = (lMax - lMin) || 1;
      const eMin = Math.floor(Math.log10(panel.xMin));
      const eMax = Math.ceil(Math.log10(panel.xMax));
      for (let e = eMin; e <= eMax; e++) {
        for (let m = 1; m <= 9; m++) {
          const v = m * Math.pow(10, e);
          if (v < panel.xMin * 0.99 || v > panel.xMax * 1.01) continue;
          const px = ((Math.log10(v) - lMin) / lRange) * w;
          lines.push({ px, major: m === 1 });
        }
      }
      return lines;
    }
    const n = panel.numGridLines ?? 10;
    return Array.from({ length: n + 1 }, (_, i) => ({
      px: (i / n) * w,
      major: i === 0 || i === n
    }));
  }

  function xLabels(panel) {
    if (isLog(panel)) {
      const lMin = Math.log10(Math.max(panel.xMin, 1e-10));
      const lMax = Math.log10(Math.max(panel.xMax, 1e-10));
      const lRange = (lMax - lMin) || 1;
      const eMin = Math.floor(Math.log10(panel.xMin));
      const eMax = Math.ceil(Math.log10(panel.xMax));
      const labels = [];
      for (let e = eMin; e <= eMax; e++) {
        const v = Math.pow(10, e);
        if (v < panel.xMin * 0.99 || v > panel.xMax * 1.01) continue;
        const px = ((Math.log10(v) - lMin) / lRange) * panel.width;
        labels.push({ px, label: fmtNum(v) });
      }
      return labels;
    }
    const n = 5;
    const range = panel.xMax - panel.xMin;
    return Array.from({ length: n + 1 }, (_, i) => ({
      px: (i / n) * panel.width,
      label: fmtNum(panel.xMin + (i / n) * range)
    }));
  }

  function curvePoints(panel, curveDef) {
    const slot = slotFiles[curveDef.fileSlot];
    if (!slot?.las) return '';
    const cd = extractLasCurve(slot.las, curveDef.curveMnemonic);
    if (!cd) return '';
    const { depths, values } = cd;
    const dMn = dMin(), dMx = dMax();
    const pts = [];
    for (let i = 0; i < depths.length; i++) {
      const d = depths[i], v = values[i];
      if (d < dMn || d > dMx) continue;
      const py = sy(d);
      const px = Math.max(0, Math.min(panel.width, xToPixel(panel, v)));
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    return pts.join(' ');
  }

  function dashArray(style) {
    if (style === 'dashed') return '6,3';
    if (style === 'dotted') return '2,2';
    return null;
  }

  function fmtNum(n) {
    if (!isFinite(n)) return '';
    if (Math.abs(n) >= 10000) return (n / 1000).toFixed(0) + 'k';
    if (Math.abs(n) >= 1000)  return (n / 1000).toFixed(1) + 'k';
    if (Math.abs(n) < 0.01 && n !== 0) return n.toExponential(1);
    return parseFloat(n.toPrecision(3)).toString();
  }

  // ── Template editing ─────────────────────────────────────────────────────
  function startEditPanel(panel) { editingPanel = { ...panel }; }
  function saveEditPanel() {
    tpl = { ...tpl, panels: tpl.panels.map(p => p.id === editingPanel.id ? { ...editingPanel } : p) };
    editingPanel = null;
  }

  function startEditCurve(curve) { editingCurve = { ...curve, line: { ...curve.line } }; }
  function saveEditCurve() {
    tpl = { ...tpl, curveDefinitions: tpl.curveDefinitions.map(c => c.id === editingCurve.id ? { ...editingCurve } : c) };
    editingCurve = null;
  }
  function deleteCurve() {
    tpl = { ...tpl, curveDefinitions: tpl.curveDefinitions.filter(c => c.id !== editingCurve.id) };
    editingCurve = null;
  }

  function saveTpl() {
    const blob = new Blob([JSON.stringify(tpl, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = tab.name;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // Panel x offset (cumulative)
  function panelX(panels, idx) {
    return DEPTH_W + panels.slice(0, idx).reduce((s, p) => s + p.width, 0);
  }
</script>

{#if loading}
  <div class="flex items-center justify-center h-48 text-gray-400 text-sm">Loading template…</div>
{:else if error}
  <div class="p-4 text-red-600 text-sm">
    <p class="font-semibold">Failed to load TPL</p>
    <p class="mt-1">{error}</p>
  </div>
{:else if tpl}
  <div class="flex flex-col h-full overflow-hidden bg-white">

    <!-- ── Toolbar ─────────────────────────────────────────────────────── -->
    <div class="flex items-center gap-3 px-3 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0 flex-wrap">
      <span class="text-sm font-semibold text-gray-700">{tpl.title ?? tab.name}</span>
      <span class="text-xs text-gray-400">{tpl.depth?.min ?? 0} – {tpl.depth?.max ?? '?'} {tpl.depth?.unit ?? ''}</span>

      <!-- File slot assignments -->
      <div class="flex items-center gap-2 ml-2 flex-wrap">
        {#each Object.entries(tpl.fileSlots ?? {}) as [slotKey]}
          <div class="flex items-center gap-1">
            <span class="text-xs text-gray-500 font-mono">{slotKey}:</span>
            {#if slotFiles[slotKey]}
              <span class="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5 max-w-[140px] truncate"
                title={slotFiles[slotKey].wellName}>
                {slotFiles[slotKey].wellName}
              </span>
              <button onclick={() => clearSlot(slotKey)}
                class="text-xs text-gray-400 hover:text-red-500 leading-none">✕</button>
            {:else}
              <button onclick={() => (pickingSlot = slotKey)}
                class="text-xs bg-white border border-dashed border-gray-300 text-gray-500 rounded px-2 py-0.5 hover:border-blue-400 hover:text-blue-600">
                Assign file…
              </button>
            {/if}
          </div>
        {/each}
      </div>

      <div class="flex-1"></div>
      <button onclick={saveTpl}
        class="text-xs bg-white border border-gray-300 rounded px-2.5 py-1 hover:bg-gray-50 text-gray-600">
        Save TPL
      </button>
    </div>

    <!-- ── Main SVG area ──────────────────────────────────────────────── -->
    <div class="flex-1 overflow-auto">
      <svg
        width={totalSvgW}
        height={TOTAL_H}
        style="display:block;min-width:{totalSvgW}px;font-family:sans-serif"
      >
        <!-- Depth column background -->
        <rect x="0" y="0" width={DEPTH_W} height={TOTAL_H} fill="#f3f4f6"/>
        <rect x="0" y={HEADER_H} width={DEPTH_W} height={CHART_H} fill="#f3f4f6"/>

        <!-- Depth ticks + labels -->
        {#each depthTicks as t}
          <line x1="0" y1={t.py} x2={totalSvgW} y2={t.py} stroke="#e5e7eb" stroke-width="0.5"/>
          <text x={DEPTH_W - 4} y={t.py + 3} text-anchor="end" font-size="9" fill="#6b7280">
            {Math.round(t.d)}
          </text>
        {/each}

        <!-- Depth axis label -->
        <text x={DEPTH_W / 2} y={HEADER_H / 2 + 4} text-anchor="middle" font-size="9" fill="#374151" font-weight="bold">
          {tpl.indexCurve?.curveMnemonic ?? 'DEPTH'}
        </text>
        <text x={DEPTH_W / 2} y={HEADER_H / 2 + 14} text-anchor="middle" font-size="8" fill="#9ca3af">
          {tpl.depth?.unit ?? ''}
        </text>

        <!-- ── Panels ──────────────────────────────────────────────────── -->
        {#each tpl.panels as panel, pi}
          {@const px = panelX(tpl.panels, pi)}
          {@const curves = panelCurves[panel.id] ?? []}
          {@const gl = gridLines(panel)}
          {@const xl = xLabels(panel)}

          <!-- Panel background -->
          <rect x={px} y={HEADER_H} width={panel.width} height={CHART_H} fill={panel.color ?? '#ffffff'}/>

          <!-- Panel border -->
          <rect x={px} y={HEADER_H} width={panel.width} height={CHART_H}
            fill="none" stroke="#d1d5db" stroke-width="0.8"/>

          <!-- Grid lines (vertical) -->
          {#each gl as g}
            <line
              x1={px + g.px} y1={HEADER_H}
              x2={px + g.px} y2={HEADER_H + CHART_H}
              stroke={g.major ? '#9ca3af' : '#e5e7eb'}
              stroke-width={g.major ? 0.8 : 0.4}
            />
          {/each}

          <!-- Depth tick lines -->
          {#each depthTicks as t}
            <line x1={px} y1={t.py} x2={px + panel.width} y2={t.py}
              stroke="#e5e7eb" stroke-width="0.3"/>
          {/each}

          <!-- Curves -->
          {#each curves as curveDef}
            {@const pts = curvePoints(panel, curveDef)}
            {#if pts}
              <polyline
                points={pts}
                fill="none"
                stroke={curveDef.color ?? '#374151'}
                stroke-width={curveDef.line?.thickness ?? 1.2}
                stroke-dasharray={dashArray(curveDef.line?.style) ?? undefined}
                opacity="0.9"
                transform="translate({px},0)"
              />
            {/if}
          {/each}

          <!-- Panel header: title + curve chips -->
          <rect x={px} y="0" width={panel.width} height={HEADER_H} fill="#f8fafc"/>
          <rect x={px} y="0" width={panel.width} height={HEADER_H}
            fill="none" stroke="#d1d5db" stroke-width="0.8"/>

          <!-- Panel title (clickable to edit) -->
          <text x={px + panel.width / 2} y="14" text-anchor="middle"
            font-size="10" font-weight="bold" fill="#374151"
            style="cursor:pointer"
            onclick={() => startEditPanel(panel)}>
            {panel.title}
          </text>

          <!-- Curve chips in header -->
          {#each curves as curveDef, ci}
            {@const chipX = px + 4 + ci * 68}
            {#if chipX + 64 <= px + panel.width}
              <!-- swatch -->
              <rect x={chipX} y="20" width="10" height="3"
                fill={curveDef.color ?? '#374151'}
                rx="1"/>
              <text x={chipX + 13} y="24" font-size="8" fill="#374151"
                style="cursor:pointer"
                onclick={() => startEditCurve(curveDef)}>
                {curveDef.curveMnemonic}
              </text>
            {/if}
          {/each}

          <!-- X-scale range labels -->
          <text x={px + 3} y={HEADER_H - 4} font-size="8" fill="#6b7280">{fmtNum(panel.xMin)}</text>
          <text x={px + panel.width - 3} y={HEADER_H - 4} text-anchor="end" font-size="8" fill="#6b7280">{fmtNum(panel.xMax)}</text>
          {#if isLog(panel)}
            <text x={px + panel.width / 2} y={HEADER_H - 4} text-anchor="middle" font-size="7" fill="#9ca3af">LOG</text>
          {/if}

          <!-- X-axis labels (below chart) -->
          {#each xl as lbl}
            <text
              x={px + lbl.px} y={HEADER_H + CHART_H + 14}
              text-anchor="middle" font-size="8" fill="#6b7280"
            >{lbl.label}</text>
          {/each}

        {/each}

      </svg>
    </div>

  </div>

  <!-- ── Slot Picker FloatingPanel ────────────────────────────────────── -->
  <FloatingPanel
    title="Assign file to {pickingSlot}"
    visible={pickingSlot !== null}
    onClose={() => (pickingSlot = null)}
    width={300}
    x={80}
    y={80}
  >
    {#snippet children()}
      <div class="p-2 max-h-80 overflow-y-auto">
        {#if Object.keys(filesByWell).length === 0}
          <p class="text-xs text-gray-400 p-2">No LAS/DLIS files in workspace.<br>Open a folder from the sidebar first.</p>
        {:else}
          {#each Object.entries(filesByWell) as [well, files]}
            <div class="mb-2">
              <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2 py-1">{well}</div>
              {#each files as f}
                <button
                  onclick={() => assignFile(pickingSlot, f)}
                  class="w-full text-left text-xs px-3 py-1.5 hover:bg-blue-50 hover:text-blue-700 rounded truncate"
                  title={f.name}
                >
                  {f.name}
                </button>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    {/snippet}
  </FloatingPanel>

  <!-- ── Panel Editor FloatingPanel ───────────────────────────────────── -->
  <FloatingPanel
    title="Edit Panel"
    visible={editingPanel !== null}
    onClose={() => (editingPanel = null)}
    width={240}
    x={100}
    y={100}
  >
    {#snippet children()}
      {#if editingPanel}
        <div class="flex flex-col gap-2 p-3">
          <div>
            <label class="block text-xs text-gray-500 mb-0.5">Title</label>
            <input type="text" bind:value={editingPanel.title}
              class="w-full text-xs border border-gray-200 rounded px-2 py-1"/>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">X Min</label>
              <input type="number" bind:value={editingPanel.xMin}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1"/>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">X Max</label>
              <input type="number" bind:value={editingPanel.xMax}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1"/>
            </div>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-0.5">Scale</label>
            <select bind:value={editingPanel.gridType}
              class="w-full text-xs border border-gray-200 rounded px-2 py-1">
              <option value="linear">Linear</option>
              <option value="logarithmic">Logarithmic</option>
            </select>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">Width (px)</label>
              <input type="number" bind:value={editingPanel.width}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1"/>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">Grid lines</label>
              <input type="number" bind:value={editingPanel.numGridLines}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1"/>
            </div>
          </div>
          <button onclick={saveEditPanel}
            class="mt-1 text-xs bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700 font-medium">
            Apply
          </button>
        </div>
      {/if}
    {/snippet}
  </FloatingPanel>

  <!-- ── Curve Editor FloatingPanel ───────────────────────────────────── -->
  <FloatingPanel
    title="Edit Curve"
    visible={editingCurve !== null}
    onClose={() => (editingCurve = null)}
    width={220}
    x={120}
    y={120}
  >
    {#snippet children()}
      {#if editingCurve}
        <div class="flex flex-col gap-2 p-3">
          <div>
            <label class="block text-xs text-gray-500 mb-0.5">Mnemonic</label>
            <input type="text" bind:value={editingCurve.curveMnemonic}
              class="w-full text-xs border border-gray-200 rounded px-2 py-1 uppercase"/>
          </div>
          <div>
            <label class="block text-xs text-gray-500 mb-0.5">Color</label>
            <input type="color" bind:value={editingCurve.color}
              class="w-full h-8 border border-gray-200 rounded px-1 cursor-pointer"/>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">Thickness</label>
              <input type="number" step="0.1" min="0.5" max="5" bind:value={editingCurve.line.thickness}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1"/>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">Style</label>
              <select bind:value={editingCurve.line.style}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1">
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </div>
          </div>
          <div class="flex gap-1.5 pt-1">
            <button onclick={saveEditCurve}
              class="flex-1 text-xs bg-blue-600 text-white rounded px-2 py-1.5 hover:bg-blue-700 font-medium">
              Apply
            </button>
            <button onclick={deleteCurve}
              class="text-xs bg-red-50 text-red-600 border border-red-200 rounded px-2 py-1.5 hover:bg-red-100">
              Remove
            </button>
          </div>
        </div>
      {/if}
    {/snippet}
  </FloatingPanel>

{/if}
