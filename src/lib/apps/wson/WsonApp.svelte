<script module>
  // Per-tab display state cache — survives component remounts (tab switching)
  const _cache = new Map(); // tabId → { displayOpts, showInfoBar, showOpenHole, showCasing, showCement, showCompletions, showPerforations, showStrata }

  function getCache(id) {
    return _cache.get(id) ?? {
      displayOpts: { autoScale: true, directional: false, xScale: 0.17, yScale: 0.17, xDiaScale: 6.0, preserveAspectRatio: true, showLeftTrack: true },
      showInfoBar: true, showOpenHole: true, showCasing: true, showCement: true,
      showCompletions: true, showPerforations: true, showStrata: true
    };
  }
</script>

<script>
  import { onMount } from 'svelte';
  import { FloatingPanel } from '$lib/components/FloatingPanel';

  const { tab } = $props();

  let loading = $state(true);
  let error   = $state('');
  let wson    = $state(null);

  // Directional + autoscale data from /api/schematic
  let dirData = $state(null); // { dtx, prNorm, prAuto }

  // ── Layout constants ─────────────────────────────────────────────────────
  const RULER_W   = 44;
  const HEADER_H  = 52;
  const PERF_DIST = 3;

  // ── Restore per-tab display state from cache ──────────────────────────────
  const cached = getCache(tab.id);

  // ── Display Options state ────────────────────────────────────────────────
  let displayOpts = $state({ ...cached.displayOpts });
  let showDisplayOpts  = $state(false);
  let showLayersPanel  = $state(false);

  // ── Toolbar visibility states ─────────────────────────────────────────────
  let showInfoBar      = $state(cached.showInfoBar);
  let showStrata       = $state(cached.showStrata);
  let showOpenHole     = $state(cached.showOpenHole);
  let showCasing       = $state(cached.showCasing);
  let showCement       = $state(cached.showCement);
  let showCompletions  = $state(cached.showCompletions);
  let showPerforations = $state(cached.showPerforations);

  // Persist display state whenever it changes
  $effect(() => {
    _cache.set(tab.id, {
      displayOpts: { ...displayOpts },
      showInfoBar, showOpenHole, showCasing, showCement,
      showCompletions, showPerforations, showStrata
    });
  });
  // ── Schematic Editor state ────────────────────────────────────────────────
  let showSchematicEditor = $state(false);
  let schematicTab = $state('oh'); // 'oh' | 'ch' | 'cem' | 'strata'
  let editIdx = $state(-1);
  let editData = $state({});

  // ── Component JSON cache ──────────────────────────────────────────────────
  const compJsonCache = new Map();
  let compSvgStrings = $state([]);

  function jsonToSvgContent(componentData, comp, compIndex, g) {
    const { elements, width: jw, height: jh } = componentData;
    if (!elements || !jw || !jh) return '';

    const { centerX, yScale, diaScale, wellDir, dtx, hasDir, autoScale } = g;
    const compOD     = comp.od ?? 2.875;
    const compLength = comp.length ?? 1;
    const compTop    = comp._top;

    const defs  = [];
    const paths = [];
    let gradCounter = 0;

    for (const el of elements) {
      if (el.type !== 'freeform' || !el.points?.length) continue;

      const segs = [];
      for (const pt of el.points) {
        const { x, y, directive } = pt;
        // Raw coordinates: diameter inches, depth meters (matches dlis buildComponent.ts)
        const diamIn = jw > 0 ? (x - jw / 2) * (compOD / jw) : 0;
        const depthM = jh > 0 ? compTop + (y * compLength / jh) : compTop;
        // Apply unified transform — handles directional arc-slerp + autoscale DTX
        const [svgX, svgY] = txPoint(diamIn, depthM, hasDir ? wellDir : null, dtx, yScale, diaScale, centerX, autoScale);

        if (directive === 'moveTo')       segs.push(`M${svgX.toFixed(2)} ${svgY.toFixed(2)}`);
        else if (directive === 'lineTo')  segs.push(`L${svgX.toFixed(2)} ${svgY.toFixed(2)}`);
        else if (directive === 'close')   segs.push('Z');
      }
      if (segs.length === 0) continue;

      let fillAttr = 'none';
      const fill = el.fill;
      if (fill) {
        if (typeof fill === 'string') {
          fillAttr = fill;
        } else if (fill.type === 'solid') {
          fillAttr = fill.color ?? 'none';
        } else if (fill.type === 'gradient') {
          const origId  = fill.id ?? `g${gradCounter}`;
          const uid     = `ci${compIndex}_${origId}`;
          fillAttr = `url(#${uid})`;
          const stops = (fill.gstops ?? []).map(s => {
            const offset = s.offset ?? `${(s.position / 1000).toFixed(1)}%`;
            return `<stop offset="${offset}" stop-color="${s['stop-color'] ?? '#000'}"/>`;
          }).join('');
          const gType = fill.gradient_type ?? 'linear';
          if (gType === 'linear') {
            defs.push(`<linearGradient id="${uid}" x1="0%" y1="0%" x2="100%" y2="0%">${stops}</linearGradient>`);
          } else {
            defs.push(`<radialGradient id="${uid}">${stops}</radialGradient>`);
          }
          gradCounter++;
        }
      }

      const stroke = el.stroke ?? 'none';
      const sw = Array.isArray(el.strokeWidth) ? el.strokeWidth[0] : (el.strokeWidth ?? 0);
      paths.push(`<path d="${segs.join(' ')}" fill="${fillAttr}" stroke="${stroke}" stroke-width="${sw}"/>`);
    }

    const defsSection = defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '';
    return defsSection + paths.join('');
  }

  async function fetchCompJson(jsonName) {
    if (compJsonCache.has(jsonName)) return compJsonCache.get(jsonName);
    try {
      const res = await fetch(`/compjson/${encodeURIComponent(jsonName)}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      compJsonCache.set(jsonName, data);
      return data;
    } catch {
      compJsonCache.set(jsonName, null);
      return null;
    }
  }

  $effect(() => {
    const g = geo;
    if (!g || g.completions.length === 0) { compSvgStrings = []; return; }
    const snap = g.completions;
    (async () => {
      const results = await Promise.all(
        snap.map(async (comp, i) => {
          const name = comp.tool_comp;
          if (!name) return null;
          const data = await fetchCompJson(name);
          if (!data) return null;
          return jsonToSvgContent(data, comp, i, g);
        })
      );
      compSvgStrings = results;
    })();
  });

  const geo = $derived.by(() => {
    if (!wson) return null;

    const strataW = displayOpts.showLeftTrack ? 110 : 0;
    const diaScale = displayOpts.xDiaScale;

    const src = getSrc() ?? wson;
    const oh = src.oh ?? src.openHole ?? [];
    const ch = src.ch ?? src.casedHole ?? [];
    const cem = src.cementing ?? [];
    const str = src.strata ?? [];
    const perf = src.perforations ?? [];
    const completionsRaw = src.completions ?? [];

    // ── Profile detection (for UI indicator only) ───────────────────────────
    const rawProfile = src.profile ?? src.wellProfile ?? src.survey ?? src.trajectory ?? [];
    const hasProfileData = rawProfile.length >= 2 || (dirData?.prNorm?.length ?? 0) > 0;

    // Use arc-slerp segments from /api/schematic response (dirData)
    // prNorm = normal MD segments, prAuto = autoscale-remapped segments
    const segments = displayOpts.autoScale
      ? (dirData?.prAuto ?? dirData?.prNorm ?? [])
      : (dirData?.prNorm ?? []);
    const dtx = dirData?.dtx ?? null;

    const wellDir = new WellDirection(segments);
    const hasDir  = wellDir.hasDeviation && displayOpts.directional;

    const maxBitSize = oh.length ? Math.max(...oh.map(s => s.bitSize)) : 20;
    const maxOD = ch.length ? Math.max(...ch.map(c => c.od)) : maxBitSize;
    const maxR = Math.max(maxBitSize, maxOD) / 2;

    const allD = [
      ...oh.map(s => s.bot),
      ...ch.map(c => c.bot),
      ...str.map(s => s.top),
      ...perf.map(p => p.bot),
    ];
    const maxDepth = allD.length ? Math.max(...allD) + 50 : 1000;

    const autoYScale = Math.min(Math.max(400 / maxDepth, 0.08), 0.35);
    const yScale = displayOpts.autoScale ? autoYScale : displayOpts.yScale;

    // ── Compute canvas extents accounting for well deviation ──────────────
    let maxNorthing = 0, minNorthing = 0, maxTVD = maxDepth;
    if (hasDir) {
      const steps = 100;
      for (let i = 0; i <= steps; i++) {
        const [n, tvd] = wellDir.dirWarp([0, maxDepth * i / steps]);
        maxNorthing = Math.max(maxNorthing, n);
        minNorthing = Math.min(minNorthing, n);
        maxTVD      = Math.max(maxTVD, tvd);
      }
    }
    const leftShift  = hasDir ? Math.max(0, -minNorthing * yScale) : 0;
    const rightShift = hasDir ? Math.max(0,  maxNorthing * yScale) : 0;

    const centerX = strataW + RULER_W + maxR * diaScale + 20 + leftShift;
    const totalW  = centerX + maxR * diaScale + 160 + rightShift;
    const totalH  = HEADER_H + (hasDir ? maxTVD : maxDepth) * yScale + 40;

    // ── Coordinate helpers ────────────────────────────────────────────────
    const sy  = d => HEADER_H + d * yScale;
    const sxR = r => centerX + r * diaScale;
    const sxL = r => centerX - r * diaScale;

    // Unified depth→SVG-y (uses DTX autoscale when straight, arc TVD when directional)
    const syD = (md) => {
      const [svgX, svgY] = txPoint(0, md, hasDir ? wellDir : null, dtx, yScale, diaScale, centerX, displayOpts.autoScale);
      return svgY;
    };

    // Build SVG polygon for a directionally-warped section (uses txPoint internally)
    const dirPath = (top, bot, rL, rR, steps = 30) =>
      buildDirPath(top, bot, rL, rR, hasDir ? wellDir : null, dtx, yScale, diaScale, centerX, displayOpts.autoScale, steps);

    // One side of an annular region
    const dirSide = (top, bot, rIn, rOut, sign, steps = 30) =>
      buildDirSide(top, bot, rIn, rOut, sign, hasDir ? wellDir : null, dtx, yScale, diaScale, centerX, displayOpts.autoScale, steps);

    // Wellbore axis centerline path (directional mode)
    const dirAxis = hasDir ? (() => {
      const pts = [];
      for (let i = 0; i <= 80; i++) {
        const md = maxDepth * i / 80;
        const [cx, cy] = txPoint(0, md, wellDir, dtx, yScale, diaScale, centerX, displayOpts.autoScale);
        pts.push(`${i === 0 ? 'M' : 'L'}${cx.toFixed(1)},${cy.toFixed(1)}`);
      }
      return pts.join(' ');
    })() : null;

    const wellName =
      wson.inputHeader?.wellName?.value ??
      wson.inputHeader?.WELL?.value ??
      src.inputHeader?.wellName?.value ??
      src.inputHeader?.WELL?.value ??
      wson.wellName ?? src.wellName ?? tab.name ?? 'Well Schematic';

    const niceInterval = (() => {
      const raw = maxDepth / 8;
      const exp = Math.pow(10, Math.floor(Math.log10(raw || 1)));
      return [1, 2, 5, 10].map(m => m * exp).find(m => maxDepth / m <= 12) ?? raw;
    })();
    const rulerTicks = [];
    for (let d = 0; d <= maxDepth; d += niceInterval) rulerTicks.push(d);

    let compCursor = 0;
    const completions = completionsRaw.map(c => {
      // Support both absolute top/bot depths (dlis format) and cumulative length format
      if (c.top != null && c.bot != null) {
        return { ...c, _top: +c.top, _bot: +c.bot };
      }
      const _top = compCursor;
      compCursor += +(c.length ?? 0);
      return { ...c, _top, _bot: compCursor };
    });

    return { oh, ch, cem, str, perf, completions, maxDepth, yScale, diaScale, centerX,
             totalW, totalH, sy, syD, sxR, sxL, wellName, rulerTicks, maxR, strataW,
             hasDir, dirPath, dirSide, dirAxis, hasProfileData, wellDir, dtx,
             autoScale: displayOpts.autoScale };
  });

  async function loadFile() {
    try {
      loading = true;
      error   = '';
      let bytes;
      if (tab.file) {
        bytes = await tab.file.arrayBuffer();
      } else if (tab.driveId) {
        const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`);
        if (!res.ok) throw new Error(`Drive fetch failed: HTTP ${res.status}`);
        bytes = await res.arrayBuffer();
      } else {
        throw new Error('No file source provided');
      }
      const text = new TextDecoder().decode(bytes);
      wson = JSON.parse(text);

      // Fetch directional segments + autoscale DTX from server
      await fetchDirData();
    } catch (e) {
      error = e.message ?? String(e);
    } finally {
      loading = false;
    }
  }

  async function fetchDirData() {
    try {
      const src = getSrc();
      if (!src) return;

      // Extract survey — dlis uses {md, dev, az}, legacy uses {md, inc, az}
      const rawProfile = src.profile ?? src.wellProfile ?? src.survey ?? src.trajectory ?? [];
      const survey = rawProfile.map(p => ({
        md:  +(p.md  ?? p.MD  ?? 0),
        dev: +(p.dev ?? p.inc ?? p.INC ?? p.inclination ?? 0),
        az:  +(p.az  ?? p.AZ  ?? p.azimuth ?? 0)
      })).filter(p => p.md >= 0).sort((a, b) => a.md - b.md);

      // Build nodes from completions + perforations for autoscale magnification
      const nodes = [];
      const comps  = src.completions ?? [];
      const perfs  = src.perforations ?? [];
      let cursor = 0;
      for (const c of comps) {
        // Support absolute top/bot (dlis format) or cursor+length (legacy format)
        if (c.top != null && c.bot != null && +c.bot > +c.top) {
          nodes.push({ start: +c.top, end: +c.bot });
        } else {
          const len = +(c.length ?? c.len ?? 0);
          if (len > 0) { nodes.push({ start: cursor, end: cursor + len }); cursor += len; }
        }
      }
      for (const p of perfs) {
        if (p.top != null && p.bot != null && +p.bot > +p.top) {
          nodes.push({ start: +p.top, end: +p.bot });
        }
      }
      // Default node covering full depth if nothing found (like dlis does)
      if (nodes.length === 0 && maxDepth > 0) {
        nodes.push({ start: 0, end: maxDepth });
      }

      const allD = [
        ...(src.oh ?? src.openHole ?? []).map(s => s.bot),
        ...(src.ch ?? src.casedHole ?? []).map(c => c.bot),
      ];
      const maxDepth = allD.length ? Math.max(...allD) + 50 : 3000;

      const res = await fetch('/api/schematic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'autonodes', nodes, maxDepth, survey })
      });
      if (res.ok) {
        dirData = await res.json();
      }
    } catch (e) {
      console.warn('[WsonApp] fetchDirData failed:', e);
    }
  }

  onMount(loadFile);

  // (drag handled by FloatingPanel)
  function onDragEnd() {
  }

  // Helpers — normalise WSON structure (supports dlis config.* format + legacy flat format)
  function getSrc() {
    if (!wson) return null;
    // dlis format: { config: { openHole, casedHole, ... } }
    if (wson.config && (wson.config.openHole || wson.config.casedHole)) return wson.config;
    // legacy formats
    return wson.wellData?.[0] ?? wson;
  }

  function toggleEditPanel(panel) {
    if (showSchematicEditor && schematicTab === panel) {
      showSchematicEditor = false;
    } else {
      schematicTab = panel;
      showSchematicEditor = true;
    }
    editIdx = -1;
    editData = {};
  }

  function startEditRow(idx, row) {
    editIdx = idx;
    editData = { ...row };
  }

  function cancelEdit() {
    editIdx = -1;
    editData = {};
  }

  // OH functions
  function addOHRow() {
    const src = getSrc();
    if (!src) return;
    src.oh = [...(src.oh ?? []), { bitSize: 12.25, top: 0, bot: 500 }];
  }

  function saveOHRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.oh = src.oh.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1;
    editData = {};
  }

  function deleteOHRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.oh = src.oh.filter((_, i) => i !== idx);
  }

  // CH functions
  function addCHRow() {
    const src = getSrc();
    if (!src) return;
    src.ch = [...(src.ch ?? []), { od: 9.625, grade: 'L80', weight: 40, top: 0, bot: 2500 }];
  }

  function saveCHRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.ch = src.ch.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1;
    editData = {};
  }

  function deleteCHRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.ch = src.ch.filter((_, i) => i !== idx);
  }

  // Cementing functions
  function addCemRow() {
    const src = getSrc();
    if (!src) return;
    src.cementing = [...(src.cementing ?? []), { od: 9.625, top: 0, bot: 2500 }];
  }

  function saveCemRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.cementing = src.cementing.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1;
    editData = {};
  }

  function deleteCemRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.cementing = src.cementing.filter((_, i) => i !== idx);
  }

  // Strata functions
  function addStrataRow() {
    const src = getSrc();
    if (!src) return;
    src.strata = [...(src.strata ?? []), { strata: 'New Layer', top: 0, color: '#aaaaaa' }];
  }

  function saveStrataRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.strata = src.strata.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1;
    editData = {};
  }

  function deleteStrataRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.strata = src.strata.filter((_, i) => i !== idx);
  }

  // Download
  function downloadWson() {
    if (!wson) return;
    const data = JSON.stringify(wson, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (tab.name || 'schematic') + '.wson';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Helpers
  function ohForDepth(d, oh) {
    for (const s of oh) {
      if (d >= s.top - 1 && d <= s.bot + 1) return s;
    }
    return null;
  }

  function textColor(hex) {
    const h = (hex ?? '#888').replace('#', '').padEnd(6, '0');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 140 ? '#111' : '#eee';
  }

  function perfArrows(perf, wellDir, dtx, yS, dS, cX, autoS) {
    let paths = '';
    const intervals = Math.max(1, Math.round((perf.bot - perf.top) / PERF_DIST));
    const tip = (perf.perfID ?? 7) / 2;
    const ext = tip + 5;
    const pt = (x, y) => txPoint(x, y, wellDir, dtx, yS, dS, cX, autoS);
    for (let i = 0; i < intervals; i++) {
      const t   = perf.top + PERF_DIST * i;
      const mid = t + PERF_DIST / 2;
      const b   = Math.min(t + PERF_DIST, perf.bot);
      const [lx1,ly1] = pt(-tip, t);   const [lx2,ly2] = pt(-ext, mid); const [lx3,ly3] = pt(-tip, b);
      const [rx1,ry1] = pt( tip, t);   const [rx2,ry2] = pt( ext, mid); const [rx3,ry3] = pt( tip, b);
      paths += `M${lx1.toFixed(1)},${ly1.toFixed(1)} L${lx2.toFixed(1)},${ly2.toFixed(1)} L${lx3.toFixed(1)},${ly3.toFixed(1)} Z `;
      paths += `M${rx1.toFixed(1)},${ry1.toFixed(1)} L${rx2.toFixed(1)},${ry2.toFixed(1)} L${rx3.toFixed(1)},${ry3.toFixed(1)} Z `;
    }
    return paths;
  }

  function cementRects(cem, oh, sy, sxL, sxR) {
    const rects = [];
    for (const c of cem) {
      const ohSec   = ohForDepth((c.top + c.bot) / 2, oh);
      if (!ohSec) continue;
      const holeR   = ohSec.bitSize / 2;
      const casingR = c.od / 2;
      if (holeR <= casingR) continue;
      rects.push({ top: c.top, bot: c.bot, holeR, casingR });
    }
    return rects;
  }

  function compTypeOf(comp) {
    const key = ((comp.tool_comp ?? '') + ' ' + (comp.description ?? '')).toLowerCase();
    if (key.includes('hanger'))  return 'hanger';
    if (key.includes('packer'))  return 'packer';
    if (key.includes('ina') || key.includes('icd') || key.includes('inflow') || key.includes('nozzle')) return 'icd';
    if (key.includes('liner'))   return 'liner';
    return 'tubing';
  }

  // ── 3D vector math helpers ───────────────────────────────────────────────
  const _dot3  = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const _norm3 = v => { const m = Math.sqrt(_dot3(v,v)); return m > 0 ? v.map(x => x/m) : v; };
  function _slerp3(v1, v2, t) {
    const d  = Math.max(-1, Math.min(1, _dot3(v1, v2)));
    const th = Math.acos(d);
    if (th < 1e-10) return [...v1];
    const st = Math.sin(th);
    return v1.map((_, i) => v1[i]*Math.sin((1-t)*th)/st + v2[i]*Math.sin(t*th)/st);
  }

  // ── WellDirection: arc-slerp (mirrors dlis Direction.svelte.ts) ──────────
  class WellDirection {
    constructor(segments) { this.segments = segments ?? []; }

    getSegment(md) {
      for (const s of this.segments) if (md >= s.md1 && md < s.md2) return s;
      return this.segments[this.segments.length - 1] ?? null;
    }

    // [northing, tvd] — mirrors dirWarp([x=0, y]) for centerline; x in warped-meters for offset
    dirWarp([x, y]) {
      const seg = this.getSegment(y);
      if (!seg) return null;
      const t    = Math.max(0, Math.min(1, (y - seg.md1) / (seg.md2 - seg.md1)));
      const sv   = _slerp3(seg.q1u, seg.q2u, t);
      const sc   = seg.radCurvature - seg.dirMult * x;
      return [seg.ptPivot[0] + sc * sv[0], seg.ptPivot[2] + sc * sv[2]]; // [N, TVD]
    }

    // Perpendicular vectors in 2D (mirrors dlis getPerpendicular2D)
    getPerpendicular2D(md) {
      const seg = this.getSegment(md);
      if (!seg) return null;
      const t   = Math.max(0, Math.min(1, (md - seg.md1) / (seg.md2 - seg.md1)));
      const qT  = _slerp3(seg.q1u, seg.q2u, t);
      const nrm = qT.map(x => -x);                              // inward normal = -qT
      const [rx, ry, rz] = seg.rotAxis, [nx, , nz] = nrm;
      // tangent = cross(norm, rotAxis); use only x,z for 2D N-TVD plane
      const tangent = _norm3([nrm[1]*rz - nrm[2]*ry, nrm[2]*rx - nrm[0]*rz, nrm[0]*ry - nrm[1]*rx]);
      const [tx, , tz] = tangent;
      const mag = Math.hypot(tx, tz) || 1;
      return {
        pos: [ tz/mag, -tx/mag],   // +x (right): 90° CW of tangent in N-TVD
        neg: [-tz/mag,  tx/mag]    // -x (left):  90° CCW
      };
    }

    get hasDeviation() { return this.segments.length > 0; }
  }

  // ── DTX linear interpolation (replaces everpolate.linear) ────────────────
  function _lerpDTX(d, depth, depthTx) {
    if (!depth?.length) return d;
    if (d <= depth[0]) return depthTx[0];
    const last = depth.length - 1;
    if (d >= depth[last]) return depthTx[last];
    for (let i = 1; i <= last; i++) {
      if (d <= depth[i]) {
        const t = (d - depth[i-1]) / (depth[i] - depth[i-1]);
        return depthTx[i-1] + t * (depthTx[i] - depthTx[i-1]);
      }
    }
    return d;
  }

  // ── txPoint: unified [svgX, svgY] transform (mirrors Canvas.txForm) ──────
  function txPoint(xInches, yMD, wellDir, dtx, yS, dS, cX, autoS) {
    const scR = dS / yS; // inch → meter conversion
    if (wellDir?.hasDeviation) {
      const yW = autoS && dtx ? _lerpDTX(yMD, dtx.depth, dtx.depthTx) : yMD;
      const ctr = wellDir.dirWarp([0, yW]);
      if (!ctr) return [cX + xInches * dS, HEADER_H + yMD * yS];
      if (xInches === 0) return [cX + ctr[0] * yS, HEADER_H + ctr[1] * yS];
      const perps = wellDir.getPerpendicular2D(yW);
      const perp  = xInches >= 0 ? perps?.pos : perps?.neg;
      const offM  = Math.abs(xInches * scR);
      return [cX + (ctr[0] + (perp?.[0]??0)*offM) * yS,
              HEADER_H + (ctr[1] + (perp?.[1]??0)*offM) * yS];
    }
    const yPx = autoS && dtx
      ? _lerpDTX(yMD, dtx.depth, dtx.depthTx) * yS
      : yMD * yS;
    return [cX + xInches * dS, HEADER_H + yPx];
  }

  // ── buildDirPath: SVG polygon for a warped section ───────────────────────
  function buildDirPath(top, bot, rL, rR, wellDir, dtx, yS, dS, cX, autoS, steps = 30) {
    const L = [], R = [];
    for (let i = 0; i <= steps; i++) {
      const md = top + (bot - top) * i / steps;
      L.push(txPoint(-rL,  md, wellDir, dtx, yS, dS, cX, autoS));
      R.push(txPoint( rR,  md, wellDir, dtx, yS, dS, cX, autoS));
    }
    const pts = [...L, ...R.reverse()];
    return pts.map((p, i) => `${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
  }

  // ── buildDirSide: one side of an annular region ───────────────────────────
  function buildDirSide(top, bot, rIn, rOut, sign, wellDir, dtx, yS, dS, cX, autoS, steps = 30) {
    const I = [], O = [];
    for (let i = 0; i <= steps; i++) {
      const md = top + (bot - top) * i / steps;
      I.push(txPoint(sign * rIn,  md, wellDir, dtx, yS, dS, cX, autoS));
      O.push(txPoint(sign * rOut, md, wellDir, dtx, yS, dS, cX, autoS));
    }
    const pts = [...I, ...O.reverse()];
    return pts.map((p, i) => `${i===0?'M':'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') + ' Z';
  }

</script>

{#if loading}
  <div class="flex items-center justify-center h-48 text-gray-400 text-sm">Loading schematic…</div>
{:else if error}
  <div class="p-4 text-red-600 text-sm">
    <p class="font-semibold">Failed to load WSON file</p>
    <p class="mt-1">{error}</p>
  </div>
{:else if geo}
  {@const { oh, ch, cem, str, perf, completions, sy, syD, sxL, sxR, wellName, rulerTicks, totalW, totalH, centerX, strataW, hasDir, dirPath, dirSide, dirAxis, hasProfileData, wellDir, dtx, yScale, diaScale } = geo}

  {#snippet layerRow(label, active, toggle, editKey, iconHtml)}
    <div class="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
      <span class="text-gray-500 flex-shrink-0">{@html iconHtml}</span>
      <span class="text-xs font-medium text-gray-700 flex-1">{label}</span>
      <button
        class="w-8 h-4 rounded-full transition-colors flex-shrink-0 relative {active ? 'bg-blue-500' : 'bg-gray-300'}"
        onclick={toggle}
        aria-label="Toggle {label}"
      >
        <span class="absolute top-0.5 {active ? 'left-4' : 'left-0.5'} w-3 h-3 bg-white rounded-full shadow transition-all"></span>
      </button>
      {#if editKey}
        <button
          class="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:bg-blue-50 hover:text-blue-600 text-xs flex-shrink-0 {showSchematicEditor && schematicTab === editKey ? 'bg-blue-100 text-blue-600' : ''}"
          onclick={() => toggleEditPanel(editKey)}
          aria-label="Edit {label}"
        >✎</button>
      {:else}
        <span class="w-6 flex-shrink-0"></span>
      {/if}
    </div>
  {/snippet}

  <!-- Info bar -->
  {#if showInfoBar}
    <div class="flex items-center gap-4 px-3 py-1.5 text-xs text-gray-500 border-b border-gray-200 flex-wrap">
      <span class="font-semibold text-gray-700">{wellName}</span>
      {#if oh.length}<span>OH: {oh.length}</span>{/if}
      {#if ch.length}<span>Casing: {ch.length}</span>{/if}
      {#if cem.length}<span>Cement: {cem.length}</span>{/if}
      {#if completions.length}<span>Completions: {completions.length}</span>{/if}
      {#if perf.length}<span>Perforations: {perf.length}</span>{/if}
      {#if str.length}<span>Strata: {str.length}</span>{/if}
      <button onclick={downloadWson} class="ml-auto px-2 py-0.5 rounded text-xs bg-green-800 text-white hover:bg-green-700">↓ Save</button>
    </div>
  {/if}

  <!-- Main layout -->
  <div class="flex overflow-hidden relative" style="height: calc(100% - {showInfoBar ? 30 : 0}px)">

    <!-- Toolbar -->
    <div class="schematic-toolbar">
      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showInfoBar} onclick={() => (showInfoBar = !showInfoBar)} aria-label="Info">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><line x1="8" y1="7" x2="8" y2="11"/><circle cx="8" cy="5.5" r="0.6" fill="currentColor"/></svg>
        </button>
        <span class="tb-tip">Info</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showLayersPanel} onclick={() => (showLayersPanel = !showLayersPanel)} aria-label="Layers">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3.5"/><ellipse cx="8" cy="8" rx="7" ry="3.5"/><line x1="1" y1="8" x2="15" y2="8"/></svg>
        </button>
        <span class="tb-tip">Layers</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showSchematicEditor} onclick={() => { showSchematicEditor = !showSchematicEditor; editIdx = -1; editData = {}; }} aria-label="Edit Schematic">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2l3 3-8 8H3v-3L11 2z"/><line x1="9" y1="4" x2="12" y2="7"/></svg>
        </button>
        <span class="tb-tip">Edit</span>
      </div>

      <div class="flex-1"></div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showDisplayOpts} onclick={() => (showDisplayOpts = !showDisplayOpts)} aria-label="Display">⚙</button>
        <span class="tb-tip">Display</span>
      </div>
    </div>

    <!-- SVG area -->
    <div class="overflow-auto bg-white flex-1">
      <svg width={totalW} height={totalH} xmlns="http://www.w3.org/2000/svg" class="font-mono" style="display:block">
        <defs>
          <pattern id="cement-fill" x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="#e8e8e8"/>
            <circle cx="3" cy="3" r="1.2" fill="#888"/>
          </pattern>
          <pattern id="icd-fill" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#dbeafe"/>
            <circle cx="4" cy="4" r="1" fill="#2563eb"/>
          </pattern>
        </defs>

        <rect x="0" y="0" width={totalW} height={HEADER_H} fill="#1e3a5f"/>
        <text x={totalW / 2} y={HEADER_H / 2 + 6} text-anchor="middle" fill="white" font-size="14" font-weight="bold" font-family="sans-serif">{wellName}</text>

        {#if showStrata && strataW > 0}
          {#each str as s, i}
            {@const top = syD(s.top)}
            {@const bot = i < str.length - 1 ? syD(str[i + 1].top) : syD(geo.maxDepth)}
            {@const h = bot - top}
            <rect x="0" y={top} width={strataW} height={h} fill={s.color ?? '#aaa'} stroke="#333" stroke-width="0.5"/>
            {#if h > 14}
              <text x="4" y={top + 13} font-size="9" fill={textColor(s.color ?? '#aaa')} font-family="sans-serif">{s.strata}</text>
              <text x="4" y={top + 22} font-size="8" fill={textColor(s.color ?? '#aaa')} font-family="sans-serif">{s.top.toFixed(0)}m</text>
            {/if}
          {/each}
        {/if}

        <rect x={strataW} y={HEADER_H} width={RULER_W} height={totalH - HEADER_H} fill="#f0f0f0" stroke="#ccc" stroke-width="0.5"/>
        {#each rulerTicks as d}
          {@const y = syD(d)}
          <line x1={strataW} y1={y} x2={strataW + RULER_W} y2={y} stroke="#999" stroke-width="0.8"/>
          <text x={strataW + RULER_W - 3} y={y + 4} font-size="8" text-anchor="end" fill="#444" font-family="sans-serif">{d}{hasDir ? '↕' : ''}</text>
        {/each}

        {#if hasDir && dirAxis}
          <path d={dirAxis} stroke="#aaa" stroke-width="0.5" stroke-dasharray="4 4" fill="none"/>
        {:else}
          <line x1={centerX} y1={HEADER_H} x2={centerX} y2={totalH} stroke="#aaa" stroke-width="0.5" stroke-dasharray="4 4"/>
        {/if}

        {#if showOpenHole}
          {#each oh as s}
            {#if hasDir && dirPath}
              <path d={dirPath(s.top, s.bot, s.bitSize / 2, s.bitSize / 2)} fill="#f3e8ff" stroke="#9333ea" stroke-width="1" stroke-dasharray="5 3"/>
            {:else}
              {@const x = sxL(s.bitSize / 2)}
              {@const w = sxR(s.bitSize / 2) - x}
              {@const y = sy(s.top)}
              {@const ht = sy(s.bot) - y}
              <rect {x} {y} width={w} height={ht} fill="#f3e8ff" stroke="#9333ea" stroke-width="1" stroke-dasharray="5 3"/>
              <text x={sxR(s.bitSize / 2) + 3} y={y + 10} font-size="8" fill="#7c3aed" font-family="sans-serif">{s.bitSize}"</text>
            {/if}
          {/each}
        {/if}

        {#if showCement}
          {#each cementRects(cem, oh, sy, sxL, sxR) as cr}
            {#if hasDir && dirSide}
              <path d={dirSide(cr.top, cr.bot, cr.casingR, cr.holeR, -1)} fill="url(#cement-fill)"/>
              <path d={dirSide(cr.top, cr.bot, cr.casingR, cr.holeR,  1)} fill="url(#cement-fill)"/>
            {:else}
              {@const y = sy(cr.top)}
              {@const ht = sy(cr.bot) - y}
              <rect x={sxL(cr.holeR)} y={y} width={sxL(cr.casingR) - sxL(cr.holeR)} height={ht} fill="url(#cement-fill)"/>
              <rect x={sxR(cr.casingR)} y={y} width={sxR(cr.holeR) - sxR(cr.casingR)} height={ht} fill="url(#cement-fill)"/>
            {/if}
          {/each}
        {/if}

        {#if showCasing}
          {#each ch as c}
            {#if hasDir && dirPath}
              <path d={dirPath(c.top, c.bot, c.od / 2, c.od / 2)} fill="azure" stroke="#111" stroke-width="1.5"/>
            {:else}
              {@const x = sxL(c.od / 2)}
              {@const w = sxR(c.od / 2) - x}
              {@const y = sy(c.top)}
              {@const ht = sy(c.bot) - y}
              <rect {x} {y} width={w} height={ht} fill="azure" stroke="#111" stroke-width="1.5"/>
              {#if c.grade}
                <text x={sxR(c.od / 2) + 4} y={y + 22} font-size="8" fill="#1e40af" font-family="sans-serif">{c.od}" {c.grade}</text>
              {/if}
            {/if}
          {/each}
        {/if}

        {#if showCompletions}
          {#each completions as comp, i}
            {@const r = (comp.od ?? 2.875) / 2}
            {@const rOuter = r * (comp.od_multiplier ?? 1.2)}
            {@const type = compTypeOf(comp)}

            {#if hasDir && dirPath}
              <!-- Directional completions -->
              {#if compSvgStrings[i]}
                {@html compSvgStrings[i]}
              {:else if type === 'packer'}
                <path d={dirPath(comp._top, comp._bot, rOuter, rOuter)} fill="#f59e0b" stroke="#b45309" stroke-width="0.8" opacity="0.9"/>
              {:else if type === 'icd'}
                <path d={dirPath(comp._top, comp._bot, r, r)} fill="url(#icd-fill)" stroke="#2563eb" stroke-width="1"/>
              {:else if type === 'liner'}
                <path d={dirPath(comp._top, comp._bot, r, r)} fill="#f0fdf4" stroke="#16a34a" stroke-width="1.2"/>
              {:else}
                <path d={dirPath(comp._top, comp._bot, r, r)} fill="#334155" stroke="#334155" stroke-width="1"/>
              {/if}
            {:else}
              <!-- Straight completions -->
              {@const ytop = sy(comp._top)}
              {@const ybot = sy(comp._bot)}
              {@const xL = sxL(r)}
              {@const xR = sxR(r)}
              {@const xOL = sxL(rOuter)}
              {@const xOR = sxR(rOuter)}
              {@const ymid = (ytop + ybot) / 2}

              {#if compSvgStrings[i]}
                {@html compSvgStrings[i]}
              {:else if type === 'packer'}
                <polygon points="{xOL},{ytop} {xOR},{ytop} {centerX},{ymid}" fill="#f59e0b" stroke="#b45309" stroke-width="0.8" opacity="0.9"/>
                <polygon points="{xOL},{ybot} {xOR},{ybot} {centerX},{ymid}" fill="#f59e0b" stroke="#b45309" stroke-width="0.8" opacity="0.9"/>
                <line x1={xOL} y1={ymid} x2={xOR} y2={ymid} stroke="#b45309" stroke-width="1"/>
              {:else if type === 'hanger'}
                {@const rWide = r * (comp.od_multiplier ?? 1.5)}
                <polygon points="{sxL(rWide)},{ytop} {sxR(rWide)},{ytop} {xR},{ybot} {xL},{ybot}" fill="#94a3b8" stroke="#475569" stroke-width="1"/>
              {:else if type === 'icd'}
                <rect x={xL} y={ytop} width={xR - xL} height={ybot - ytop} fill="url(#icd-fill)" stroke="#2563eb" stroke-width="1"/>
                <line x1={xL} y1={ytop} x2={xL} y2={ybot} stroke="#1d4ed8" stroke-width="1.5"/>
                <line x1={xR} y1={ytop} x2={xR} y2={ybot} stroke="#1d4ed8" stroke-width="1.5"/>
              {:else if type === 'liner'}
                <rect x={xL} y={ytop} width={xR - xL} height={ybot - ytop} fill="#f0fdf4" stroke="#16a34a" stroke-width="1.2"/>
              {:else}
                <rect x={xL - 1.5} y={ytop} width="3" height={ybot - ytop} fill="#334155"/>
                <rect x={xR - 1.5} y={ytop} width="3" height={ybot - ytop} fill="#334155"/>
              {/if}

              {#if comp.description && (ybot - ytop) > 10}
                <text x={xOR + 6} y={(ytop + ybot) / 2 + 4} font-size="8" fill="#374151" font-family="sans-serif">{comp.description}</text>
              {/if}
            {/if}
          {/each}
        {/if}

        {#if showPerforations}
          {#each perf as p}
            <path d={perfArrows(p, hasDir ? wellDir : null, dtx, yScale, diaScale, centerX, displayOpts.autoScale)} fill={p.color ?? '#e53e3e'} stroke="none" opacity="0.85"/>
          {/each}
        {/if}

        {#if oh.length}
          {@const tdDepth = Math.max(...oh.map(s => s.bot))}
          {@const tdY = syD(tdDepth)}
          <line x1={sxL(2)} y1={tdY} x2={sxR(2)} y2={tdY} stroke="#dc2626" stroke-width="2"/>
          <text x={sxR(2) + 4} y={tdY + 4} font-size="9" fill="#dc2626" font-family="sans-serif">TD {tdDepth}m</text>
        {/if}
      </svg>
    </div>

    <!-- Display Options Popup -->
    <FloatingPanel title="Display Options" visible={showDisplayOpts} onClose={() => (showDisplayOpts = false)} width={240} x={60} y={60}>
      {#snippet children()}
        <div class="px-1 py-1 flex flex-col space-y-1 overflow-y-auto">
          <div class="px-1 pt-1 pb-0">
            <div class="grid grid-cols-3 rounded border border-gray-800 p-1">
              <div class="text-xs self-center">To Scale</div>
              <input type="checkbox" bind:checked={displayOpts.autoScale} class="mx-auto accent-orange-500"/>
              <div class="text-xs self-center">Autoscale</div>
            </div>
          </div>

          <div class="px-1 pt-0 pb-1">
            <div class="grid grid-cols-3 rounded border border-gray-800 p-1">
              <div class="text-xs self-center">
                Directional
                {#if geo?.hasProfileData}
                  <span class="text-green-600 ml-1" title="Survey data available">✓</span>
                {:else}
                  <span class="text-gray-400 ml-1" title="No survey data in file">✗</span>
                {/if}
              </div>
              <input type="checkbox" bind:checked={displayOpts.directional} class="mx-auto accent-orange-500"
                     disabled={!geo?.hasProfileData}/>
              <div class="text-xs self-center">Straight</div>
            </div>
          </div>

          <div class="flex gap-1 p-1">
            <div class="flex-1 rounded border border-gray-800 p-1">
              <div class="text-xs text-center mb-1 font-medium">X Scale</div>
              <div class="flex items-center gap-1">
                <button onclick={() => displayOpts.xScale = Math.max(0.05, displayOpts.xScale - 0.025)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">-</button>
                <input type="range" bind:value={displayOpts.xScale} min="0.05" max="0.5" step="0.025" class="flex-1 h-1 bg-gray-200 rounded accent-orange-500"/>
                <button onclick={() => displayOpts.xScale = Math.min(0.5, displayOpts.xScale + 0.025)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">+</button>
              </div>
              <div class="text-xs text-center mt-1">{displayOpts.xScale.toFixed(2)}</div>
            </div>

            <div class="flex-1 rounded border border-gray-800 p-1">
              <div class="text-xs text-center mb-1 font-medium">Y Scale</div>
              <div class="flex items-center gap-1">
                <button onclick={() => displayOpts.yScale = Math.max(0.05, displayOpts.yScale - 0.025)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">-</button>
                <input type="range" bind:value={displayOpts.yScale} min="0.05" max="0.5" step="0.025" class="flex-1 h-1 bg-gray-200 rounded accent-orange-500"/>
                <button onclick={() => displayOpts.yScale = Math.min(0.5, displayOpts.yScale + 0.025)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">+</button>
              </div>
              <div class="text-xs text-center mt-1">{displayOpts.yScale.toFixed(2)}</div>
            </div>
          </div>

          <div class="p-1 rounded border border-gray-800">
            <div class="text-xs text-center mb-1 font-medium">Dia Scale</div>
            <div class="flex items-center gap-1">
              <button onclick={() => displayOpts.xDiaScale = Math.max(2, displayOpts.xDiaScale - 0.5)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">-</button>
              <input type="range" bind:value={displayOpts.xDiaScale} min="2" max="15" step="0.5" class="flex-1 h-1 bg-gray-200 rounded accent-orange-500"/>
              <button onclick={() => displayOpts.xDiaScale = Math.min(15, displayOpts.xDiaScale + 0.5)} class="px-1 py-0.5 bg-orange-500 text-white rounded text-xs hover:bg-orange-600">+</button>
            </div>
            <div class="text-xs text-center mt-1">{displayOpts.xDiaScale.toFixed(1)}</div>
          </div>

          <div class="p-1 grid grid-cols-4 rounded border border-gray-800">
            <div class="col-span-2 text-xs self-center font-medium">Preserve Aspect</div>
            <input type="checkbox" bind:checked={displayOpts.preserveAspectRatio} class="col-span-2 accent-orange-500"/>
          </div>

          <div class="p-1 grid grid-cols-3 rounded border border-gray-800">
            <div class="text-xs self-center">Hide Plot</div>
            <input type="checkbox" bind:checked={displayOpts.showLeftTrack} class="mx-auto accent-orange-500"/>
            <div class="text-xs self-center">Show Plot</div>
          </div>
        </div>
      {/snippet}
    </FloatingPanel>

    <!-- Schematic Editor (tabbed: OH | CH | Cement | Strata) -->
    <FloatingPanel
      title="Schematic Editor"
      visible={showSchematicEditor}
      onClose={() => { showSchematicEditor = false; editIdx = -1; editData = {}; }}
      width={360}
      x={60}
      y={90}
    >
      {#snippet children()}
        <!-- Tab bar -->
        <div class="flex items-stretch border-b border-slate-200 bg-slate-50/60">
          {#each [['oh','Open Hole','⬜'],['ch','Casing','▭'],['cem','Cement','⬛'],['strata','Strata','≡']] as [key, label, icon]}
            <button
              class="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold transition-all border-r border-slate-200/70
                {schematicTab === key
                  ? 'text-blue-700 bg-white border-b-2 border-b-blue-600'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}"
              onclick={() => { schematicTab = key; editIdx = -1; editData = {}; }}
            >{icon} {label}</button>
          {/each}
        </div>

        <div class="p-2 overflow-y-auto" style="max-height: 55vh">
          {#if schematicTab === 'oh'}
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Bit Size (in)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Top (m)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Bot (m)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700 w-16">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each (getSrc()?.oh ?? []) as row, i}
                  {#if editIdx === i}
                    <tr class="bg-blue-50">
                      <td class="px-1 py-1"><input type="number" bind:value={editData.bitSize} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveOHRow()}/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.top} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveOHRow()}/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.bot} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveOHRow()}/></td>
                      <td class="px-1 py-1"><div class="flex gap-1 justify-center">
                        <button onclick={saveOHRow} class="p-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs leading-none" title="Save">✓</button>
                        <button onclick={cancelEdit} class="p-1 bg-gray-400 text-white rounded hover:bg-gray-500 text-xs leading-none" title="Cancel">✕</button>
                      </div></td>
                    </tr>
                  {:else}
                    <tr class="hover:bg-slate-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                      <td class="px-2 py-1.5 text-center">{row.bitSize}"</td>
                      <td class="px-2 py-1.5 text-center">{row.top}</td>
                      <td class="px-2 py-1.5 text-center">{row.bot}</td>
                      <td class="px-2 py-1.5"><div class="flex gap-1 justify-center">
                        <button onclick={e => { e.stopPropagation(); startEditRow(i, row); }} class="p-1 text-blue-600 hover:bg-blue-50 rounded text-xs leading-none" title="Edit">✎</button>
                        <button onclick={e => { e.stopPropagation(); deleteOHRow(i); }} class="p-1 text-red-500 hover:bg-red-50 rounded text-xs leading-none" title="Delete">✕</button>
                      </div></td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            <div class="flex justify-end pt-2">
              <button onclick={addOHRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 text-xs font-medium">+ Add Row</button>
            </div>

          {:else if schematicTab === 'ch'}
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">OD (in)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Grade</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Wt (lb/ft)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Top</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Bot</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700 w-12">Act</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each (getSrc()?.ch ?? getSrc()?.casedHole ?? []) as row, i}
                  {#if editIdx === i}
                    <tr class="bg-blue-50">
                      <td class="px-1 py-1"><input type="number" bind:value={editData.od} class="w-full border border-slate-300 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveCHRow()}/></td>
                      <td class="px-1 py-1"><input type="text" bind:value={editData.grade} class="w-full border border-slate-300 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveCHRow()}/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.weight} class="w-full border border-slate-300 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveCHRow()}/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.top} class="w-full border border-slate-300 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveCHRow()}/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.bot} class="w-full border border-slate-300 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveCHRow()}/></td>
                      <td class="px-1 py-1"><div class="flex gap-1 justify-center">
                        <button onclick={saveCHRow} class="p-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs leading-none">✓</button>
                        <button onclick={cancelEdit} class="p-1 bg-gray-400 text-white rounded hover:bg-gray-500 text-xs leading-none">✕</button>
                      </div></td>
                    </tr>
                  {:else}
                    <tr class="hover:bg-slate-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                      <td class="px-2 py-1.5 text-center">{row.od}"</td>
                      <td class="px-2 py-1.5 text-center">{row.grade ?? '-'}</td>
                      <td class="px-2 py-1.5 text-center">{row.weight ?? '-'}</td>
                      <td class="px-2 py-1.5 text-center">{row.top}</td>
                      <td class="px-2 py-1.5 text-center">{row.bot}</td>
                      <td class="px-2 py-1.5"><div class="flex gap-1 justify-center">
                        <button onclick={e => { e.stopPropagation(); startEditRow(i, row); }} class="p-1 text-blue-600 hover:bg-blue-50 rounded text-xs leading-none">✎</button>
                        <button onclick={e => { e.stopPropagation(); deleteCHRow(i); }} class="p-1 text-red-500 hover:bg-red-50 rounded text-xs leading-none">✕</button>
                      </div></td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            <div class="flex justify-end pt-2">
              <button onclick={addCHRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 text-xs font-medium">+ Add Row</button>
            </div>

          {:else if schematicTab === 'cem'}
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">OD (in)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Top (m)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Bot (m)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700 w-12">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each (getSrc()?.cementing ?? []) as row, i}
                  {#if editIdx === i}
                    <tr class="bg-blue-50">
                      <td class="px-1 py-1"><input type="number" bind:value={editData.od} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveCemRow()}/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.top} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveCemRow()}/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.bot} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveCemRow()}/></td>
                      <td class="px-1 py-1"><div class="flex gap-1 justify-center">
                        <button onclick={saveCemRow} class="p-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs leading-none">✓</button>
                        <button onclick={cancelEdit} class="p-1 bg-gray-400 text-white rounded hover:bg-gray-500 text-xs leading-none">✕</button>
                      </div></td>
                    </tr>
                  {:else}
                    <tr class="hover:bg-slate-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                      <td class="px-2 py-1.5 text-center">{row.od}"</td>
                      <td class="px-2 py-1.5 text-center">{row.top}</td>
                      <td class="px-2 py-1.5 text-center">{row.bot}</td>
                      <td class="px-2 py-1.5"><div class="flex gap-1 justify-center">
                        <button onclick={e => { e.stopPropagation(); startEditRow(i, row); }} class="p-1 text-blue-600 hover:bg-blue-50 rounded text-xs leading-none">✎</button>
                        <button onclick={e => { e.stopPropagation(); deleteCemRow(i); }} class="p-1 text-red-500 hover:bg-red-50 rounded text-xs leading-none">✕</button>
                      </div></td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            <div class="flex justify-end pt-2">
              <button onclick={addCemRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 text-xs font-medium">+ Add Row</button>
            </div>

          {:else if schematicTab === 'strata'}
            <table class="w-full text-xs">
              <thead class="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th class="px-2 py-1.5 text-left font-semibold text-gray-700">Strata Name</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Top (m)</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Color</th>
                  <th class="px-2 py-1.5 text-center font-semibold text-gray-700 w-12">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                {#each (getSrc()?.strata ?? []) as row, i}
                  {#if editIdx === i}
                    <tr class="bg-blue-50">
                      <td class="px-1 py-1"><input type="text" bind:value={editData.strata} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveStrataRow()}/></td>
                      <td class="px-1 py-1"><input type="number" bind:value={editData.top} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveStrataRow()}/></td>
                      <td class="px-1 py-1"><input type="color" bind:value={editData.color} class="w-full h-7 border border-slate-300 rounded px-0.5 py-0.5 cursor-pointer"/></td>
                      <td class="px-1 py-1"><div class="flex gap-1 justify-center">
                        <button onclick={saveStrataRow} class="p-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs leading-none">✓</button>
                        <button onclick={cancelEdit} class="p-1 bg-gray-400 text-white rounded hover:bg-gray-500 text-xs leading-none">✕</button>
                      </div></td>
                    </tr>
                  {:else}
                    <tr class="hover:bg-slate-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                      <td class="px-2 py-1.5">{row.strata}</td>
                      <td class="px-2 py-1.5 text-center">{row.top}</td>
                      <td class="px-2 py-1.5">
                        <div class="w-8 h-5 rounded border border-gray-300 mx-auto" style="background-color: {row.color ?? '#aaa'}"></div>
                      </td>
                      <td class="px-2 py-1.5"><div class="flex gap-1 justify-center">
                        <button onclick={e => { e.stopPropagation(); startEditRow(i, row); }} class="p-1 text-blue-600 hover:bg-blue-50 rounded text-xs leading-none">✎</button>
                        <button onclick={e => { e.stopPropagation(); deleteStrataRow(i); }} class="p-1 text-red-500 hover:bg-red-50 rounded text-xs leading-none">✕</button>
                      </div></td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
            <div class="flex justify-end pt-2">
              <button onclick={addStrataRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 text-xs font-medium">+ Add Row</button>
            </div>
          {/if}
        </div>
      {/snippet}
    </FloatingPanel>

    <!-- Layers Panel -->
    <FloatingPanel title="Layers" visible={showLayersPanel} onClose={() => (showLayersPanel = false)} width={260} x={40} y={40}>
      {#snippet children()}
        <div class="flex flex-col divide-y divide-gray-100">
          {@render layerRow('Open Hole', showOpenHole, () => (showOpenHole = !showOpenHole), 'oh',
            `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="8" height="12" stroke-dasharray="3,2"/></svg>`)}
          {@render layerRow('Casing', showCasing, () => (showCasing = !showCasing), 'ch',
            `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="2" width="8" height="12"/></svg>`)}
          {@render layerRow('Cement', showCement, () => (showCement = !showCement), 'cem',
            `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="5" r="1.2" fill="currentColor"/><circle cx="12" cy="5" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg>`)}
          {@render layerRow('Completions', showCompletions, () => (showCompletions = !showCompletions), null,
            `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/><line x1="6" y1="5" x2="10" y2="5"/></svg>`)}
          {@render layerRow('Perforations', showPerforations, () => (showPerforations = !showPerforations), null,
            `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="5" x2="9" y2="5"/><polyline points="7,3 10,5 7,7"/></svg>`)}
          {@render layerRow('Strata', showStrata, () => (showStrata = !showStrata), 'strata',
            `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></svg>`)}
        </div>
      {/snippet}
    </FloatingPanel>

  </div>
{:else}
  <div class="p-4 text-gray-400 text-sm">No schematic data.</div>
{/if}

<style>
  .schematic-toolbar {
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
    font-weight: bold;
    font-size: 14px;
  }

  .tb-btn:hover {
    background: rgba(59, 130, 246, 0.1);
    color: #2563eb;
  }

  .tb-btn.tb-active {
    background: rgba(59, 130, 246, 0.15);
    color: #2563eb;
  }

  .tb-edit {
    font-size: 12px;
  }

  .tb-tip {
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translate(-4px, -50%);
    padding: 5px 9px;
    background: rgba(15, 23, 42, 0.92);
    color: #fff;
    border-radius: 5px;
    white-space: nowrap;
    font-size: 11px;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.15s ease, transform 0.15s ease;
    z-index: 100;
  }

  .group:hover .tb-tip {
    opacity: 1;
    visibility: visible;
    transform: translate(0, -50%);
  }
</style>
