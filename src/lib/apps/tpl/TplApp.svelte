<script>
  import { onMount } from 'svelte';
  import { parseTpl, extractLasCurve, getLasWellName, collectFiles } from './parser.js';
  import { parseLAS } from '$lib/apps/las/parser.js';
  import { processCurves } from '$lib/apps/las/utils.js';
  import { parseDLISFile, extractLogicalFiles, extractCurveData } from '$lib/apps/dlis/utils.js';
  import { datasourceStore } from '$lib/datasource/store.svelte.js';
  import { FloatingPanel } from '$lib/components/FloatingPanel';
  import { FolderSolid, FolderOpenSolid, FileLinesOutline } from 'flowbite-svelte-icons';
  import { SUBAPP_REGISTRY } from './subapps/index.js';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { saveToHandle, downloadBlob } from '$lib/apps/shared/fileActions.js';
  import { MEASUREMENT_TYPES, getMeasurementType } from './measurements.js';

  const { tab } = $props();

  // ── State ────────────────────────────────────────────────────────────────
  let tpl      = $state(null);
  let loading  = $state(true);
  let error    = $state('');
  let saveErr  = $state('');
  let _loadedHash = $state('');
  const dirty  = $derived(tpl ? JSON.stringify(tpl) !== _loadedHash : false);
  $effect(() => { tabStore.setDirty(tab.id, dirty); });

  // slot key → { name, wellName, las }
  let slotFiles = $state({});

  // Which slot is being picked
  let pickingSlot = $state(null);

  // Slot picker: preview state
  let previewItem    = $state(null);   // workspace item being previewed
  let previewData    = $state(null);   // { type, wellName, dMin, dMax, unit, curves[], las?, error? }
  let previewLoading = $state(false);
  let slotFilter     = $state('');

  // Editing overlays
  let editingPanel = $state(null);
  let editingCurve = $state(null);

  // ── Layout constants ─────────────────────────────────────────────────────
  const DEPTH_W    = 64;
  const CHART_H    = 600;
  const CURVE_ROW_H = 28;   // header px per curve row (enough for numbers + line + label)
  const TOGGLE_H    = 10;   // collapse toggle bar height
  const XAXIS_H    = 28;
  let headerCollapsed = $state(false);
  // Header grows to fit the tallest panel; collapses to just the toggle bar
  const HEADER_H = $derived.by(() => {
    if (headerCollapsed) return TOGGLE_H;
    if (!tpl) return 44;
    const maxN = Math.max(1, ...Object.values(panelCurves).map(cs => cs.length));
    return Math.max(44, maxN * CURVE_ROW_H) + TOGGLE_H;
  });
  const TOTAL_H = $derived(HEADER_H + CHART_H + XAXIS_H);

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
      _loadedHash = JSON.stringify(tpl);
      autoReconnectSlots();
    } catch (e) {
      error = e.name === 'AbortError' ? 'Timed out — please retry' : (e.message ?? String(e));
    } finally {
      loading = false;
    }
  });

  // Load the bundled sample template (for offline / quick testing)
  async function loadSample() {
    try {
      loading = true; error = '';
      const res = await fetch('/samples/basic_log.tpl');
      if (!res.ok) throw new Error('Sample not found');
      tpl = parseTpl(await res.text());
      _loadedHash = JSON.stringify(tpl);
    } catch (e) {
      error = e.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  // ── Workspace file list (for slot picker) ────────────────────────────────
  const DATA_EXTS = ['.las', '.las2', '.dlis', '.dlis1'];

  // All data files in the tree (flat, for search matching)
  const workspaceFiles = $derived.by(() => {
    const tree = datasourceStore.tree;
    if (!tree) return [];
    return collectFiles(tree).filter(f =>
      DATA_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))
    );
  });

  // Picker-local expanded state (separate from sidebar)
  let pickerExpanded = $state(new Set());

  // Resizable left panel in picker
  let pickerPanelW = $state(140);  // px
  let pickerPanelDragging = false;
  let pickerPanelDragStartX = 0;
  let pickerPanelDragStartW = 0;
  function onPickerPanelDragStart(e) {
    pickerPanelDragging = true;
    pickerPanelDragStartX = e.clientX;
    pickerPanelDragStartW = pickerPanelW;
    window.addEventListener('pointermove', onPickerPanelDragMove);
    window.addEventListener('pointerup', onPickerPanelDragEnd);
    e.preventDefault();
  }
  function onPickerPanelDragMove(e) {
    if (!pickerPanelDragging) return;
    pickerPanelW = Math.max(80, Math.min(200, pickerPanelDragStartW + (e.clientX - pickerPanelDragStartX)));
  }
  function onPickerPanelDragEnd() {
    pickerPanelDragging = false;
    window.removeEventListener('pointermove', onPickerPanelDragMove);
    window.removeEventListener('pointerup', onPickerPanelDragEnd);
  }

  function togglePickerFolder(path) {
    const next = new Set(pickerExpanded);
    next.has(path) ? next.delete(path) : next.add(path);
    pickerExpanded = next;
  }

  // When the picker opens: pre-load all remote sub-folders then auto-expand.
  // deepFetch() is self-contained — it uses untrack() internally so calling it
  // here does not subscribe this effect to deepFetching / mode / tree.
  // The only reactive dependency of this effect is pickingSlot.
  $effect(() => {
    if (pickingSlot === null) return;
    datasourceStore.deepFetch().then(() => {
      const paths = new Set();
      function collectPaths(node, parentPath) {
        for (const [name, child] of Object.entries(node?.children ?? {})) {
          const path = parentPath ? `${parentPath}/${name}` : name;
          if (child.type === 'dir') { paths.add(path); collectPaths(child, path); }
        }
      }
      if (datasourceStore.tree) collectPaths(datasourceStore.tree, '');
      pickerExpanded = paths;
    });
  });

  // Picker items: tree structure, always pruned to data files only, filtered when query typed
  const pickerItems = $derived.by(() => {
    const q = slotFilter.trim().toLowerCase();
    // matchPaths = set of visible file paths (filtered subset, or all data files)
    const matchPaths = q
      ? new Set(workspaceFiles
          .filter(f => f.name.toLowerCase().includes(q) || f.path?.toLowerCase().includes(q))
          .map(f => f.path))
      : new Set(workspaceFiles.map(f => f.path));

    function subtreeHasMatch(node, parentPath) {
      for (const [name, child] of Object.entries(node?.children ?? {})) {
        const path = parentPath ? `${parentPath}/${name}` : name;
        if (child.type === 'file' && matchPaths.has(path)) return true;
        if (child.type === 'dir' && subtreeHasMatch(child, path)) return true;
      }
      return false;
    }

    const result = [];
    function walk(node, parentPath, depth) {
      for (const [name, child] of Object.entries(node?.children ?? {})) {
        const path = parentPath ? `${parentPath}/${name}` : name;
        if (child.type === 'dir') {
          if (!subtreeHasMatch(child, path)) continue; // always prune empty branches
          result.push({ ...child, path, name, depth, type: 'dir' });
          const expanded = q ? true : pickerExpanded.has(path);
          if (expanded) walk(child, path, depth + 1);
        } else {
          if (!DATA_EXTS.some(ext => name.toLowerCase().endsWith(ext))) continue;
          if (!matchPaths.has(path)) continue;
          result.push({ ...child, path, name, depth, type: 'file' });
        }
      }
    }
    if (datasourceStore.tree) walk(datasourceStore.tree, '', 0);
    return result;
  });

  // Reset preview when filter changes
  $effect(() => {
    slotFilter;
    previewItem = null;
    previewData = null;
  });

