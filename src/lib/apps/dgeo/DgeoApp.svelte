<script lang="ts">
  import { onMount } from 'svelte';
  import { tabStore } from '$lib/tabs/tabs.svelte.js';
  import { saveToHandle, downloadBlob } from '$lib/apps/shared/fileActions.js';
  import Dgeo3DView from './Dgeo3DView.svelte';
  import { FloatingPanel } from '$lib/components/FloatingPanel';
  import { HorizonState } from './state/HorizonState.svelte.ts';
  import type { HorizonOperator, Point2D, Rail } from './types.ts';
  import { parseXYZ, xyzToRails } from './xyzImport.ts';
  import type { ParsedXYZ } from './xyzImport.ts';

  const { tab } = $props();

  // ── View mode ──────────────────────────────────────────────────────────────
  let viewMode      = $state<'2d' | '3d'>('3d');
  let showSolids    = $state(true);
  let showHzPanel   = $state(false);

  // ── Colour palette ─────────────────────────────────────────────────────────
  const FORMATION_COLOURS = [
    '#c8e6c9','#fff9c4','#ffe0b2','#f8bbd0','#e1bee7',
    '#b3e5fc','#dcedc8','#fff8e1','#fce4ec','#e8eaf6',
    '#f3e5f5','#e0f2f1','#fbe9e7','#ede7f6','#e8f5e9',
  ];

  // ── State ─────────────────────────────────────────────────────────────────
  /** Reactive array of HorizonState instances — mutations on instances drive re-renders */
  let horizons: HorizonState[] = $state([]);
  let dirty            = $state(false);
  let loadErr          = $state('');
  let saveErr          = $state('');
  let strikeKm         = $state(5);
  let defaultRailCount = $state(10);

  $effect(() => { tabStore.setDirty(tab.id, dirty); });

  let tool      = $state<'select' | 'add-point' | 'delete'>('select');
  let activeId  = $state<string | null>(null);
  let dragState = $state<{ horizonId: string; pointIdx: number } | null>(null);

  // ── Viewport ───────────────────────────────────────────────────────────────
  const W = 900, H = 600, PAD = 60;
  const CHART_W = $derived(W - PAD);
  const CHART_H = $derived(H - PAD);

  let domX = $state({ min: 0, max: 10 });
  let domY = $state({ min: 0, max: 5000 });

  function toSvgX(v: number)  { return PAD + ((v - domX.min) / (domX.max - domX.min)) * CHART_W; }
  function toSvgY(v: number)  { return PAD/2 + ((v - domY.min) / (domY.max - domY.min)) * CHART_H; }
  function fromSvgX(px: number) { return domX.min + ((px - PAD) / CHART_W) * (domX.max - domX.min); }
  function fromSvgY(py: number) { return domY.min + ((py - PAD/2) / CHART_H) * (domY.max - domY.min); }

  // Sort by 2D points only (for SVG display order)
  const sortedHorizons = $derived(
    [...horizons].sort((a, b) => avg2DDepth(a) - avg2DDepth(b))
  );

  function avg2DDepth(h: HorizonState): number {
    if (!h.points.length) return 0;
    return h.points.reduce((s, p) => s + p.y, 0) / h.points.length;
  }

  function polyStr(h: HorizonState): string {
    if (!h.points.length) return '';
    return h.points.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).join(' ');
  }

  function bandPath(upper: HorizonState, lower: HorizonState): string {
    const uPts = upper.points, lPts = lower.points;
    if (!uPts.length || !lPts.length) return '';
    const xMin = PAD, xMax = PAD + CHART_W;
    const top = [
      `${xMin},${toSvgY(uPts[0].y).toFixed(1)}`,
      ...uPts.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`),
      `${xMax},${toSvgY(uPts[uPts.length - 1].y).toFixed(1)}`,
    ];
    const bot = [
      `${xMax},${toSvgY(lPts[lPts.length - 1].y).toFixed(1)}`,
      ...[...lPts].reverse().map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`),
      `${xMin},${toSvgY(lPts[0].y).toFixed(1)}`,
    ];
    return [...top, ...bot].join(' ');
  }

  // ── File I/O ──────────────────────────────────────────────────────────────
  async function loadFile() {
    try {
      if (!tab.file) { loadErr = 'No file attached to tab.'; return; }
      const text = await tab.file.text();
      if (!text.trim()) { initDefault(); return; }
      const data = JSON.parse(text);
      horizons = (data.horizons ?? []).map((h: any) =>
        HorizonState.fromJSON({
          id:       h.id       ?? crypto.randomUUID(),
          name:     h.name     ?? 'Horizon',
          colour:   h.colour   ?? FORMATION_COLOURS[0],
          operator: h.operator ?? 'none',
          visible:  h.visible  ?? true,
          points:   h.points   ?? [],
          rails:    h.rails    ?? [],
        })
      );
      if (data.domain) {
        domX = data.domain.x ?? domX;
        domY = data.domain.y ?? domY;
      }
      dirty = false;
    } catch (e: any) {
      loadErr = `Parse error: ${e.message}`;
      initDefault();
    }
  }

  function initDefault() {
    const mid = (domX.min + domX.max) / 2;
    const xL  = domX.min + (domX.max - domX.min) * 0.05;
    const xR  = domX.max - (domX.max - domX.min) * 0.05;
    horizons = [
      HorizonState.fromJSON({ id: crypto.randomUUID(), name: 'Seabed',        colour: FORMATION_COLOURS[0], operator: 'none', visible: true, points: [{ x: xL, y: 200 }, { x: mid, y: 220 }, { x: xR, y: 210 }], rails: [] }),
      HorizonState.fromJSON({ id: crypto.randomUUID(), name: 'Top Sand A',    colour: FORMATION_COLOURS[1], operator: 'none', visible: true, points: [{ x: xL, y: 800 }, { x: mid, y: 900 }, { x: xR, y: 850 }], rails: [] }),
      HorizonState.fromJSON({ id: crypto.randomUUID(), name: 'Top Shale B',   colour: FORMATION_COLOURS[2], operator: 'none', visible: true, points: [{ x: xL, y: 1600 }, { x: mid, y: 1700 }, { x: xR, y: 1650 }], rails: [] }),
      HorizonState.fromJSON({ id: crypto.randomUUID(), name: 'Top Reservoir', colour: FORMATION_COLOURS[3], operator: 'none', visible: true, points: [{ x: xL, y: 2400 }, { x: mid, y: 2500 }, { x: xR, y: 2450 }], rails: [] }),
    ];
    dirty = false;
  }

  function toJSON(): string {
    return JSON.stringify({
      version: '1.0',
      domain:  { x: domX, y: domY },
      horizons: horizons.map(h => h.toJSON()),
    }, null, 2);
  }

  // ── Rail editing callback (from 3D view) ──────────────────────────────────
  function onUpdateRails(horizonId: string, newRails: Rail[]) {
    const h = horizons.find(h => h.id === horizonId);
    if (h) { h.rails = newRails; h.nurbsDirty = true; dirty = true; }
  }

  async function saveFile() {
    const json = toJSON();
    if (tab.handle) {
      try { await saveToHandle(tab.handle, json); dirty = false; }
      catch (e: any) { saveErr = e.message; }
    } else {
      downloadBlob(tab.name || 'geology.dgeo', json, 'application/json');
      dirty = false;
    }
  }

  function downloadFile() {
    downloadBlob(tab.name || 'geology.dgeo', toJSON(), 'application/json');
    dirty = false;
  }

  onMount(() => { loadFile(); });

  // ── Preset dialog ─────────────────────────────────────────────────────────
  let presetDialog = $state<{ depth: number; idx: number } | null>(null);

  const PRESETS = [
    { key: 'flat',       label: 'Flat',          icon: 'M4,20 h52' },
    { key: 'dome',       label: 'Dome',          icon: 'M4,22 Q30,4 56,22' },
    { key: 'undulating', label: 'Undulating',    icon: 'M4,15 Q16,5 30,15 Q44,25 56,15' },
    { key: 'fold',       label: 'Fold',          icon: 'M4,22 Q20,4 30,14 Q42,24 56,6' },
    { key: 'fold_fwd',   label: 'Fold forward',  icon: 'M4,20 C16,20 22,6 34,6 C42,6 46,14 38,18 C30,22 32,28 44,24 L56,20' },
    { key: 'fold_bwd',   label: 'Fold backward', icon: 'M4,20 L16,24 C28,28 30,22 22,18 C14,14 18,6 26,6 C38,6 44,20 56,20' },
  ];

  function generatePresetPoints(preset: string, baseDepth: number): Point2D[] {
    const xL = domX.min, xR = domX.max, xRange = xR - xL, xMid = (xL + xR) / 2;
    const amp = (domY.max - domY.min) * 0.12;
    const N = 20;
    const clampY = (y: number) => Math.max(domY.min, Math.min(domY.max, y));

    if (preset === 'flat')
      return Array.from({ length: 5 }, (_, i) => ({ x: xL + xRange * i / 4, y: baseDepth }));
    if (preset === 'dome') {
      const sigma = xRange * 0.25;
      return Array.from({ length: N }, (_, i) => {
        const x = xL + xRange * i / (N - 1);
        return { x, y: clampY(baseDepth - amp * Math.exp(-((x - xMid) ** 2) / (2 * sigma ** 2))) };
      });
    }
    if (preset === 'undulating') {
      const freq = 2.5;
      return Array.from({ length: N }, (_, i) => {
        const t = i / (N - 1);
        return { x: xL + xRange * t, y: clampY(baseDepth + amp * 0.8 * Math.sin(2 * Math.PI * freq * t)) };
      });
    }
    if (preset === 'fold')
      return Array.from({ length: N }, (_, i) => {
        const t = i / (N - 1);
        return { x: xL + xRange * t, y: clampY(baseDepth - amp * 1.2 * Math.sin(Math.PI * t)) };
      });
    if (preset === 'fold_fwd') {
      const raw: [number,number][] = [
        [0.00, 0.00],[0.15,-0.30],[0.35,-0.80],[0.55,-1.00],
        [0.72,-0.85],[0.78,-0.55],[0.68,-0.25],
        [0.58, 0.00],[0.70, 0.10],[0.85, 0.05],[1.00, 0.00],
      ];
      return raw.map(([tx, ty]) => ({ x: xL + tx * xRange, y: clampY(baseDepth + ty * amp * 1.8) }));
    }
    if (preset === 'fold_bwd') {
      const raw: [number,number][] = [
        [0.00, 0.00],[0.15, 0.05],[0.30, 0.10],[0.42, 0.00],
        [0.32,-0.25],[0.22,-0.55],[0.28,-0.85],[0.45,-1.00],
        [0.65,-0.80],[0.85,-0.30],[1.00, 0.00],
      ];
      return raw.map(([tx, ty]) => ({ x: xL + tx * xRange, y: clampY(baseDepth + ty * amp * 1.8) }));
    }
    return [{ x: xL, y: baseDepth }, { x: xMid, y: baseDepth }, { x: xR, y: baseDepth }];
  }

  // ── XYZ import ───────────────────────────────────────────────────────────
  interface XyzDialog { parsed: ParsedXYZ; name: string; xCol: number; strikeCol: number; depthCol: number; }
  let xyzDialog  = $state<XyzDialog | null>(null);
  let xyzFileEl  = $state<HTMLInputElement | null>(null);

  function openXyzPicker() { xyzFileEl?.click(); }

  async function onXyzFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text   = await file.text();
    const parsed = parseXYZ(text);
    if (!parsed || parsed.rows.length === 0) { alert('Could not parse file — check format.'); return; }
    const n = parsed.headers.length;
    xyzDialog = {
      parsed,
      name:      file.name.replace(/\.[^.]+$/, ''),
      xCol:      0,
      strikeCol: Math.min(1, n - 1),
      depthCol:  Math.min(2, n - 1),
    };
    // reset so the same file can be re-picked
    (e.target as HTMLInputElement).value = '';
  }

  function confirmXyzImport() {
    if (!xyzDialog) return;
    const { parsed, name, xCol, strikeCol, depthCol } = xyzDialog;
    const rails = xyzToRails(
      parsed.rows, xCol, strikeCol, depthCol,
      domX, domY, strikeKm, Math.max(2, defaultRailCount),
    );
    if (rails.length === 0) { alert('No points could be gridded — check column assignments.'); return; }
    const basePts = rails[Math.floor(rails.length / 2)].points;
    const idx = horizons.length;
    const h = new HorizonState({
      id:       crypto.randomUUID(),
      name:     name || `Horizon ${idx + 1}`,
      colour:   FORMATION_COLOURS[idx % FORMATION_COLOURS.length],
      operator: 'none',
      visible:  true,
      points:   basePts,
      rails,
    });
    horizons = [...horizons, h];
    activeId = h.id;
    tool     = 'select';
    dirty    = true;
    xyzDialog = null;
  }

  // ── Horizon management ────────────────────────────────────────────────────
  function addHorizon() {
    const idx   = horizons.length;
    const depth = domY.min + (domY.max - domY.min) * ((idx + 1) / (horizons.length + 2));
    presetDialog = { depth, idx };
  }

  function confirmAddHorizon(preset: string) {
    const { depth, idx } = presetDialog!;
    presetDialog = null;
    const basePts = generatePresetPoints(preset, depth);
    const n  = Math.max(2, defaultRailCount);

    let rails: Rail[];

    if (preset === 'dome') {
      // Hemispherical dome — each rail's amplitude is scaled by its normalised
      // strike distance from centre:  lift(x,z) = amp * sqrt(1 - dx² - dz²)
      // where dx = (x-xMid)/(xRange/2) and dz = (z-sMid)/(strikeKm/2)
      const xL = domX.min, xR = domX.max, xRange = xR - xL, xMid = (xL + xR) / 2;
      const sMid = strikeKm / 2;
      const amp  = (domY.max - domY.min) * 0.15;
      const N    = 24;
      const clampY = (y: number) => Math.max(domY.min, Math.min(domY.max, y));

      rails = Array.from({ length: n }, (_, ri) => {
        const z  = (ri / (n - 1)) * strikeKm;
        const dz = (z - sMid) / sMid;             // -1 … +1 in strike
        const points: Point2D[] = Array.from({ length: N }, (_, ci) => {
          const x  = xL + xRange * ci / (N - 1);
          const dx = (x - xMid) / (xRange / 2);   // -1 … +1 in X
          const d2 = dx * dx + dz * dz;
          const lift = d2 <= 1 ? amp * Math.sqrt(1 - d2) : 0;
          return { x, y: clampY(depth - lift) };
        });
        return { z, points };
      });
    } else {
      rails = Array.from({ length: n }, (_, i) => ({
        z:      (i / (n - 1)) * strikeKm,
        points: basePts.map(p => ({ ...p })),
      }));
    }
    const h = new HorizonState({
      id:       crypto.randomUUID(),
      name:     `Horizon ${idx + 1}`,
      colour:   FORMATION_COLOURS[idx % FORMATION_COLOURS.length],
      operator: 'none',
      visible:  true,
      points:   basePts,
      rails,
    });
    horizons = [...horizons, h];
    activeId = h.id;
    tool = 'select';
    dirty = true;
  }

  function deleteHorizon(id: string) {
    horizons = horizons.filter(h => h.id !== id);
    if (activeId === id) activeId = null;
    dirty = true;
  }

  // Direct field mutations on HorizonState ($state fields) — no array rebuild needed
  function renameHorizon(id: string, name: string) {
    const h = horizons.find(h => h.id === id);
    if (h) { h.name = name; dirty = true; }
  }

  function recolourHorizon(id: string, colour: string) {
    const h = horizons.find(h => h.id === id);
    if (h) { h.colour = colour; dirty = true; }
  }

  function setOperator(id: string, op: string) {
    const h = horizons.find(h => h.id === id);
    if (h) { h.operator = op as HorizonOperator; dirty = true; }
  }

  function toggleVisibility(id: string) {
    const h = horizons.find(h => h.id === id);
    if (h) { h.visible = !h.visible; dirty = true; }
  }

  function moveHorizon(id: string, dir: 'up' | 'down') {
    const idx = horizons.findIndex(h => h.id === id);
    if (idx < 0) return;
    if (dir === 'up'   && idx === 0) return;
    if (dir === 'down' && idx === horizons.length - 1) return;
    const arr = [...horizons];
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    horizons = arr;
    dirty = true;
  }

  function adjustDepth(id: string, newZ: number) {
    const h = horizons.find(h => h.id === id);
    if (!h || !h.points.length) return;
    const curZ  = h.points.reduce((s, p) => s + p.y, 0) / h.points.length;
    const delta = newZ - curZ;
    const clamp = (y: number) => Math.max(domY.min, Math.min(domY.max, y + delta));
    h.points = h.points.map(p => ({ ...p, y: clamp(p.y) }));
    if (h.rails?.length) {
      h.rails = h.rails.map(r => ({ ...r, points: r.points.map(p => ({ ...p, y: clamp(p.y) })) }));
    }
    h.nurbsDirty = true;
    dirty = true;
  }

  function horizonStroke(h: HorizonState) {
    const op = h.operator ?? 'none';
    if (op === 'RA' || op === 'RAI') return { dasharray: '8 4', width: 2 };
    if (op === 'RB' || op === 'RBI') return { dasharray: 'none', width: 3.5 };
    return { dasharray: 'none', width: 2 };
  }

  // ── SVG interaction ───────────────────────────────────────────────────────
  let svgRef = $state<SVGSVGElement | null>(null);

  function svgCoords(e: MouseEvent) {
    const rect = svgRef!.getBoundingClientRect();
    return {
      x: fromSvgX((e.clientX - rect.left) * (W / rect.width)),
      y: fromSvgY((e.clientY - rect.top)  * (H / rect.height)),
    };
  }

  function onSvgClick(e: MouseEvent) {
    if (tool !== 'add-point' || !activeId) return;
    const h = horizons.find(h => h.id === activeId);
    if (!h) return;
    const { x, y } = svgCoords(e);
    h.points = [...h.points, {
      x: Math.max(domX.min, Math.min(domX.max, x)),
      y: Math.max(domY.min, Math.min(domY.max, y)),
    }];
    dirty = true;
  }

  function onPointMouseDown(e: MouseEvent, horizonId: string, pointIdx: number) {
    if (tool !== 'select') return;
    e.stopPropagation();
    activeId  = horizonId;
    dragState = { horizonId, pointIdx };
  }

  function onPointClick(e: MouseEvent, horizonId: string, pointIdx: number) {
    if (tool !== 'delete') return;
    e.stopPropagation();
    const h = horizons.find(h => h.id === horizonId);
    if (h) { h.points = h.points.filter((_, i) => i !== pointIdx); dirty = true; }
  }

  function onSvgMouseMove(e: MouseEvent) {
    if (!dragState) return;
    const h = horizons.find(h => h.id === dragState!.horizonId);
    if (!h) return;
    const { x, y } = svgCoords(e);
    const cx = Math.max(domX.min, Math.min(domX.max, x));
    const cy = Math.max(domY.min, Math.min(domY.max, y));
    const leftIdx  = 0;
    const rightIdx = h.points.length - 1;
    const finalX   = dragState!.pointIdx === leftIdx  ? domX.min
                   : dragState!.pointIdx === rightIdx ? domX.max : cx;
    h.points = h.points.map((p, i) => i === dragState!.pointIdx ? { x: finalX, y: cy } : p);
    dirty = true;
  }

  function onSvgMouseUp() { dragState = null; }

  const xTicks = $derived(
    Array.from({ length: 6 }, (_, i) => {
      const v = domX.min + (i / 5) * (domX.max - domX.min);
      return { v, sx: toSvgX(v) };
    })
  );

  const yTicks = $derived(
    Array.from({ length: 6 }, (_, i) => {
      const v = domY.min + (i / 5) * (domY.max - domY.min);
      return { v, sy: toSvgY(v) };
    })
  );

  const activeHorizon = $derived(horizons.find(h => h.id === activeId));

  const cursor = $derived(
    tool === 'add-point' ? 'crosshair' :
    tool === 'delete'    ? 'not-allowed' : 'default'
  );