// Mnemonics the TPL expects from the slot currently being picked
  const slotExpectedMnemonics = $derived.by(() => {
    if (!pickingSlot || !tpl) return new Set();
    return new Set(
      (tpl.curveDefinitions ?? [])
        .filter(c => c.fileSlot === pickingSlot)
        .map(c => c.curveMnemonic?.toUpperCase())
        .filter(Boolean)
    );
  });

  // ── Preview a workspace file (load + parse, don't assign yet) ────────────
  async function previewFile(item) {
    if (previewItem?.path === item.path) return;
    previewItem = item;
    previewData = null;
    previewLoading = true;

    const isDlis = /\.dlis\d?$/i.test(item.name);

    try {
      // Fetch as ArrayBuffer (works for both binary DLIS and text LAS)
      let buf;
      if (item.file) {
        buf = await item.file.arrayBuffer();
      } else if (item.id) {
        const ctl = new AbortController();
        const tid = setTimeout(() => ctl.abort(), 30_000);
        try {
          const res = await fetch(`/api/drive?fileId=${encodeURIComponent(item.id)}`, { signal: ctl.signal });
          if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
          buf = await res.arrayBuffer();
        } finally { clearTimeout(tid); }
      } else {
        throw new Error('No source');
      }

      if (isDlis) {
        const parsed = await parseDLISFile(buf);
        const logicalFiles = extractLogicalFiles(parsed);
        // If only one logical file, auto-select it
        const autoLf = logicalFiles.length === 1 ? logicalFiles[0] : null;
        previewData = buildDlisPreview(item.name, logicalFiles, autoLf);
        previewData._parsed = parsed;  // keep raw parse result for slot assignment
      } else {
        const text = new TextDecoder('utf-8').decode(buf);
        const las = parseLAS(text);
        const summary = processCurves(las);
        previewData = {
          type: 'las',
          wellName: getLasWellName(las, item.name),
          dMin: parseFloat(summary.startDepth),
          dMax: parseFloat(summary.stopDepth),
          unit: las.well['STRT']?.unit ?? las.well['DEPT']?.unit ?? '',
          curves: summary.curves.map(c => ({ mnem: c.name, unit: c.unit, desc: c.desc, isIndex: c.isIndex })),
          las,
        };
      }
    } catch (e) {
      previewData = { error: e.message ?? String(e) };
    } finally {
      previewLoading = false;
    }
  }

  // ── DLIS helpers ─────────────────────────────────────────────────────────
  function buildDlisPreview(fileName, logicalFiles, selectedLf) {
    const fr0 = selectedLf?.frames[0];
    return {
      type: 'dlis',
      wellName: fileName.replace(/\.[^.]+$/, ''),
      logicalFiles,
      selectedLf,
      dMin: fr0?.indexMin != null ? parseFloat(fr0.indexMin) : null,
      dMax: fr0?.indexMax != null ? parseFloat(fr0.indexMax) : null,
      unit: '',
      curves: selectedLf?.channels.map(c => ({ mnem: c.name, unit: c.units, desc: c.longName })) ?? [],
    };
  }

  function selectLogicalFile(lf) {
    if (!previewData) return;
    const fr0 = lf.frames[0];
    previewData = {
      ...previewData,
      selectedLf: lf,
      dMin: fr0?.indexMin != null ? parseFloat(fr0.indexMin) : null,
      dMax: fr0?.indexMax != null ? parseFloat(fr0.indexMax) : null,
      curves: lf.channels.map(c => ({ mnem: c.name, unit: c.units, desc: c.longName })),
    };
  }

  // ── Assign the currently previewed file to the active slot ───────────────
  function assignPreview() {
    if (!previewItem || !previewData || previewData.error) return;
    const af = {
      name: previewItem.name,
      path: previewItem.path ?? null,
      id:   previewItem.id   ?? null,
    };

    // Build mnemonic → unit lookup from the file
    const curveUnits = {};
    if (previewData.type === 'las') {
      for (const c of (previewData.las?.curves ?? [])) {
        if (c.mnem) curveUnits[c.mnem.toUpperCase()] = c.unit ?? '';
      }
      slotFiles = { ...slotFiles, [pickingSlot]: {
        name: previewItem.name, wellName: previewData.wellName,
        las: previewData.las, curveUnits,
      }};
    } else {
      af.lfId = previewData.selectedLf?.id ?? null;
      for (const c of (previewData.curves ?? [])) {
        if (c.mnem) curveUnits[c.mnem.toUpperCase()] = c.unit ?? '';
      }
      slotFiles = { ...slotFiles, [pickingSlot]: {
        name: previewItem.name, wellName: previewData.wellName,
        lfId: af.lfId ?? 'LF-1', dlis: previewData._parsed, curveUnits,
      }};
    }

    // Auto-populate unit on curves in this slot that have no unit set yet
    const updatedDefs = (tpl.curveDefinitions ?? []).map(c => {
      if (c.fileSlot !== pickingSlot || c.unit) return c;
      const fileUnit = curveUnits[c.curveMnemonic?.toUpperCase()] ?? '';
      return fileUnit ? { ...c, unit: fileUnit } : c;
    });

    // Persist file reference + updated curve units
    tpl = {
      ...tpl,
      curveDefinitions: updatedDefs,
      fileSlots: {
        ...tpl.fileSlots,
        [pickingSlot]: { ...(tpl.fileSlots?.[pickingSlot] ?? {}), assignedFile: af },
      },
    };
    closePicker();
  }

  function closePicker() {
    pickingSlot = null;
    previewItem = null;
    previewData = null;
    slotFilter = '';
  }

  function clearSlot(slotKey) {
    const next = { ...slotFiles };
    delete next[slotKey];
    slotFiles = next;
    tpl = { ...tpl, fileSlots: { ...tpl.fileSlots, [slotKey]: null } };
  }

  function addSlot() {
    const existing = Object.keys(tpl.fileSlots ?? {});
    // Find next available Fn key
    let n = existing.length + 1;
    while (existing.includes(`F${n}`)) n++;
    tpl = { ...tpl, fileSlots: { ...tpl.fileSlots, [`F${n}`]: null } };
  }

  function removeSlot(slotKey) {
    // Only remove if no curves reference it
    const inUse = (tpl.curveDefinitions ?? []).some(c => c.fileSlot === slotKey);
    if (inUse) return;
    const { [slotKey]: _, ...restSlots } = tpl.fileSlots ?? {};
    const { [slotKey]: __, ...restFiles } = slotFiles;
    slotFiles = restFiles;
    tpl = { ...tpl, fileSlots: restSlots };
  }

  // ── Auto-reconnect slot files from the sidebar tree on load ──────────────
  async function autoReconnectSlots() {
    if (!tpl?.fileSlots || !datasourceStore.tree) return;
    const allFiles = collectFiles(datasourceStore.tree);
    for (const [slotKey, slot] of Object.entries(tpl.fileSlots)) {
      const af = slot?.assignedFile;
      if (!af || slotFiles[slotKey]) continue;
      const item = allFiles.find(f =>
        (af.id && f.id === af.id) ||
        (af.path && f.path === af.path) ||
        f.name === af.name
      );
      if (!item) continue;
      try {
        let buf;
        if (item.file) {
          buf = await item.file.arrayBuffer();
        } else if (item.id) {
          const res = await fetch(`/api/drive?fileId=${encodeURIComponent(item.id)}`);
          if (!res.ok) continue;
          buf = await res.arrayBuffer();
        } else continue;

        const isDlis = /\.dlis\d?$/i.test(item.name);
        const curveUnits = {};
        if (isDlis) {
          const parsed = await parseDLISFile(buf);
          const lfs = extractLogicalFiles(parsed);
          const lf = lfs.find(l => l.id === af.lfId) ?? lfs[0];
          if (!lf) continue;
          for (const c of (lf.channels ?? [])) {
            if (c.name) curveUnits[c.name.toUpperCase()] = c.units ?? '';
          }
          slotFiles = { ...slotFiles, [slotKey]: {
            name: item.name, wellName: lf.wellName ?? item.name,
            lfId: lf.id, dlis: parsed, curveUnits,
          }};
        } else {
          const las = parseLAS(new TextDecoder().decode(buf));
          for (const c of (las.curves ?? [])) {
            if (c.mnem) curveUnits[c.mnem.toUpperCase()] = c.unit ?? '';
          }
          slotFiles = { ...slotFiles, [slotKey]: {
            name: item.name, wellName: getLasWellName(las, item.name), las, curveUnits,
          }};
        }
      } catch (e) {
        console.warn(`Auto-reconnect slot ${slotKey}:`, e);
      }
    }
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

  function xToPixel(panel, value, xMin = panel.xMin, xMax = panel.xMax) {
    const w = panel.width;
    if (isLog(panel)) {
      const lMin = Math.log10(Math.max(xMin, 1e-10));
      const lMax = Math.log10(Math.max(xMax, 1e-10));
      const lv   = Math.log10(Math.max(value, 1e-10));
      return ((lv - lMin) / (lMax - lMin || 1)) * w;
    }
    return ((value - xMin) / ((xMax - xMin) || 1)) * w;
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
    if (!slot) return '';

    let depths, values;

    if (slot.las) {
      const cd = extractLasCurve(slot.las, curveDef.curveMnemonic);
      if (!cd) return '';
      depths = cd.depths;
      values = cd.values;
    } else if (slot.dlis) {
      const cd = extractCurveData(slot.dlis, curveDef.curveMnemonic);
      if (!cd) return '';
      depths = cd.xs;
      values = cd.ys;
    } else {
      return '';
    }

    const dMn = dMin(), dMx = dMax();
    const pts = [];
    for (let i = 0; i < depths.length; i++) {
      const d = depths[i], v = values[i];
      if (!isFinite(d) || !isFinite(v) || d < dMn || d > dMx) continue;
      const py = sy(d);
      const cMin = curveDef.xMin ?? panel.xMin;
      const cMax = curveDef.xMax ?? panel.xMax;
      const px = Math.max(0, Math.min(panel.width, xToPixel(panel, v, cMin, cMax)));
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
    }
    return pts.join(' ');
  }

  function dashArray(style) {
    if (style === 'dashed') return '6,3';
    if (style === 'dotted') return '2,2';
    return null;
  }

  // ── Hover crosshair ──────────────────────────────────────────────────────
  let hoverDepth = $state(null);
  let hoverClientX = $state(0);
  let hoverClientY = $state(0);

  function onSvgMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgY = e.clientY - rect.top;
    const depth = dMin() + ((svgY - HEADER_H) / CHART_H) * dRange();
    if (depth < dMin() || depth > dMax()) { hoverDepth = null; return; }
    hoverDepth = depth;
    hoverClientX = e.clientX - rect.left;
    hoverClientY = svgY;
  }

  function getCurveValueAtDepth(curveDef, depth) {
    const slot = slotFiles[curveDef.fileSlot];
    if (!slot) return null;
    let depths, values;
    if (slot.las) {
      const cd = extractLasCurve(slot.las, curveDef.curveMnemonic);
      if (!cd) return null;
      depths = cd.depths; values = cd.values;
    } else if (slot.dlis) {
      const cd = extractCurveData(slot.dlis, curveDef.curveMnemonic);
      if (!cd) return null;
      depths = cd.xs; values = cd.ys;
    } else return null;
    if (!depths?.length) return null;
    // Binary search for nearest depth
    let lo = 0, hi = depths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (depths[mid] < depth) lo = mid + 1; else hi = mid;
    }
    const idx = (lo > 0 && Math.abs(depths[lo-1] - depth) < Math.abs(depths[lo] - depth)) ? lo - 1 : lo;
    const v = values[idx];
    return isFinite(v) ? v : null;
  }

  const hoverReadings = $derived.by(() => {
    if (hoverDepth === null || !tpl) return [];
    return (tpl.curveDefinitions ?? [])
      .map(c => ({ mnem: c.curveMnemonic, color: c.color ?? '#374151', value: getCurveValueAtDepth(c, hoverDepth) }))
      .filter(c => c.value !== null);
  });

  function fmtNum(n) {
    if (!isFinite(n)) return '';
    if (Math.abs(n) >= 10000) return (n / 1000).toFixed(0) + 'k';
    if (Math.abs(n) >= 1000)  return (n / 1000).toFixed(1) + 'k';
    if (Math.abs(n) < 0.01 && n !== 0) return n.toExponential(1);
    return parseFloat(n.toPrecision(3)).toString();
  }

  // ── View mode ────────────────────────────────────────────────────────────
  let viewMode     = $state('chart'); // 'chart' | 'table' | 'text'
  let rawText      = $state('');

  // Keep rawText in sync with tpl in real time — read-only view, always current.
  $effect(() => {
    if (tpl) rawText = JSON.stringify(tpl, null, 2);
  });

  function enterTextMode() {
    viewMode = 'text';
  }
  let tableSortCol = $state('curveMnemonic');
  let tableSortAsc = $state(true);

  function sortBy(col) {
    if (tableSortCol === col) tableSortAsc = !tableSortAsc;
    else { tableSortCol = col; tableSortAsc = true; }
  }

  const sortedCurves = $derived.by(() => {
    if (!tpl) return [];
    const curves = [...(tpl.curveDefinitions ?? [])];
    curves.sort((a, b) => {
      let av, bv;
      if (tableSortCol === 'thickness') { av = a.line?.thickness ?? 0; bv = b.line?.thickness ?? 0; }
      else if (tableSortCol === 'style') { av = a.line?.style ?? ''; bv = b.line?.style ?? ''; }
      else if (tableSortCol === 'panel') {
        av = tpl.panels?.find(p => p.id === a.trackId)?.title ?? a.trackId ?? '';
        bv = tpl.panels?.find(p => p.id === b.trackId)?.title ?? b.trackId ?? '';
      }
      else { av = a[tableSortCol] ?? ''; bv = b[tableSortCol] ?? ''; }
      if (typeof av === 'number' && typeof bv === 'number')
        return tableSortAsc ? av - bv : bv - av;
      return tableSortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return curves;
  });

  function updateCurveField(curveId, field, value) {
    tpl = { ...tpl, curveDefinitions: tpl.curveDefinitions.map(c => {
      if (c.id !== curveId) return c;
      if (field === 'thickness') return { ...c, line: { ...c.line, thickness: parseFloat(value) || 1 } };
      if (field === 'style')     return { ...c, line: { ...c.line, style: value } };
      return { ...c, [field]: value };
    })};
  }

  // ── Inner tabs (Plot + sub-apps) ─────────────────────────────────────────
  let innerTabs      = $state([{ id: 'plot', label: 'Plot', appId: null }]);
  let activeInnerTab = $state('plot');
  let showSubappMenu = $state(false);

  function addSubapp(appId) {
    const def = SUBAPP_REGISTRY[appId];
    if (!def) return;
    const id = `${appId}_${Date.now()}`;
    innerTabs = [...innerTabs, { id, label: def.label, appId }];
    activeInnerTab = id;
    showSubappMenu = false;
  }

  function closeInnerTab(id) {
    innerTabs = innerTabs.filter(t => t.id !== id);
    if (activeInnerTab === id) activeInnerTab = 'plot';
  }

  // ── Build from files ─────────────────────────────────────────────────────
  let showBuildModal  = $state(false);
  let buildFiles      = $state([]);  // { item, curves[], loading, error }
  let buildFilter     = $state('');

  const buildPickerItems = $derived.by(() => {
    const q = buildFilter.trim().toLowerCase();
    if (!q) return workspaceFiles;
    return workspaceFiles.filter(f =>
      f.name.toLowerCase().includes(q) || f.path?.toLowerCase().includes(q)
    );
  });

  function isBuildSelected(item) {
    return buildFiles.some(f => f.item.path === item.path);
  }

  async function toggleBuildFile(item) {
    if (isBuildSelected(item)) {
      buildFiles = buildFiles.filter(f => f.item.path !== item.path);
      return;
    }
    const entry = { item, curves: [], loading: true, error: '' };
    buildFiles = [...buildFiles, entry];

    try {
      let buf;
      if (item.file) buf = await item.file.arrayBuffer();
      else if (item.id) {
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(item.id)}`);
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        buf = await res.arrayBuffer();
      }
      const isDlis = /\.dlis\d?$/i.test(item.name);
      let curves;
      if (isDlis) {
        const parsed = await parseDLISFile(buf);
        const lfs = extractLogicalFiles(parsed);
        curves = (lfs[0]?.channels ?? []).map(c => ({
          mnem: c.name, unit: c.units, desc: c.longName,
          slot: Object.keys(tpl.fileSlots ?? {})[0] ?? 'F1',
          panel: tpl.panels?.[0]?.id ?? 'P1',
          selected: true,
        }));
      } else {
        const text = new TextDecoder().decode(buf);
        const las = parseLAS(text);
        const summary = processCurves(las);
        curves = summary.curves.filter(c => !c.isIndex).map(c => ({
          mnem: c.name, unit: c.unit, desc: c.desc,
          slot: Object.keys(tpl.fileSlots ?? {})[0] ?? 'F1',
          panel: tpl.panels?.[0]?.id ?? 'P1',
          selected: true,
        }));
      }
      buildFiles = buildFiles.map(f =>
        f.item.path === item.path ? { ...f, curves, loading: false } : f
      );
    } catch (e) {
      buildFiles = buildFiles.map(f =>
        f.item.path === item.path ? { ...f, loading: false, error: e.message } : f
      );
    }
  }

  function applyBuild() {
    const newCurves = [];
    for (const bf of buildFiles) {
      for (const c of bf.curves) {
        if (!c.selected) continue;
        newCurves.push({
          id: `curve_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
          curveMnemonic: c.mnem,
          trackId: c.panel,
          fileSlot: c.slot,
          color: randomCurveColor(),
          line: { thickness: 1.2, style: 'solid' },
        });
      }
    }
    tpl = { ...tpl, curveDefinitions: [...(tpl.curveDefinitions ?? []), ...newCurves] };
    buildFiles = [];
    buildFilter = '';
    showBuildModal = false;
  }

  const CURVE_COLORS = ['#2563eb','#16a34a','#dc2626','#d97706','#7c3aed','#0891b2','#db2777'];
  let _colorIdx = 0;
  function randomCurveColor() { return CURVE_COLORS[_colorIdx++ % CURVE_COLORS.length]; }

  function addNewCurve() {
    const firstSlot  = Object.keys(tpl.fileSlots ?? {})[0] ?? 'F1';
    const firstPanel = tpl.panels?.[0]?.id ?? 'P1';
    const newCurve = {
      id: `curve_${Date.now()}`,
      curveMnemonic: 'NEW',
      trackId: firstPanel,
      fileSlot: firstSlot,
      color: '#374151',
      line: { thickness: 1.2, style: 'solid' },
      xMin: 0, xMax: 150, unit: '',
    };
    tpl = { ...tpl, curveDefinitions: [...(tpl.curveDefinitions ?? []), newCurve] };
    startEditCurve(newCurve);
  }

  // ── Template editing ─────────────────────────────────────────────────────
  function startEditPanel(panel) { editingPanel = { ...panel }; }
  function saveEditPanel() {
    tpl = { ...tpl, panels: tpl.panels.map(p => p.id === editingPanel.id ? { ...editingPanel } : p) };
    editingPanel = null;
  }

  function startEditCurve(curve) {
    const panel = (tpl.panels ?? []).find(p => p.id === curve.trackId);
    editingCurve = {
      ...curve,
      line:            { ...curve.line },
      scaleMin:        curve.xMin ?? panel?.xMin ?? 0,
      scaleMax:        curve.xMax ?? panel?.xMax ?? 150,
      scaleType:       panel?.gridType ?? 'linear',
      unit:            curve.unit ?? '',
      measurementType: curve.measurementType ?? '',
    };
  }

  function saveEditCurve() {
    const { scaleMin, scaleMax, scaleType, ...curveOnly } = editingCurve;
    tpl = {
      ...tpl,
      curveDefinitions: tpl.curveDefinitions.map(c =>
        c.id === editingCurve.id
          ? { ...curveOnly, xMin: parseFloat(scaleMin) || 0, xMax: parseFloat(scaleMax) || 150 }
          : c
      ),
      panels: (tpl.panels ?? []).map(p =>
        p.id === editingCurve.trackId ? { ...p, gridType: scaleType } : p
      ),
    };
    editingCurve = null;
  }

  /** When user picks a measurement type, auto-fill unit + scale defaults. */
  function applyMeasurementType(typeId) {
    const mt = getMeasurementType(typeId);
    if (!mt) return;
    editingCurve.unit      = mt.defaultUnit;
    editingCurve.scaleMin  = mt.defaultMin;
    editingCurve.scaleMax  = mt.defaultMax;
    editingCurve.scaleType = mt.scaleType;
  }
  function deleteCurve() {
    tpl = { ...tpl, curveDefinitions: tpl.curveDefinitions.filter(c => c.id !== editingCurve.id) };
    editingCurve = null;
  }

  async function saveTpl() {
    if (!tab.handle) {
      saveErr = 'Saving to disk is not available on this device. Use the Download button to save a copy.';
      return;
    }
    const json = JSON.stringify(tpl, null, 2);
    try {
      await saveToHandle(tab.handle, json);
      _loadedHash = JSON.stringify(tpl);
    } catch (e) {
      saveErr = e.message;
    }
  }

  function downloadTpl() {
    downloadBlob(tab.name, JSON.stringify(tpl, null, 2), 'application/json');
  }

  // Panel x offset (cumulative)
  function panelX(panels, idx) {
    return DEPTH_W + panels.slice(0, idx).reduce((s, p) => s + p.width, 0);
  }
</script>

<svelte:window onkeydown={(e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveTpl(); }
}} />

{#if saveErr}
  <div class="px-3 py-1 bg-red-50 border-b border-red-200 text-xs text-red-600 flex items-center gap-2">
    <span class="flex-1">{saveErr}</span>
    <button onclick={() => saveErr = ''} class="text-red-400 hover:text-red-600">✕</button>
  </div>
{/if}

{#if loading}
  <div class="flex items-center justify-center h-48 text-gray-400 text-sm">Loading template…</div>
{:else if error}
  <div class="p-6 flex flex-col items-start gap-3 text-sm">
    <p class="font-semibold text-red-600">Failed to load TPL</p>
    <p class="text-red-500 text-xs">{error}</p>
    <button onclick={loadSample}
      class="text-xs bg-white border border-gray-300 rounded px-3 py-1.5 text-gray-600 hover:bg-gray-50">
      Load bundled sample instead
    </button>
  </div>
{:else if !tpl}
  <!-- Shown when tab was opened with no file source (shouldn't normally happen) -->
  <div class="p-6 flex flex-col items-start gap-2 text-sm text-gray-500">
    <p>No template loaded.</p>
    <button onclick={loadSample}
      class="text-xs bg-white border border-gray-300 rounded px-3 py-1.5 text-gray-600 hover:bg-gray-50">
      Load bundled sample
    </button>
  </div>
{:else if tpl}
  <div class="flex h-full overflow-hidden bg-white">

    <!-- ── Left vertical toolbar ──────────────────────────────────────── -->
    <div class="tpl-toolbar">

      <!-- Save -->
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={dirty} onclick={saveTpl} aria-label="Save TPL">
          {#if dirty}<span class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400 pointer-events-none"></span>{/if}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <!-- floppy disk -->
            <rect x="2" y="2" width="12" height="12" rx="1.5"/>
            <rect x="5" y="2" width="6" height="4" rx="0.5" fill="currentColor" stroke="none"/>
            <rect x="4.5" y="9" width="7" height="5" rx="0.75"/>
          </svg>
        </button>
        <span class="tb-tip">{tab.handle ? 'Save to disk' : 'Save'}</span>
      </div>

      <!-- Download copy -->
      <div class="tb-item group">
        <button class="tb-btn" onclick={downloadTpl} aria-label="Download copy">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 14h10M8 2v8M5 7l3 4 3-4"/>
          </svg>
        </button>
        <span class="tb-tip">Download copy</span>
      </div>

      <div class="tb-sep"></div>

      <!-- Chart view -->
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={viewMode === 'chart'}
          onclick={() => viewMode = 'chart'} aria-label="Chart view">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1"/>
            <line x1="5" y1="2" x2="5" y2="14"/><line x1="9" y1="2" x2="9" y2="14"/>
            <line x1="13" y1="2" x2="13" y2="14"/>
          </svg>
        </button>
        <span class="tb-tip">Chart</span>
      </div>

      <!-- Table view -->
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={viewMode === 'table'}
          onclick={() => viewMode = 'table'} aria-label="Table view">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="12" height="12" rx="1"/>
            <line x1="2" y1="6" x2="14" y2="6"/><line x1="2" y1="10" x2="14" y2="10"/>
            <line x1="6" y1="2" x2="6" y2="14"/>
          </svg>
        </button>
        <span class="tb-tip">Curves Table</span>
      </div>

      <!-- Source / text view -->
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={viewMode === 'text'}
          onclick={enterTextMode} aria-label="Edit source">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="5,4 2,8 5,12"/><polyline points="11,4 14,8 11,12"/>
            <line x1="9" y1="3" x2="7" y2="13"/>
          </svg>
        </button>
        <span class="tb-tip">Edit Source</span>
      </div>

      <div class="tb-sep"></div>

      <!-- Add curve -->
      <div class="tb-item group">
        <button class="tb-btn" onclick={addNewCurve} aria-label="Add curve">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/>
          </svg>
        </button>
        <span class="tb-tip">Add Curve</span>
      </div>

      <!-- Build from files -->
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showBuildModal}
          onclick={() => showBuildModal = true} aria-label="Build from files">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="9" width="3" height="5" rx="0.5"/>
            <rect x="6.5" y="6" width="3" height="8" rx="0.5"/>
            <rect x="11" y="3" width="3" height="11" rx="0.5"/>
            <line x1="1" y1="14" x2="15" y2="14"/>
          </svg>
        </button>
        <span class="tb-tip">Build from files</span>
      </div>

    </div>

    <!-- ── Right: top bar + content ────────────────────────────────────── -->
    <div class="flex flex-col flex-1 overflow-hidden">

      <!-- Top bar: title + slot assignments -->
      <div class="flex items-center gap-3 px-3 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0 flex-wrap">
        <span class="text-sm font-semibold text-gray-700">{tpl.title ?? tab.name}</span>
        <span class="text-xs text-gray-400">{tpl.depth?.min ?? 0} – {tpl.depth?.max ?? '?'} {tpl.depth?.unit ?? ''}</span>

        <!-- Depth view inputs -->
        <div class="flex items-center gap-1 text-xs text-gray-500">
          <span>Top</span>
          <input type="number" step="1"
            value={dMin()}
            onchange={e => tpl = { ...tpl, depth: { ...tpl.depth, visibleMin: parseFloat(e.target.value) || 0 } }}
            class="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-700 text-right focus:outline-none focus:border-blue-400"/>
          <span>Bot</span>
          <input type="number" step="1"
            value={dMax()}
            onchange={e => tpl = { ...tpl, depth: { ...tpl.depth, visibleMax: parseFloat(e.target.value) || 5000 } }}
            class="w-20 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-700 text-right focus:outline-none focus:border-blue-400"/>
          <span class="text-gray-400">{tpl.depth?.unit ?? 'ft'}</span>
        </div>
        <!-- File slot assignments -->
        <div class="flex items-center gap-2 ml-2 flex-wrap">
          {#each Object.entries(tpl.fileSlots ?? {}) as [slotKey]}
            {@const slotInUse = (tpl.curveDefinitions ?? []).some(c => c.fileSlot === slotKey)}
            <div class="flex items-center gap-1">
              <span class="text-xs text-gray-500 font-mono">{slotKey}:</span>
              {#if slotFiles[slotKey]}
                {@const sf = slotFiles[slotKey]}
                {@const tipText = sf.lfId ? `${sf.name}\nLogical file: ${sf.lfId}` : sf.name}
                <span class="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5 max-w-[140px] truncate"
                  title={tipText}>
                  {sf.lfId ? `${sf.wellName} / ${sf.lfId}` : sf.wellName}
                </span>
                <button onclick={() => clearSlot(slotKey)}
                  class="text-xs text-gray-400 hover:text-red-500 leading-none" title="Clear file">✕</button>
              {:else}
                <button onclick={() => (pickingSlot = slotKey)}
                  class="text-xs bg-white border border-dashed border-gray-300 text-gray-500 rounded px-2 py-0.5 hover:border-blue-400 hover:text-blue-600">
                  Assign file…
                </button>
                {#if !slotInUse}
                  <button onclick={() => removeSlot(slotKey)}
                    class="text-xs text-gray-300 hover:text-red-500 leading-none" title="Remove slot">✕</button>
                {/if}
              {/if}
            </div>
          {/each}
          <!-- Add new slot -->
          <button onclick={addSlot}
            class="text-xs border border-dashed border-gray-300 text-gray-400 rounded px-2 py-0.5
                   hover:border-green-400 hover:text-green-600 font-medium transition-colors"
            title="Add file slot">+ slot</button>
        </div>
      </div>

    <!-- ── Inner tab bar ────────────────────────────────────────────────── -->
    <div class="flex items-center border-b border-gray-200 bg-gray-50 flex-shrink-0 overflow-x-auto">
      {#each innerTabs as it (it.id)}
        <button
          onclick={() => activeInnerTab = it.id}
          class="flex items-center gap-1 px-3 py-1 text-xs font-medium border-r border-gray-200 flex-shrink-0 whitespace-nowrap
                 {activeInnerTab === it.id
                   ? 'bg-white text-blue-700 border-b-2 border-b-blue-500 -mb-px'
                   : 'text-gray-500 hover:bg-gray-100'}"
        >
          {it.label}
          {#if it.appId}
            <span onclick={(e) => { e.stopPropagation(); closeInnerTab(it.id); }}
              class="ml-0.5 text-gray-400 hover:text-red-500 leading-none">✕</span>
          {/if}
        </button>
      {/each}

      <!-- Add sub-app button -->
      <button
        onclick={() => showSubappMenu = true}
        class="flex items-center justify-center w-6 h-6 ml-1 rounded-full border-2 border-gray-300 text-gray-500
               hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50 text-base leading-none font-bold flex-shrink-0 transition-colors"
        title="Add workflow">+</button>
    </div>

    <!-- ── Main content area ───────────────────────────────────────────── -->
    <div class="flex-1 overflow-auto" style="display:{activeInnerTab === 'plot' ? 'block' : 'none'}">

    {#if viewMode === 'table'}
      <!-- ── Curves Table ────────────────────────────────────────────── -->
      <div class="p-3">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="bg-gray-100 text-gray-600 select-none">
              {#each [
                ['curveMnemonic','Mnemonic'],
                ['color','Color'],
                ['fileSlot','Slot'],
                ['panel','Panel'],
                ['thickness','Thick.'],
                ['style','Style'],
              ] as [col, label]}
                <th
                  onclick={() => sortBy(col)}
                  class="text-left px-2 py-1.5 font-medium cursor-pointer whitespace-nowrap
                         hover:bg-gray-200 border border-gray-200
                         {tableSortCol === col ? 'bg-blue-50 text-blue-700' : ''}"
                >
                  {label}
                  {#if tableSortCol === col}
                    <span class="ml-0.5">{tableSortAsc ? '▲' : '▼'}</span>
                  {/if}
                </th>
              {/each}
              <th class="px-2 py-1.5 border border-gray-200 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {#each sortedCurves as c, i}
              <tr class="{i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50/40 group">

                <!-- Mnemonic -->
                <td class="border border-gray-200 px-1 py-0.5">
                  <input
                    value={c.curveMnemonic}
                    onchange={(e) => updateCurveField(c.id, 'curveMnemonic', e.currentTarget.value.toUpperCase())}
                    class="w-full bg-transparent font-mono font-medium uppercase px-1 focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded"
                  />
                </td>

                <!-- Color -->
                <td class="border border-gray-200 px-1 py-0.5 w-16">
                  <div class="flex items-center gap-1">
                    <input type="color" value={c.color ?? '#374151'}
                      onchange={(e) => updateCurveField(c.id, 'color', e.currentTarget.value)}
                      class="w-5 h-5 rounded cursor-pointer border-0 p-0"/>
                    <span class="font-mono text-[0.6rem] text-gray-400">{c.color ?? ''}</span>
                  </div>
                </td>

                <!-- File Slot -->
                <td class="border border-gray-200 px-1 py-0.5">
                  <select
                    value={c.fileSlot}
                    onchange={(e) => updateCurveField(c.id, 'fileSlot', e.currentTarget.value)}
                    class="w-full bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded"
                  >
                    {#each Object.keys(tpl.fileSlots ?? {}) as slotKey}
                      <option value={slotKey}>{slotKey}</option>
                    {/each}
                  </select>
                </td>

                <!-- Panel -->
                <td class="border border-gray-200 px-1 py-0.5">
                  <select
                    value={c.trackId}
                    onchange={(e) => updateCurveField(c.id, 'trackId', e.currentTarget.value)}
                    class="w-full bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded"
                  >
                    {#each tpl.panels ?? [] as p}
                      <option value={p.id}>{p.title ?? p.id}</option>
                    {/each}
                  </select>
                </td>

                <!-- Thickness -->
                <td class="border border-gray-200 px-1 py-0.5 w-16">
                  <input type="number" step="0.1" min="0.5" max="5"
                    value={c.line?.thickness ?? 1.2}
                    onchange={(e) => updateCurveField(c.id, 'thickness', e.currentTarget.value)}
                    class="w-full bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1"
                  />
                </td>

                <!-- Style -->
                <td class="border border-gray-200 px-1 py-0.5 w-20">
                  <select
                    value={c.line?.style ?? 'solid'}
                    onchange={(e) => updateCurveField(c.id, 'style', e.currentTarget.value)}
                    class="w-full bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded"
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                </td>

                <!-- Delete -->
                <td class="border border-gray-200 px-1 py-0.5 text-center">
                  <button
                    onclick={() => { tpl = { ...tpl, curveDefinitions: tpl.curveDefinitions.filter(x => x.id !== c.id) }; }}
                    class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity leading-none"
                    title="Remove curve"
                  >✕</button>
                </td>
              </tr>
            {/each}

            <!-- Add row -->
            <tr>
              <td colspan="7" class="border border-gray-200 px-2 py-1">
                <button onclick={addNewCurve}
                  class="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  + Add curve
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    {:else if viewMode === 'text'}
      <!-- ── Source / text editor ───────────────────────────────────── -->
      <div class="flex flex-col h-full p-2 gap-2">
        <!-- Status bar -->
        <div class="flex items-center gap-2 flex-shrink-0 text-[10px]">
          <span class="text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">● live</span>
          {#if dirty}
            <span class="text-orange-500 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5 font-medium">● unsaved changes</span>
          {/if}
        </div>
        <textarea
          value={rawText}
          readonly
          spellcheck="false"
          class="flex-1 w-full font-mono text-xs rounded p-2 resize-none focus:outline-none border border-gray-200 bg-gray-50 text-gray-700"
        ></textarea>
        <div class="flex gap-2 justify-end flex-shrink-0 flex-wrap">
          <button onclick={() => viewMode = 'chart'}
            class="text-xs border border-gray-200 rounded px-3 py-1.5 hover:bg-gray-50">
            Close
          </button>
        </div>
      </div>

    {:else}
      <!-- chart view -->
      <div style="position:relative;display:inline-block">
      <svg
        width={totalSvgW}
        height={TOTAL_H}
        style="display:block;min-width:{totalSvgW}px;font-family:sans-serif"
        onmousemove={onSvgMouseMove}
        onmouseleave={() => hoverDepth = null}
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
        {#if !headerCollapsed}
          {@const depthLabelY = (HEADER_H - TOGGLE_H) / 2 + 3}
          <text x={DEPTH_W / 2} y={depthLabelY} text-anchor="middle" font-size="9" fill="#374151" font-weight="bold">
            {tpl.indexCurve?.curveMnemonic ?? 'DEPTH'}
          </text>
          <text x={DEPTH_W / 2} y={depthLabelY + 10} text-anchor="middle" font-size="8" fill="#9ca3af">
            {tpl.depth?.unit ?? ''}
          </text>
        {/if}
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

          <!-- Panel header: one row per curve, stacked (excludes toggle bar) -->
          {@const curveAreaH = HEADER_H - TOGGLE_H}
          <rect x={px} y="0" width={panel.width} height={curveAreaH} fill="#f8fafc"/>
          <rect x={px} y="0" width={panel.width} height={curveAreaH}
            fill="none" stroke="#d1d5db" stroke-width="0.8"/>

          {#if !headerCollapsed}
            {#if curves.length === 0}
              <text x={px + panel.width / 2} y={curveAreaH / 2 + 4} text-anchor="middle"
                font-size="9" fill="#9ca3af" style="cursor:pointer"
                onclick={() => startEditPanel(panel)}>{panel.title}</text>
            {:else}
              {@const rowH = curveAreaH / curves.length}
              {#each curves as curveDef, ci}
                {@const ry = ci * rowH}
                {@const cMin = curveDef.xMin ?? panel.xMin}
                {@const cMax = curveDef.xMax ?? panel.xMax}
                {@const cUnit = curveDef.unit ?? ''}
                <!-- Layout: numbers in top ~38%, line at ~55%, label in bottom ~20% -->
                {@const numY  = ry + Math.round(rowH * 0.38)}
                {@const lineY = ry + Math.round(rowH * 0.56)}
                {@const lblY  = ry + Math.round(rowH * 0.82)}

                <!-- Scale numbers: min left, max right — above the colored line -->
                <text x={px + 3} y={numY} font-size="7.5" fill="#6b7280">{fmtNum(cMin)}</text>
                <text x={px + panel.width - 3} y={numY} text-anchor="end" font-size="7.5" fill="#6b7280">{fmtNum(cMax)}</text>

                <!-- Colored curve line — between numbers and label -->
                <line x1={px} y1={lineY} x2={px + panel.width} y2={lineY}
                  stroke={curveDef.color ?? '#374151'} stroke-width="1.5"/>

                <!-- Curve name (unit) centered below line — clickable to edit -->
                <text x={px + panel.width / 2} y={lblY}
                  text-anchor="middle" font-size="8" fill="#374151"
                  style="cursor:pointer"
                  onclick={() => startEditCurve(curveDef)}>
                  {curveDef.curveMnemonic}{cUnit ? ` (${cUnit})` : ''}
                </text>

                <!-- Row divider between curves -->
                {#if ci < curves.length - 1}
                  <line x1={px} y1={ry + rowH} x2={px + panel.width} y2={ry + rowH}
                    stroke="#d1d5db" stroke-width="0.5"/>
                {/if}
              {/each}
            {/if}
          {/if}

          <!-- X-axis labels (below chart) -->
          {#each xl as lbl}
            <text
              x={px + lbl.px} y={HEADER_H + CHART_H + 14}
              text-anchor="middle" font-size="8" fill="#6b7280"
            >{lbl.label}</text>
          {/each}

        {/each}

        <!-- ── Header collapse toggle bar (full width) ──────────────── -->
        <rect x="0" y={HEADER_H - TOGGLE_H} width={totalSvgW} height={TOGGLE_H}
          fill="#e2e8f0" style="cursor:pointer"
          onclick={() => headerCollapsed = !headerCollapsed}/>
        <text x={totalSvgW / 2} y={HEADER_H - 2}
          text-anchor="middle" font-size="7" fill="#94a3b8" style="pointer-events:none">
          {headerCollapsed ? '▼ expand scale' : '▲ collapse scale'}
        </text>

        <!-- Hover crosshair -->
        {#if hoverDepth !== null}
          {@const cy = sy(hoverDepth)}
          <line x1={DEPTH_W} x2={totalSvgW} y1={cy} y2={cy}
            stroke="#374151" stroke-width="0.75" stroke-dasharray="4,3" pointer-events="none"/>
          <text x={DEPTH_W - 2} y={cy - 2} text-anchor="end" font-size="8" fill="#374151" font-weight="bold"
            pointer-events="none">{hoverDepth.toFixed(1)}</text>
        {/if}

      </svg>

      <!-- Hover tooltip -->
      {#if hoverDepth !== null && hoverReadings.length > 0}
        <div style="position:absolute;left:{hoverClientX + 14}px;top:{Math.max(4, hoverClientY - 8)}px;pointer-events:none;z-index:30"
          class="bg-white border border-gray-200 rounded shadow-lg px-2 py-1.5 text-xs min-w-[120px]">
          <div class="text-gray-500 font-mono text-[0.65rem] mb-1 border-b border-gray-100 pb-0.5">
            {hoverDepth.toFixed(1)} {tpl.depth?.unit ?? 'ft'}
          </div>
          {#each hoverReadings as r}
            <div class="flex items-center gap-1.5 py-0.5">
              <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background:{r.color}"></span>
              <span class="text-gray-600 flex-1">{r.mnem}</span>
              <span class="font-mono text-gray-800 ml-2">{r.value.toPrecision(4)}</span>
            </div>
          {/each}
        </div>
      {/if}

      </div><!-- end svg wrapper -->

    {/if}<!-- end chart/table toggle -->
    </div><!-- end main content -->

    <!-- ── Sub-app panels ───────────────────────────────────────────────── -->
    {#each innerTabs.filter(t => t.appId) as it (it.id)}
      {@const SubApp = SUBAPP_REGISTRY[it.appId]?.component}
      <div class="flex-1 overflow-hidden" style="display:{activeInnerTab === it.id ? 'flex' : 'none'}">
        {#if SubApp}
          <SubApp {tpl} {slotFiles} />
        {/if}
      </div>
    {/each}

    </div><!-- end right column -->

  </div><!-- end outer flex -->

  <!-- ── Add Sub-App dialog ───────────────────────────────────────────── -->
  <FloatingPanel
    title="Add Workflow"
    visible={showSubappMenu}
    onClose={() => showSubappMenu = false}
    width={480}
    x={120} y={120}>
    {#snippet children()}
      <div class="p-4">
        <p class="text-xs text-gray-500 mb-4">Select a workflow to add as a tab in this template.</p>
        <div class="grid grid-cols-2 gap-3">
          {#each Object.values(SUBAPP_REGISTRY) as def}
            <button
              onclick={() => addSubapp(def.id)}
              class="flex flex-col gap-1 text-left p-3 border-2 border-gray-200 rounded-lg
                     hover:border-blue-400 hover:bg-blue-50 transition-colors group">
              <span class="text-2xl mb-1">⚗️</span>
              <span class="text-sm font-semibold text-gray-800 group-hover:text-blue-700">{def.label}</span>
              <span class="text-xs text-gray-400 leading-snug">{def.description}</span>
            </button>
          {/each}
        </div>
      </div>
    {/snippet}
  </FloatingPanel>

  <!-- ── Slot Picker FloatingPanel ────────────────────────────────────── -->
  <FloatingPanel
    title="Assign file to {pickingSlot}"
    visible={pickingSlot !== null}
    onClose={closePicker}
    width={340}
    x={8}
    y={60}
  >
    {#snippet children()}
      <div class="flex flex-col" style="height:336px">

        <!-- Search bar -->
        <div class="px-3 pt-2 pb-1.5 border-b border-gray-100 flex-shrink-0">
          <input
            type="text"
            bind:value={slotFilter}
            placeholder="Filter files…"
            class="w-full text-xs border border-gray-200 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-400"
          />
        </div>

        <!-- Two-column body -->
        <div class="flex flex-1 overflow-hidden">

          <!-- Left: folder tree / search results -->
          <div class="relative flex-shrink-0 border-r border-gray-100 overflow-y-auto" style="width:{pickerPanelW}px">
            <!-- Drag handle -->
            <div onpointerdown={onPickerPanelDragStart}
              class="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 hover:bg-blue-400 active:bg-blue-500 transition-colors">
            </div>
            {#if datasourceStore.loading || datasourceStore.deepFetching}
              <p class="text-xs text-gray-400 p-3 text-center">
                {datasourceStore.deepFetching ? 'Loading all files…' : 'Loading…'}
              </p>
            {:else if !datasourceStore.tree}
              <p class="text-xs text-gray-400 p-3 leading-snug">
                No workspace open.<br>
                Open a local folder or connect to remote via the sidebar.
              </p>
            {:else if pickerItems.length === 0}
              <p class="text-xs text-gray-400 p-3">
                {slotFilter ? 'No matches.' : 'No compatible files found.'}
              </p>
            {:else}
              {#each pickerItems as item}
                {#if item.type === 'dir'}
                  <button
                    onclick={() => togglePickerFolder(item.path)}
                    class="w-full text-left flex items-center gap-1 py-0.5 pr-2 hover:bg-gray-50 select-none"
                    style="padding-left:{0.35 + item.depth * 0.65}rem"
                  >
                    <span class="w-2.5 flex-shrink-0 text-gray-400 text-center" style="font-size:0.5rem">
                      {(slotFilter || pickerExpanded.has(item.path)) ? '▼' : '▶'}
                    </span>
                    {#if slotFilter || pickerExpanded.has(item.path)}
                      <FolderOpenSolid class="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
                    {:else}
                      <FolderSolid class="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                    {/if}
                    <span class="text-xs text-gray-700 truncate ml-0.5">{item.name}</span>
                  </button>
                {:else}
                  <button
                    onclick={() => previewFile(item)}
                    class="w-full text-left flex items-center gap-1 py-0.5 pr-2 transition-colors
                           {previewItem?.path === item.path
                             ? 'bg-blue-600 text-white'
                             : 'hover:bg-gray-100 text-gray-600'}"
                    style="padding-left:{0.35 + item.depth * 0.65}rem"
                    title={item.path ?? item.name}
                  >
                    <span class="w-2.5 flex-shrink-0"></span>
                    <FileLinesOutline class="w-3.5 h-3.5 flex-shrink-0
                      {previewItem?.path === item.path ? 'text-blue-200' : 'text-gray-400'}" />
                    <span class="text-xs truncate ml-0.5">{item.name}</span>
                  </button>
                {/if}
              {/each}
            {/if}
          </div>

          <!-- Right: preview -->
          <div class="flex-1 overflow-y-auto p-3">
            {#if !previewItem}
              <p class="text-xs text-gray-400 mt-8 text-center">Select a file to preview</p>

            {:else if previewLoading}
              <p class="text-xs text-gray-400 mt-8 text-center">Loading…</p>

            {:else if previewData?.error}
              <p class="text-xs text-red-500 p-2">{previewData.error}</p>

            {:else if previewData}
              <!-- Well info -->
              <div class="mb-2.5">
                <div class="text-xs font-semibold text-gray-800 truncate" title={previewData.wellName}>
                  {previewData.wellName}
                </div>
                <div class="text-[0.65rem] text-gray-400 mt-0.5">
                  {#if previewData.dMin != null && previewData.dMax != null && isFinite(previewData.dMin) && isFinite(previewData.dMax)}
                    Depth: {previewData.dMin.toFixed(1)} – {previewData.dMax.toFixed(1)}{previewData.unit ? ' ' + previewData.unit : ''}
                  {:else}
                    Depth range unknown
                  {/if}
                  &nbsp;·&nbsp;{previewData.curves.length} curve{previewData.curves.length !== 1 ? 's' : ''}
                  &nbsp;·&nbsp;<span class="uppercase">{previewData.type}</span>
                </div>
              </div>

              <!-- DLIS logical file selector -->
              {#if previewData.type === 'dlis' && previewData.logicalFiles?.length > 1}
                <div class="mb-2.5">
                  <div class="text-[0.65rem] font-semibold text-gray-500 mb-1">
                    Select logical file ({previewData.logicalFiles.length} found):
                  </div>
                  <div class="flex flex-col gap-0.5">
                    {#each previewData.logicalFiles as lf}
                      <button
                        onclick={() => selectLogicalFile(lf)}
                        class="flex items-center gap-2 text-left text-xs px-2 py-1 rounded border transition-colors
                               {previewData.selectedLf === lf
                                 ? 'bg-blue-50 border-blue-300 text-blue-800'
                                 : 'bg-white border-gray-200 text-gray-600 hover:border-blue-200 hover:bg-blue-50/50'}"
                      >
                        <span class="font-mono font-medium w-16 truncate">{lf.id}</span>
                        <span class="text-gray-400">{lf.channels.length} ch</span>
                        {#if lf.frames[0]?.indexMin != null && lf.frames[0]?.indexMax != null}
                          <span class="text-gray-400 text-[0.6rem]">
                            {parseFloat(lf.frames[0].indexMin).toFixed(0)}–{parseFloat(lf.frames[0].indexMax).toFixed(0)}
                          </span>
                        {/if}
                        {#if lf.channels.length > 0}
                          <span class="text-[0.6rem] text-gray-400 truncate max-w-[100px]">
                            {lf.channels.slice(0,4).map(c => c.name).join(', ')}{lf.channels.length > 4 ? '…' : ''}
                          </span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Curves table only shown once an LF is selected (or for LAS) -->
              {#if previewData.type === 'las' || previewData.selectedLf}

              <!-- Expected mnemonics legend -->
              {#if slotExpectedMnemonics.size > 0}
                <div class="text-[0.6rem] text-gray-400 mb-1.5">
                  TPL expects:
                  {#each [...slotExpectedMnemonics] as m}
                    <span class="inline-block bg-amber-50 text-amber-700 border border-amber-200 rounded px-1 mr-0.5">{m}</span>
                  {/each}
                </div>
              {/if}

              <!-- Curves table -->
              <div class="border border-gray-100 rounded overflow-hidden">
                <table class="w-full text-[0.65rem]">
                  <thead>
                    <tr class="bg-gray-50 text-gray-500">
                      <th class="text-left px-2 py-1 font-medium w-4"></th>
                      <th class="text-left px-2 py-1 font-medium">Mnemonic</th>
                      <th class="text-left px-2 py-1 font-medium">Unit</th>
                      <th class="text-left px-2 py-1 font-medium max-w-[120px]">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each previewData.curves as c, i}
                      {@const matched = slotExpectedMnemonics.has(c.mnem?.toUpperCase())}
                      <tr class="{matched ? 'bg-green-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}">
                        <td class="px-2 py-0.5 text-center">
                          {#if matched}<span class="text-green-600 font-bold">✓</span>{/if}
                        </td>
                        <td class="px-2 py-0.5 font-mono font-medium {matched ? 'text-green-700' : 'text-gray-700'}">{c.mnem}</td>
                        <td class="px-2 py-0.5 text-gray-400">{c.unit || '—'}</td>
                        <td class="px-2 py-0.5 text-gray-500 truncate max-w-[120px]" title={c.desc}>{c.desc || '—'}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              {#if previewData.type === 'dlis'}
                <p class="text-[0.6rem] text-amber-600 mt-2">
                  DLIS files can be previewed but curve plotting requires LAS format.
                </p>
              {/if}

              {/if}<!-- end LF/LAS guard -->

            {/if}<!-- end if/else chain (previewItem/loading/error/data) -->
          </div>
        </div>

        <!-- Footer actions -->
        <div class="flex items-center justify-end gap-2 px-3 py-2 border-t border-gray-100 flex-shrink-0 bg-gray-50">
          <button onclick={closePicker}
            class="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">
            Cancel
          </button>
          <button
            onclick={assignPreview}
            disabled={!previewData || !!previewData.error || (previewData.type === 'dlis' && !previewData.selectedLf)}
            class="text-xs bg-blue-600 text-white rounded px-3 py-1.5 font-medium
                   hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
            Assign to {pickingSlot}
          </button>
        </div>

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
    width={260}
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
          <!-- Panel + File Slot in one row -->
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">Panel</label>
              <select bind:value={editingCurve.trackId}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1">
                {#each tpl.panels ?? [] as p}
                  <option value={p.id}>{p.title ?? p.id}</option>
                {/each}
              </select>
            </div>
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">File Slot</label>
              <select bind:value={editingCurve.fileSlot}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1">
                {#each Object.keys(tpl.fileSlots ?? {}) as slotKey}
                  <option value={slotKey}>{slotKey}</option>
                {/each}
              </select>
            </div>
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
          <!-- Measurement type + scale -->
          <div class="border-t border-gray-100 pt-2 mt-1">
            <p class="text-[0.6rem] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Measurement</p>

            <!-- Measurement type selector -->
            <div class="mb-2">
              <label class="block text-xs text-gray-500 mb-0.5">Type</label>
              <select
                value={editingCurve.measurementType ?? ''}
                onchange={(e) => {
                  editingCurve.measurementType = e.currentTarget.value;
                  applyMeasurementType(e.currentTarget.value);
                }}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
              >
                <option value="">— select —</option>
                {#each MEASUREMENT_TYPES as mt}
                  <option value={mt.id}>{mt.name}</option>
                {/each}
              </select>
            </div>

            <!-- Unit: constrained dropdown if type selected, free text if Custom/none -->
            <div class="mb-2">
              <label class="block text-xs text-gray-500 mb-0.5">Unit</label>
              {#if getMeasurementType(editingCurve.measurementType)?.units?.length}
                {@const mt = getMeasurementType(editingCurve.measurementType)}
                <select bind:value={editingCurve.unit}
                  class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400">
                  {#each mt.units as u}
                    <option value={u}>{u}</option>
                  {/each}
                </select>
              {:else}
                <input type="text" bind:value={editingCurve.unit}
                  class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  placeholder="e.g. API, ohm·m, g/cc"/>
              {/if}
            </div>

            <!-- Min / Max -->
            <div class="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label class="block text-xs text-gray-500 mb-0.5">Min</label>
                <input type="number" bind:value={editingCurve.scaleMin}
                  class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"/>
              </div>
              <div>
                <label class="block text-xs text-gray-500 mb-0.5">Max</label>
                <input type="number" bind:value={editingCurve.scaleMax}
                  class="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"/>
              </div>
            </div>

            <!-- Scale type -->
            <div>
              <label class="block text-xs text-gray-500 mb-0.5">Scale</label>
              <select bind:value={editingCurve.scaleType}
                class="w-full text-xs border border-gray-200 rounded px-2 py-1">
                <option value="linear">Linear</option>
                <option value="logarithmic">Logarithmic</option>
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

  <!-- ── Build from Files FloatingPanel ───────────────────────────────── -->
  <FloatingPanel
    title="Build Template from Files"
    bind:open={showBuildModal}
    width={600}
    height={480}>
    {#snippet body()}
      <div class="flex flex-col h-full gap-2 p-2">
        <!-- search bar -->
        <input type="search" placeholder="Filter files…" bind:value={buildFilter}
          class="w-full text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:border-blue-400"/>

        <div class="flex gap-2 flex-1 min-h-0">
          <!-- left: file list -->
          <div class="flex flex-col w-52 flex-shrink-0 border border-gray-200 rounded overflow-y-auto bg-gray-50">
            <div class="text-xs font-semibold text-gray-500 px-2 py-1 border-b border-gray-200 bg-white sticky top-0">
              Workspace Files
            </div>
            {#each buildPickerItems as item}
              {@const selected = isBuildSelected(item)}
              <button
                onclick={() => toggleBuildFile(item)}
                class="flex items-center gap-1.5 px-2 py-1 text-xs text-left hover:bg-blue-50 transition-colors"
                class:bg-blue-100={selected}
                class:text-blue-800={selected}>
                <span class="flex-shrink-0">
                  {#if selected}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="#2563eb"><rect x="1" y="1" width="10" height="10" rx="2"/><path d="M3 6l2 2 4-4" stroke="white" stroke-width="1.5" fill="none"/></svg>
                  {:else}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#9ca3af" stroke-width="1.2"><rect x="1" y="1" width="10" height="10" rx="2"/></svg>
                  {/if}
                </span>
                <span class="truncate">{item.name}</span>
              </button>
            {:else}
              <p class="text-xs text-gray-400 px-2 py-3 text-center">No files in workspace</p>
            {/each}
          </div>

          <!-- right: curves per selected file -->
          <div class="flex-1 overflow-y-auto border border-gray-200 rounded bg-white">
            {#if buildFiles.length === 0}
              <p class="text-xs text-gray-400 text-center mt-8">Select files on the left to see their curves</p>
            {:else}
              {#each buildFiles as bf}
                <div class="border-b border-gray-100 last:border-0">
                  <!-- file header -->
                  <div class="flex items-center gap-1 px-2 py-1 bg-gray-50 sticky top-0 border-b border-gray-100">
                    <span class="text-xs font-semibold text-gray-700 truncate flex-1">{bf.item.name}</span>
                    {#if bf.loading}
                      <svg class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.5"><circle cx="12" cy="12" r="9" stroke-opacity="0.3"/><path d="M12 3a9 9 0 0 1 9 9"/></svg>
                    {/if}
                    {#if bf.error}
                      <span class="text-xs text-red-500 ml-1">{bf.error}</span>
                    {/if}
                  </div>

                  {#if !bf.loading && !bf.error}
                    <!-- column headers -->
                    <div class="grid text-xs font-semibold text-gray-500 px-2 py-0.5 bg-white border-b border-gray-100"
                      style="grid-template-columns: 1.2rem 1fr 5rem 5rem;">
                      <span></span>
                      <span>Mnemonic</span>
                      <span>Slot</span>
                      <span>Panel</span>
                    </div>
                    {#each bf.curves as c}
                      <div class="grid items-center px-2 py-0.5 hover:bg-gray-50 text-xs"
                        style="grid-template-columns: 1.2rem 1fr 5rem 5rem;">
                        <input type="checkbox" bind:checked={c.selected} class="cursor-pointer"/>
                        <span class="truncate" class:text-gray-400={!c.selected}>{c.mnemonic}</span>
                        <select bind:value={c.fileSlot} disabled={!c.selected}
                          class="text-xs border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40">
                          {#each Object.keys(tpl.fileSlots ?? {}) as slotKey}
                            <option value={slotKey}>{slotKey}</option>
                          {/each}
                        </select>
                        <select bind:value={c.trackId} disabled={!c.selected}
                          class="text-xs border border-gray-200 rounded px-1 py-0.5 disabled:opacity-40">
                          {#each tpl.panels ?? [] as p}
                            <option value={p.id}>{p.title ?? p.id}</option>
                          {/each}
                        </select>
                      </div>
                    {:else}
                      <p class="text-xs text-gray-400 px-2 py-1">No curves found</p>
                    {/each}
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- footer -->
        <div class="flex justify-end gap-2 pt-1 border-t border-gray-100">
          <button onclick={() => { showBuildModal = false; buildFiles = []; buildFilter = ''; }}
            class="text-xs border border-gray-200 rounded px-3 py-1.5 hover:bg-gray-50">
            Cancel
          </button>
          <button onclick={applyBuild}
            disabled={buildFiles.every(bf => bf.curves.every(c => !c.selected))}
            class="text-xs bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700 font-medium disabled:opacity-40">
            Add Selected Curves
          </button>
        </div>
      </div>
    {/snippet}
  </FloatingPanel>

{/if}

<style>
  .tpl-toolbar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 4px 2px;
    background: #ffffff;
    border-right: 1px solid #e2e8f0;
    width: 30px;
    flex-shrink: 0;
  }
  .tb-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .tb-btn {
    background: none;
    border: none;
    color: #64748b;
    width: 26px;
    height: 26px;
    border-radius: 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tb-btn:hover { background: #f1f5f9; color: #1e293b; }
  :global(.tb-btn.tb-active) { background: #dbeafe; color: #2563eb; }
  .tb-sep {
    width: 18px;
    height: 1px;
    background: #e2e8f0;
    margin: 2px 0;
  }
  .tb-tip {
    display: none;
    position: absolute;
    left: 32px;
    top: 50%;
    transform: translateY(-50%);
    background: #1e293b;
    color: #fff;
    font-size: 11px;
    padding: 3px 7px;
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 999;
  }
  .tb-item:hover .tb-tip { display: block; }
</style>