</script>

<div class="flex h-full overflow-hidden bg-white text-sm">

  <!-- ── Narrow icon toolbar (TplApp pattern) ─────────────────────────────── -->
  <div class="tb-dgeo">

    <!-- Save -->
    <div class="tb-item group">
      <button class="tb-btn" class:tb-active={dirty} onclick={saveFile} aria-label="Save">
        {#if dirty}<span class="dirty-dot"></span>{/if}
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1.5"/>
          <rect x="5" y="2" width="6" height="4" rx="0.5" fill="currentColor" stroke="none"/>
          <rect x="4.5" y="9" width="7" height="5" rx="0.75"/>
        </svg>
      </button>
      <span class="tb-tip">{tab.handle ? 'Save to disk' : 'Download'}</span>
    </div>

    <!-- Download copy -->
    <div class="tb-item group">
      <button class="tb-btn" onclick={downloadFile} aria-label="Download copy">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 14h10M8 2v8M5 7l3 4 3-4"/>
        </svg>
      </button>
      <span class="tb-tip">Download copy</span>
    </div>

    <div class="tb-sep"></div>

    <!-- 2D view -->
    <div class="tb-item group">
      <button class="tb-btn" class:tb-active={viewMode==='2d'} onclick={() => viewMode='2d'} aria-label="2D cross-section">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="2" y="3" width="12" height="10" rx="1"/>
          <path d="M2 7 q3-2 6 0 q3 2 6 0" stroke-dasharray="2 1.2"/>
          <path d="M2 10.5 q3-1.5 6 0 q3 1.5 6 0" stroke-dasharray="2 1.2"/>
        </svg>
      </button>
      <span class="tb-tip">2D Cross-section</span>
    </div>

    <!-- 3D view -->
    <div class="tb-item group">
      <button class="tb-btn" class:tb-active={viewMode==='3d'} onclick={() => viewMode='3d'} aria-label="3D block view">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M8 2 L14 5.5 V11 L8 14.5 L2 11 V5.5 Z"/>
          <path d="M8 2 V8.5 M2 5.5 L8 8.5 L14 5.5"/>
        </svg>
      </button>
      <span class="tb-tip">3D Block view</span>
    </div>

    <!-- Solidify (3D mode only) -->
    {#if viewMode === '3d'}
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showSolids}
          onclick={() => (showSolids = !showSolids)} aria-label="Toggle solid blocks">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1 L14 4.5 V11.5 L8 15 L2 11.5 V4.5 Z"
              fill={showSolids ? 'currentColor' : 'none'}
              stroke="currentColor" stroke-width="1.4"/>
            <path d="M8 1 L8 8 M2 4.5 L8 8 L14 4.5"
              fill="none" stroke={showSolids ? 'white' : 'currentColor'} stroke-width="1.2"/>
          </svg>
        </button>
        <span class="tb-tip">{showSolids ? 'Hide solids' : 'Solidify surfaces'}</span>
      </div>
    {/if}

    <div class="tb-sep"></div>

    <!-- Tools (2D mode only) -->
    {#if viewMode === '2d'}
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={tool==='select'}
          onclick={() => tool='select'} aria-label="Select / Move">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 2 L3 12 L6 9 L8 14 L10 13 L8 8 L12 8 Z" fill="currentColor" stroke="none" opacity="0.7"/>
          </svg>
        </button>
        <span class="tb-tip">Select / Move</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={tool==='add-point'}
          onclick={() => tool='add-point'} aria-label="Add point">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="5.5"/>
            <line x1="8" y1="5" x2="8" y2="11"/><line x1="5" y1="8" x2="11" y2="8"/>
          </svg>
        </button>
        <span class="tb-tip">Add point</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={tool==='delete'}
          onclick={() => tool='delete'} aria-label="Delete point">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="5.5"/>
            <line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>
          </svg>
        </button>
        <span class="tb-tip">Delete point</span>
      </div>

      <div class="tb-sep"></div>
    {/if}

    <!-- Horizons panel -->
    <div class="tb-item group">
      <button class="tb-btn" class:tb-active={showHzPanel}
        onclick={() => (showHzPanel = !showHzPanel)} aria-label="Horizons table">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="1.5" y="2" width="13" height="12" rx="1.2"/>
          <line x1="1.5" y1="5.5" x2="14.5" y2="5.5"/>
          <line x1="1.5" y1="9"   x2="14.5" y2="9"/>
          <line x1="5"   y1="2"   x2="5"    y2="14"/>
        </svg>
      </button>
      <span class="tb-tip">Horizons table</span>
    </div>

    <!-- Add horizon -->
    <div class="tb-item group">
      <button class="tb-btn" onclick={addHorizon} aria-label="Add horizon">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 10 q3-2.5 6 0 q3 2.5 6 0"/>
          <path d="M2 6 q3-2.5 6 0 q3 2.5 6 0" opacity="0.4"/>
          <line x1="8" y1="1" x2="8" y2="4"/><line x1="6.5" y1="2.5" x2="9.5" y2="2.5"/>
        </svg>
      </button>
      <span class="tb-tip">Add horizon</span>
    </div>

    <!-- Reset -->
    <div class="tb-item group">
      <button class="tb-btn" onclick={initDefault} aria-label="Reset to default">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 8 A5 5 0 1 1 5.5 12.5"/>
          <polyline points="2,6 3,9 6,8"/>
        </svg>
      </button>
      <span class="tb-tip">Reset to default</span>
    </div>

    <!-- Error indicator -->
    {#if loadErr || saveErr}
      <div class="tb-item group mt-auto">
        <button class="tb-btn" style="color:#ef4444"
          onclick={() => { loadErr=''; saveErr=''; }}
          aria-label="Clear errors">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M8 2 L14.5 13.5 H1.5 Z"/>
            <line x1="8" y1="6.5" x2="8" y2="9.5"/><circle cx="8" cy="11.5" r="0.6" fill="currentColor"/>
          </svg>
        </button>
        <span class="tb-tip">{loadErr || saveErr} — click to clear</span>
      </div>
    {/if}

  </div><!-- /toolbar -->

  <!-- ── Main canvas area ────────────────────────────────────────────────── -->
  <div class="flex-1 overflow-hidden flex flex-col min-h-0">

    <!-- ── 3D block view ────────────────────────────────────────────────────── -->
    {#if viewMode === '3d'}
      <div class="flex-1 overflow-hidden min-h-0">
        <Dgeo3DView
          horizons={horizons}
          domX={domX}
          domY={domY}
          {onUpdateRails}
          bind:showSolids
          bind:strikeKm
          bind:defaultRailCount
        />
      </div>

    {:else}
    <!-- ── 2D SVG canvas ───────────────────────────────────────────────────── -->

      <!-- Compact domain bar -->
      <div class="flex items-center gap-2 px-3 py-1 border-b border-gray-100 bg-white text-[10px] text-gray-500 flex-shrink-0 flex-wrap">
        <span class="font-medium text-gray-600">Domain</span>
        <span>X:</span>
        <input type="number" class="w-12 border border-gray-200 rounded px-1 py-0 text-[10px]" value={domX.min}
          onchange={e => { domX = { ...domX, min: +e.target.value }; }}/>
        <span>–</span>
        <input type="number" class="w-12 border border-gray-200 rounded px-1 py-0 text-[10px]" value={domX.max}
          onchange={e => { domX = { ...domX, max: +e.target.value }; }}/>
        <span class="text-gray-400">km</span>
        <span class="ml-2">Depth:</span>
        <input type="number" class="w-14 border border-gray-200 rounded px-1 py-0 text-[10px]" value={domY.min}
          onchange={e => { domY = { ...domY, min: +e.target.value }; }}/>
        <span>–</span>
        <input type="number" class="w-14 border border-gray-200 rounded px-1 py-0 text-[10px]" value={domY.max}
          onchange={e => { domY = { ...domY, max: +e.target.value }; }}/>
        <span class="text-gray-400">m</span>
      </div>

      <div class="flex-1 overflow-auto p-2">
        <svg
          bind:this={svgRef}
          width={W} height={H}
          viewBox="0 0 {W} {H}"
          style="display:block; font-family:sans-serif; cursor:{cursor}; max-width:100%; height:auto;"
          onclick={onSvgClick}
          onmousemove={onSvgMouseMove}
          onmouseup={onSvgMouseUp}>

          <!-- Background -->
          <rect x={PAD} y={PAD/2} width={CHART_W} height={CHART_H} fill="#f0f4ff" stroke="#d1d5db" stroke-width="1"/>

          <!-- Formation bands (between consecutive depth-sorted horizons for 2D display) -->
          {#each sortedHorizons as h, i (h.id)}
            {#if i < sortedHorizons.length - 1}
              {@const nextH = sortedHorizons[i + 1]}
              <polygon
                points={bandPath(h, nextH)}
                fill={nextH.colour}
                opacity="0.7"/>
            {/if}
          {/each}

          <!-- Top fill (surface to first horizon) -->
          {#if sortedHorizons.length > 0}
            {@const first = sortedHorizons[0]}
            {@const pts = [...first.points].sort((a, b) => a.x - b.x)}
            <polygon
              points={[
                `${PAD},${PAD/2}`,
                `${PAD + CHART_W},${PAD/2}`,
                `${PAD + CHART_W},${toSvgY(pts[pts.length-1].y).toFixed(1)}`,
                ...pts.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`).reverse(),
                `${PAD},${toSvgY(pts[0].y).toFixed(1)}`,
              ].join(' ')}
              fill={sortedHorizons[0].colour}
              opacity="0.4"/>
          {/if}

          <!-- Bottom fill (last horizon to bottom) -->
          {#if sortedHorizons.length > 0}
            {@const last = sortedHorizons[sortedHorizons.length - 1]}
            {@const pts = [...last.points].sort((a, b) => a.x - b.x)}
            <polygon
              points={[
                `${PAD},${toSvgY(pts[0].y).toFixed(1)}`,
                ...pts.map(p => `${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`),
                `${PAD + CHART_W},${toSvgY(pts[pts.length-1].y).toFixed(1)}`,
                `${PAD + CHART_W},${PAD/2 + CHART_H}`,
                `${PAD},${PAD/2 + CHART_H}`,
              ].join(' ')}
              fill={FORMATION_COLOURS[(sortedHorizons.length) % FORMATION_COLOURS.length]}
              opacity="0.5"/>
          {/if}

          <!-- Grid lines -->
          {#each xTicks as t}
            <line x1={t.sx} y1={PAD/2} x2={t.sx} y2={PAD/2 + CHART_H} stroke="#c7d2fe" stroke-width="0.5" stroke-dasharray="4,4"/>
          {/each}
          {#each yTicks as t}
            <line x1={PAD} y1={t.sy} x2={PAD + CHART_W} y2={t.sy} stroke="#c7d2fe" stroke-width="0.5" stroke-dasharray="4,4"/>
          {/each}

          <!-- Horizon lines + points -->
          {#each horizons as h (h.id)}
            {@const isActive = activeId === h.id}
            {@const stroke = horizonStroke(h)}

            {#if h.points.length >= 2}
              <polyline
                points={polyStr(h)}
                fill="none"
                stroke={h.colour}
                stroke-width={isActive ? stroke.width + 1 : stroke.width}
                stroke-dasharray={stroke.dasharray}
                stroke-linejoin="round"
                stroke-linecap="round"
                style="filter: {isActive ? 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' : 'none'}"/>
              <polyline
                points={polyStr(h)}
                fill="none"
                stroke="#374151"
                stroke-width={isActive ? 1.5 : 0.5}
                stroke-dasharray={stroke.dasharray}
                opacity="0.5"
                stroke-linejoin="round"
                stroke-linecap="round"/>
            {/if}

            {#if h.points.length > 0}
              {@const lastPt = h.points[h.points.length - 1]}
              <text
                x={toSvgX(lastPt.x) + 5}
                y={toSvgY(lastPt.y) + 4}
                font-size="10"
                font-weight={isActive ? 'bold' : 'normal'}
                fill={isActive ? '#1d4ed8' : '#374151'}>
                {h.name}
              </text>
            {/if}

            {#each h.points as pt, i}
              <circle
                cx={toSvgX(pt.x)}
                cy={toSvgY(pt.y)}
                r={isActive ? 6 : 4}
                fill={isActive ? 'white' : h.colour}
                stroke={isActive ? h.colour : '#374151'}
                stroke-width={isActive ? 2 : 0.5}
                style="cursor:{tool === 'select' ? 'grab' : tool === 'delete' ? 'not-allowed' : 'crosshair'}"
                onmousedown={e => onPointMouseDown(e, h.id, i)}
                onclick={e => onPointClick(e, h.id, i)}/>
            {/each}
          {/each}

          <!-- X-axis -->
          {#each xTicks as t}
            <line x1={t.sx} y1={PAD/2 + CHART_H} x2={t.sx} y2={PAD/2 + CHART_H + 4} stroke="#6b7280" stroke-width="1"/>
            <text x={t.sx} y={PAD/2 + CHART_H + 14} text-anchor="middle" font-size="9" fill="#6b7280">{t.v.toFixed(1)}</text>
          {/each}
          <text x={PAD + CHART_W / 2} y={H - 4} text-anchor="middle" font-size="10" fill="#6b7280">Distance (km)</text>

          <!-- Y-axis (depth) -->
          {#each yTicks as t}
            <line x1={PAD - 4} y1={t.sy} x2={PAD} y2={t.sy} stroke="#6b7280" stroke-width="1"/>
            <text x={PAD - 7} y={t.sy + 3} text-anchor="end" font-size="9" fill="#6b7280">{Math.round(t.v)}</text>
          {/each}
          <text x="12" y={PAD/2 + CHART_H/2} text-anchor="middle" font-size="10" fill="#6b7280"
            transform="rotate(-90 12 {PAD/2 + CHART_H/2})">Depth (m)</text>

          <!-- Border -->
          <rect x={PAD} y={PAD/2} width={CHART_W} height={CHART_H} fill="none" stroke="#9ca3af" stroke-width="1"/>
        </svg>
      </div>
    {/if}

  </div><!-- /canvas area -->

  <!-- ── Horizons floating panel ──────────────────────────────────────────── -->
  <FloatingPanel
    title="Stratigraphic Column"
    visible={showHzPanel}
    onClose={() => (showHzPanel = false)}
    width={340}
    x={40} y={60}>
    {#snippet children()}
      <div class="p-3">

        <!-- Table header -->
        <div class="hz-tbl-head">
          <span style="width:22px"></span>
          <span style="width:16px"></span>
          <span style="width:16px"></span>
          <span class="flex-1">Name</span>
          <span style="width:58px" class="text-center">Depth (m)</span>
          <span style="width:112px" class="text-center">Operator</span>
          <span style="width:16px"></span>
        </div>

        <!-- Horizon rows -->
        {#each horizons as h, idx (h.id)}
          {@const refZ = Math.round(h.points.reduce((s,p)=>s+p.y,0) / Math.max(1,h.points.length))}
          <div class="hz-tbl-row {activeId===h.id ? 'hz-tbl-active' : ''}"
               onclick={() => activeId = h.id} role="button" tabindex="0"
               onkeydown={e => e.key==='Enter' && (activeId=h.id)}>

            <!-- Up/Down -->
            <div style="width:22px" class="flex flex-col items-center gap-px">
              <button class="hz-t-arr" disabled={idx===0}
                onclick={e=>{e.stopPropagation();moveHorizon(h.id,'up')}}
                title="Move up in stratigraphy">▲</button>
              <button class="hz-t-arr" disabled={idx===horizons.length-1}
                onclick={e=>{e.stopPropagation();moveHorizon(h.id,'down')}}
                title="Move down in stratigraphy">▼</button>
            </div>

            <!-- Colour swatch -->
            <input type="color" value={h.colour}
              oninput={e=>recolourHorizon(h.id,e.target.value)}
              onclick={e=>e.stopPropagation()}
              style="width:16px;height:16px;appearance:none;-webkit-appearance:none"
              class="rounded border-0 p-0 cursor-pointer flex-shrink-0"/>

            <!-- Visibility toggle -->
            <button style="width:16px" title={(h.visible??true) ? 'Hide surface' : 'Show surface'}
              onclick={e=>{e.stopPropagation();toggleVisibility(h.id)}}
              class="text-center leading-none flex-shrink-0 {(h.visible??true) ? 'text-blue-400' : 'text-gray-300'}">
              {#if (h.visible ?? true)}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 3C4.5 3 1.5 5.5 0 8c1.5 2.5 4.5 5 8 5s6.5-2.5 8-5c-1.5-2.5-4.5-5-8-5zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
                </svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 2l12 12M8 3C4.5 3 1.5 5.5 0 8c.7 1.2 1.8 2.3 3 3.1L2 2zm3 .4A7.8 7.8 0 0 1 8 3c3.5 0 6.5 2.5 8 5a8.3 8.3 0 0 1-3 3.1L11 3.4zM5.5 5.5a3 3 0 0 0 4.1 4.1L5.5 5.5z"/>
                </svg>
              {/if}
            </button>

            <!-- Name -->
            <input type="text" value={h.name}
              onchange={e=>renameHorizon(h.id,e.target.value)}
              onclick={e=>e.stopPropagation()}
              class="flex-1 text-xs border border-gray-200 rounded px-1.5 py-0.5 min-w-0"/>

            <!-- Reference depth -->
            <input type="number" value={refZ}
              onchange={e=>{e.stopPropagation();adjustDepth(h.id,+e.target.value)}}
              onclick={e=>e.stopPropagation()}
              style="width:58px"
              class="text-xs border border-gray-200 rounded px-1 py-0.5 text-right"/>

            <!-- Operator buttons -->
            <div style="width:112px" class="flex gap-0.5" onclick={e=>e.stopPropagation()}>
              {#each ['none','RA','RAI','RB','RBI'] as op}
                {@const active = (h.operator??'none')===op}
                <button
                  onclick={()=>setOperator(h.id,op)}
                  title={op==='none' ? 'Deposit — conformable layer, no erosion' :
                         op==='RA'   ? 'Remove Above — truncates ALL shallower horizons' :
                         op==='RAI'  ? 'Remove Above Intersection — clips immediate neighbour only' :
                         op==='RB'   ? 'Remove Below — channel/diapir cutting downward' :
                                       'Remove Below Intersection — clips immediate deeper neighbour only'}
                  class="hz-t-op
                    {active && op==='none'  ? 'hz-t-op-deposit' : ''}
                    {active && (op==='RA'||op==='RAI') ? 'hz-t-op-ra' : ''}
                    {active && (op==='RB'||op==='RBI') ? 'hz-t-op-rb' : ''}
                    {!active ? 'hz-t-op-off' : ''}">
                  {op==='none'?'·':op}
                </button>
              {/each}
            </div>

            <!-- Delete -->
            <button style="width:16px"
              onclick={e=>{e.stopPropagation();deleteHorizon(h.id)}}
              class="text-gray-300 hover:text-red-500 text-xs text-center">✕</button>
          </div>
        {/each}

        <!-- Add / Import buttons -->
        <div class="mt-2 flex gap-1">
          <button onclick={addHorizon}
            class="flex-1 py-1 text-xs text-blue-600 border border-dashed border-blue-300
                   rounded hover:border-blue-500 hover:bg-blue-50">
            + Add horizon
          </button>
          <button onclick={openXyzPicker}
            class="flex-1 py-1 text-xs text-emerald-700 border border-dashed border-emerald-300
                   rounded hover:border-emerald-500 hover:bg-emerald-50"
            title="Import horizon from XYZ file (CSV / TXT)">
            ↑ Import XYZ
          </button>
        </div>

      </div>
    {/snippet}
  </FloatingPanel>

  <!-- ── Preset shape picker dialog ──────────────────────────────────────── -->
  {#if presetDialog}
    <!-- backdrop -->
    <div
      style="position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1000;display:flex;align-items:center;justify-content:center"
      onclick={() => presetDialog = null}
      role="dialog"
      aria-modal="true">
      <!-- card -->
      <div
        onclick={e => e.stopPropagation()}
        style="background:white;border-radius:12px;padding:20px 24px;width:420px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.22)">
        <p style="font-size:14px;font-weight:600;color:#1e293b;margin:0 0 14px">Choose surface shape</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          {#each PRESETS as p}
            <button
              onclick={() => confirmAddHorizon(p.key)}
              style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 6px;border:1.5px solid #e2e8f0;border-radius:8px;background:white;cursor:pointer;transition:all .15s"
              onmouseenter={e => e.currentTarget.style.borderColor='#3b82f6'}
              onmouseleave={e => e.currentTarget.style.borderColor='#e2e8f0'}>
              <svg width="60" height="36" viewBox="0 0 60 36" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d={p.icon}/>
              </svg>
              <span style="font-size:11px;color:#374151;font-weight:500">{p.label}</span>
            </button>
          {/each}
        </div>
        <button
          onclick={() => presetDialog = null}
          style="margin-top:14px;width:100%;padding:6px;font-size:12px;color:#6b7280;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer">
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- ── Hidden XYZ file input ──────────────────────────────────────────────── -->
  <input
    bind:this={xyzFileEl}
    type="file"
    accept=".csv,.txt,.xyz,.dat"
    style="display:none"
    onchange={onXyzFile}
  />

  <!-- ── XYZ import dialog ──────────────────────────────────────────────────── -->
  {#if xyzDialog}
    <div
      style="position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:1000;display:flex;align-items:center;justify-content:center"
      onclick={() => (xyzDialog = null)}
      role="dialog" aria-modal="true">
      <div
        onclick={e => e.stopPropagation()}
        style="background:white;border-radius:12px;padding:20px 24px;width:400px;max-width:95vw;box-shadow:0 8px 32px rgba(0,0,0,0.22)">

        <p style="font-size:14px;font-weight:600;color:#1e293b;margin:0 0 4px">Import XYZ surface</p>
        <p style="font-size:11px;color:#6b7280;margin:0 0 14px">
          {xyzDialog.parsed.rows.length} points detected · auto-normalised to domain
        </p>

        <!-- Column mapping -->
        <div style="display:grid;gap:8px;margin-bottom:16px">
          {#each ([
            { label: 'X — horizontal distance', key: 'xCol' },
            { label: 'Y — along-strike position', key: 'strikeCol' },
            { label: 'Z — depth', key: 'depthCol' },
          ] as const) as row}
            <div style="display:flex;align-items:center;gap:8px">
              <span style="flex:1;font-size:11px;color:#374151">{row.label}</span>
              <select
                style="font-size:11px;border:1px solid #e2e8f0;border-radius:5px;padding:3px 6px;background:white"
                value={xyzDialog[row.key]}
                onchange={e => { if (xyzDialog) xyzDialog[row.key] = Number((e.target as HTMLSelectElement).value); }}>
                {#each xyzDialog.parsed.stats as col, ci}
                  <option value={ci}>{col.label} [{col.min.toFixed(2)} … {col.max.toFixed(2)}]</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>

        <!-- Horizon name -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
          <span style="flex:1;font-size:11px;color:#374151">Horizon name</span>
          <input
            type="text"
            style="font-size:11px;border:1px solid #e2e8f0;border-radius:5px;padding:3px 8px;width:160px"
            bind:value={xyzDialog.name}
          />
        </div>

        <div style="display:flex;gap:8px">
          <button
            onclick={confirmXyzImport}
            style="flex:1;padding:7px;font-size:12px;font-weight:600;color:white;background:#10b981;border:none;border-radius:6px;cursor:pointer">
            Import
          </button>
          <button
            onclick={() => (xyzDialog = null)}
            style="flex:1;padding:7px;font-size:12px;color:#6b7280;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer">
            Cancel
          </button>
        </div>

      </div>
    </div>
  {/if}

</div>

<style>
  .tb-dgeo {
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
    position: relative;
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
  .tb-btn:hover  { background: #f1f5f9; color: #1e293b; }
  .tb-btn.tb-active { background: #dbeafe; color: #2563eb; }
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
    padding: 3px 8px;
    border-radius: 4px;
    white-space: nowrap;
    z-index: 999;
    pointer-events: none;
  }
  .tb-tip::before {
    content: '';
    position: absolute;
    right: 100%;
    top: 50%;
    transform: translateY(-50%);
    border: 4px solid transparent;
    border-right-color: #1e293b;
  }
  .tb-item:hover .tb-tip { display: block; }
  .dirty-dot {
    position: absolute;
    top: 2px; right: 2px;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #f97316;
    pointer-events: none;
  }

  /* ── Horizons floating panel table ─────────────────────────────────────── */
  .hz-tbl-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 2px 4px;
    border-bottom: 1px solid #e2e8f0;
    margin-bottom: 3px;
    font-size: 9px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .hz-tbl-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 2px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .hz-tbl-row:hover { background: #f8fafc; }
  .hz-tbl-active { background: #eff6ff !important; }

  .hz-t-arr {
    background: none; border: none; cursor: pointer;
    font-size: 7px; line-height: 1; color: #94a3b8; padding: 1px;
    display: block;
  }
  .hz-t-arr:hover:not(:disabled) { color: #3b82f6; }
  .hz-t-arr:disabled { opacity: 0.2; cursor: default; }

  .hz-t-op {
    flex: 1;
    font-size: 8px; font-weight: 700;
    padding: 2px 0;
    border-radius: 3px;
    border: 1px solid #e2e8f0;
    background: white;
    color: #94a3b8;
    cursor: pointer;
    text-align: center;
    transition: all 0.1s;
  }
  .hz-t-op-off:hover { border-color: #93c5fd; color: #3b82f6; }
  /* Active states — colour-coded by operator type */
  .hz-t-op-deposit { background: #f0fdf4; color: #16a34a; border-color: #86efac; }
  .hz-t-op-ra      { background: #fff7ed; color: #ea580c; border-color: #fdba74; }
  .hz-t-op-rb      { background: #faf5ff; color: #9333ea; border-color: #d8b4fe; }
</style>
