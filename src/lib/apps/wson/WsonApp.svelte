<script module>
  // Per-tab display state cache — survives component remounts (tab switching)
  const _cache = new Map(); // tabId → { displayOpts, showOpenHole, showCasing, showCement, showCompletions, showPerforations, showStrata }

  function getCache(id) {
    return _cache.get(id) ?? {
      displayOpts: { autoScale: true, directional: false, xScale: 0.17, yScale: 0.17, xDiaScale: 6.0, preserveAspectRatio: true, showLeftTrack: true },
      showOpenHole: true, showCasing: true, showCement: true,
      showCompletions: true, showPerforations: true, showStrata: true
    };
  }
</script>

<script>
  import { onMount } from 'svelte';
  import { FloatingPanel } from '$lib/components/FloatingPanel';
  import labella from 'labella';

  const { tab } = $props();

  let loading = $state(true);
  let error   = $state('');
  let wson    = $state(null);

  // Directional + autoscale data from /api/schematic
  let dirData = $state(null); // { dtx, prNorm, prAuto }

  // ── Layout constants ─────────────────────────────────────────────────────
  const RULER_W   = 44;
  const HEADER_H  = 100;
  const PERF_DIST = 3;

  // ── Restore per-tab display state from cache ──────────────────────────────
  const cached = getCache(tab.id);

  // ── Display Options state ────────────────────────────────────────────────
  let displayOpts = $state({ ...cached.displayOpts });
  let showDisplayOpts  = $state(false);
  let showLayersPanel  = $state(false);

  // ── Toolbar visibility states ─────────────────────────────────────────────
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
      showOpenHole, showCasing, showCement,
      showCompletions, showPerforations, showStrata
    });
  });
  // ── Schematic Editor state ────────────────────────────────────────────────
  let showSchematicEditor = $state(false);
  let schematicTab = $state('oh'); // 'oh' | 'ch' | 'cem' | 'strata'
  let editIdx = $state(-1);
  let editData = $state({});

  // ── Survey Editor state ────────────────────────────────────────────────────
  let showSurveyEditor = $state(false);

  // ── Completions Editor state ──────────────────────────────────────────────
  let showCompletionsEditor = $state(false);
  let compSearch = $state('');
  let compSearchFocused = $state(false);
  let catalogResults = $state([]);   // results from /api/schematic filtercomps
  let catalogLoading = $state(false);
  let editingComp = $state(null);
  let isNewComp = $state(false);

  // ── Canvas component quick-editor (dblclick on SVG completion) ────────────
  let showCanvasCompEditor = $state(false);
  let canvasComp = $state(null);   // { ...comp, _editIdx: i }

  // ── Screen recording ─────────────────────────────────────────────────────
  let recording     = $state(false);
  let _mediaRecorder = null;
  let _recChunks     = [];

  // ── TEST SCRIPT ───────────────────────────────────────────────────────────
  // Each step: { delay (ms before action), type ('click'|'input'|'wait'),
  //              selector (CSS), value (for 'input') }
  // Edit this array to define the automated demo/debug scenario.
  const TEST_SCRIPT = [
    // Examples (uncomment and edit as needed):
    // { delay: 800,  type: 'click', selector: '.tb-btn[aria-label="Layers"]' },
    // { delay: 1200, type: 'click', selector: '.tb-btn[aria-label="Edit Schematic"]' },
    // { delay: 600,  type: 'wait'  },
  ];

  async function _runScript() {
    for (const step of TEST_SCRIPT) {
      await new Promise(r => setTimeout(r, step.delay ?? 400));
      if (step.type === 'wait') continue;
      const el = document.querySelector(step.selector);
      if (!el) { console.warn('[record] selector not found:', step.selector); continue; }
      if (step.type === 'click') {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } else if (step.type === 'input') {
        el.focus();
        el.value = step.value ?? '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  async function toggleRecording() {
    if (recording) {
      _mediaRecorder?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      _recChunks = [];
      const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9' : 'video/webm';
      _mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _recChunks.push(e.data); };
      _mediaRecorder.onstop = () => {
        const blob = new Blob(_recChunks, { type: 'video/webm' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `wson-debug-${Date.now()}.webm`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
        stream.getTracks().forEach(t => t.stop());
        recording = false;
      };
      _mediaRecorder.start();
      recording = true;
      if (TEST_SCRIPT.length) _runScript();
    } catch (e) {
      console.error('[record]', e);
      recording = false;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  let _compSearchTimer = null;
  function onCompSearchInput() {
    clearTimeout(_compSearchTimer);
    const q = compSearch.trim();
    if (!q) { catalogResults = []; return; }
    catalogLoading = true;
    _compSearchTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/schematic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'filtercomps', q, s: 30 })
        });
        if (res.ok) {
          const data = await res.json();
          catalogResults = data.items ?? [];
        }
      } catch { catalogResults = []; }
      finally { catalogLoading = false; }
    }, 200);
  }

  function selectCatalogItem(item) {
    // Pre-fill the edit form from the catalog entry
    editingComp = {
      description:    item.description   ?? item.Description   ?? '',
      tool_comp:      item.tool_comp      ?? item.Tool_Comp     ?? item.ToolComp ?? '',
      od:             +(item.od           ?? item.OD            ?? 2.875),
      od_multiplier:  +(item.od_multiplier ?? item.OD_Multiplier ?? 1.2),
      length:         +(item.length       ?? item.Length        ?? 10),
      weight:         +(item.weight       ?? item.Weight        ?? 0),
      noJoints:       +(item.noJoints     ?? item.NoJoints      ?? 1),
      avgJointLength: +(item.avgJointLength ?? item.AvgJointLength ?? 10),
    };
    isNewComp = true;
    compSearch = '';
    catalogResults = [];
  }

  const compJsonCache = new Map();
  let compSvgStrings = $state([]);

  function jsonToSvgContent(componentData, comp, compIndex, g) {
    const { elements, width: jw, height: jh } = componentData;
    if (!elements || !jw || !jh) return '';

    const { centerX, yScale, diaScale, wellDir, dtx, hasDir, autoScale } = g;
    const compOD     = comp.od ?? 2.875;
    const compLength = comp.length ?? 1;
    const compTop    = comp._top;

    // In directional mode subdivide each lineTo into steps so the path follows the curve.
    // Same principle as buildDirPath (30-step sampling) and ewell's Warp.js interpolation.
    const DIR_STEPS = hasDir ? 8 : 1;

    // Convert a component-space (jx, jy) point to SVG coordinates via txPoint
    const jPtToSvg = (jx, jy) => {
      const diamIn = jw > 0 ? (jx - jw / 2) * (compOD / jw) : 0;
      const depthM = jh > 0 ? compTop + (jy * compLength / jh) : compTop;
      return txPoint(diamIn, depthM, hasDir ? wellDir : null, dtx, yScale, diaScale, centerX, autoScale);
    };

    const defs  = [];
    const paths = [];
    let gradCounter = 0;

    for (const el of elements) {
      if (el.type !== 'freeform' || !el.points?.length) continue;

      const segs = [];
      let prevPt = null;

      for (const pt of el.points) {
        const { x, y, directive } = pt;

        if (directive === 'close') {
          segs.push('Z');
          prevPt = null;
          continue;
        }

        if (directive === 'moveTo' || !prevPt || DIR_STEPS === 1) {
          const [svgX, svgY] = jPtToSvg(x, y);
          segs.push(`${directive === 'moveTo' ? 'M' : 'L'}${svgX.toFixed(2)} ${svgY.toFixed(2)}`);
        } else {
          // lineTo in directional mode: interpolate segments to follow the curved wellbore
          for (let s = 1; s <= DIR_STEPS; s++) {
            const t = s / DIR_STEPS;
            const [svgX, svgY] = jPtToSvg(
              prevPt.x + (x - prevPt.x) * t,
              prevPt.y + (y - prevPt.y) * t
            );
            segs.push(`L${svgX.toFixed(2)} ${svgY.toFixed(2)}`);
          }
        }
        prevPt = pt;
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

    const centerX = strataW + RULER_W + maxR * diaScale + 110 + leftShift;  // +110 left margin for OH/casing/cement labels
    const totalW  = centerX + maxR * diaScale + 200 + rightShift;  // right margin for completion labels
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

  // ── Labella annotation nodes (collision-resolved labels with leader lines) ──
  // Two right-side columns so nothing crosses the borehole:
  //   compNodes  — completions, nearest column  (text-anchor start)
  //   bhNodes    — OH / CH / cement, LEFT side (text-anchor start, between ruler and borehole)
  // syD is used for directional mode so anchors follow the deviated wellbore.
  // Labella is used only for y-position collision avoidance.
  // x-positions (anchor, text column) are computed live in the SVG template from current geo
  // so they always track diaScale / centerX changes without any closure-stale issues.
  const annotations = $derived.by(() => {
    const g = geo;
    if (!g) return { compNodes: [], bhNodes: [] };
    const { oh, ch, cem, perf, completions, syD, maxR, maxDepth, yScale } = g;
    const getY = syD;

    // node.data = { radius, md, y0, text }
    // radius — inches (world), md — anchor depth (m), y0 — SVG-y for labella collision
    const makeNode = (radius, md, text) => {
      const y0 = getY(md);
      return new labella.Node(y0, 5, { radius, md, y0, text });
    };

    const compNodes = [];
    const bhNodes   = [];

    if (showOpenHole) {
      for (const s of oh) {
        bhNodes.push(makeNode(s.bitSize / 2, s.bot, `${s.bitSize}" OH to ${s.bot}m`));
      }
    }
    if (showCasing) {
      for (const c of ch) {
        bhNodes.push(makeNode(c.od / 2, c.top ?? 0, `${c.od}" ${c.grade ?? ''}`.trim()));
      }
    }
    if (showCement) {
      for (const c of cem) {
        bhNodes.push(makeNode((c.od ?? 8) / 2, c.top ?? 0, `Cem ${c.od ?? '?'}"`));
      }
    }
    if (showCompletions) {
      for (const comp of completions) {
        const rOuter = (comp.od ?? 2.875) / 2 * (comp.od_multiplier ?? 1.2);
        const mdMid  = ((comp._top ?? 0) + (comp._bot ?? 0)) / 2;
        compNodes.push(makeNode(rOuter, mdMid, `${comp.description || 'Completion'} ${comp.od}"`));
      }
    }
    if (showPerforations) {
      for (const p of perf) {
        const ptop = +(p.top ?? p.topMD ?? p.topDepth ?? p.perfTop ?? 0);
        const pbot = +(p.bot ?? p.botMD ?? p.botDepth ?? p.perfBot ?? 0);
        if (pbot <= ptop) continue;
        const tip   = (p.perfID ?? p.innerDiam ?? 7) / 2;
        const mdMid = (ptop + pbot) / 2;
        compNodes.push(makeNode(tip + 5, mdMid, `Perf ${ptop}–${pbot}m`));
      }
    }

    const maxPosY = HEADER_H + maxDepth * yScale * 1.2;
    const forceOpts = { algorithm: 'simple', nodeSpacing: 14, lineSpacing: 4, minPos: HEADER_H + 5, maxPos: maxPosY };
    if (compNodes.length) new labella.Force(forceOpts).nodes(compNodes).compute();
    if (bhNodes.length)   new labella.Force(forceOpts).nodes(bhNodes).compute();

    return { compNodes, bhNodes };
  });

  // ── Well header fields (name, description, company, country, etc.) ─────────
  const headerFields = $derived.by(() => {
    const src = getSrc() ?? wson;
    const ih = src?.inputHeader ?? wson?.inputHeader ?? {};
    const get = (...keys) => {
      for (const k of keys) {
        const v = ih[k]?.value ?? src?.[k] ?? wson?.[k];
        if (v != null && String(v).trim()) return String(v).trim();
      }
      return '';
    };
    return {
      wellName: get('wellName','WELL','well_name') || tab.name || '',
      desc:     get('wellDesc','DESC','description','WELL_DESC'),
      company:  get('company','COMP','COMPANY'),
      state:    get('state','ST','STAT','STATE'),
      country:  get('country','CTRY','COUNTRY'),
      location: get('location','LOC','UWI','LOCATION'),
    };
  });

  async function loadFile() {
    try {
      loading = true;
      error   = '';
      let bytes;
      if (tab.file) {
        bytes = await tab.file.arrayBuffer();
      } else if (tab.driveId) {
        const ctl = new AbortController();
        const tid = setTimeout(() => ctl.abort(), 30_000);
        try {
          const res = await fetch(`/api/drive?fileId=${encodeURIComponent(tab.driveId)}`, { signal: ctl.signal });
          if (!res.ok) throw new Error(`Drive fetch failed: HTTP ${res.status}`);
          bytes = await res.arrayBuffer();
        } finally {
          clearTimeout(tid);
        }
      } else {
        throw new Error('No file source provided');
      }
      const text = new TextDecoder().decode(bytes);
      wson = JSON.parse(text);
    } catch (e) {
      error = e.name === 'AbortError' ? 'Drive download timed out — please retry' : (e.message ?? String(e));
    } finally {
      loading = false;
    }
    // Fire directional fetch after loading — must not block the loading flag
    fetchDirData();
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
      const allD = [
        ...(src.oh ?? src.openHole ?? []).map(s => s.bot),
        ...(src.ch ?? src.casedHole ?? []).map(c => c.bot),
      ];
      const maxDepth = allD.length ? Math.max(...allD) + 50 : 3000;

      // Default node covering full depth if nothing found
      if (nodes.length === 0 && maxDepth > 0) {
        nodes.push({ start: 0, end: maxDepth });
      }

      const ctl = new AbortController();
      const tid = setTimeout(() => ctl.abort(), 15_000);
      try {
        const res = await fetch('/api/schematic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'autonodes', nodes, maxDepth, survey }),
          signal: ctl.signal
        });
        if (res.ok) dirData = await res.json();
      } finally {
        clearTimeout(tid);
      }
    } catch (e) {
      console.warn('[WsonApp] fetchDirData failed:', e.message);
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

  // Completions functions
  function startAddComp() {
    editingComp = { description: '', tool_comp: '', od: 2.875, od_multiplier: 1.2, length: 10, weight: 0, noJoints: 1, avgJointLength: 10 };
    isNewComp = true;
    showCompletionsEditor = true;
  }

  function startEditComp(i) {
    const src = getSrc();
    if (!src) return;
    editingComp = { ...src.completions[i] };
    isNewComp = false;
  }

  function saveComp() {
    const src = getSrc();
    if (!src || !editingComp) return;
    if (isNewComp) {
      src.completions = [...(src.completions ?? []), { ...editingComp }];
    } else {
      if (editingComp._editIdx != null) {
        src.completions = src.completions.map((c, i) => i === editingComp._editIdx ? { ...editingComp, _editIdx: undefined } : c);
      }
    }
    editingComp = null;
    isNewComp = false;
    fetchDirData();
  }

  function startEditCompByIdx(i) {
    const src = getSrc();
    if (!src) return;
    editingComp = { ...src.completions[i], _editIdx: i };
    isNewComp = false;
  }

  function cancelComp() {
    editingComp = null;
    isNewComp = false;
  }

  function saveCanvasComp() {
    const src = getSrc();
    if (!src || !canvasComp) return;
    const idx = canvasComp._editIdx;
    src.completions = src.completions.map((c, i) =>
      i === idx ? { ...canvasComp, _editIdx: undefined } : c
    );
    showCanvasCompEditor = false;
    canvasComp = null;
    fetchDirData();
  }

  function deleteCanvasComp() {
    const src = getSrc();
    if (!src || !canvasComp || !confirm('Delete this completion?')) return;
    src.completions = src.completions.filter((_, i) => i !== canvasComp._editIdx);
    showCanvasCompEditor = false;
    canvasComp = null;
    fetchDirData();
  }

  function deleteComp(i) {
    const src = getSrc();
    if (!src || !confirm('Delete this completion?')) return;
    src.completions = src.completions.filter((_, j) => j !== i);
    fetchDirData();
  }

  function moveComp(i, dir) {
    const src = getSrc();
    if (!src) return;
    const arr = [...(src.completions ?? [])];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    src.completions = arr;
    fetchDirData();
  }

  function filteredComps() {
    const src = getSrc();
    const all = src?.completions ?? [];
    const q = compSearch.trim().toLowerCase();
    if (!q) return all.map((c, i) => ({ c, i }));
    return all.map((c, i) => ({ c, i })).filter(({ c }) =>
      (c.description ?? '').toLowerCase().includes(q) ||
      (c.tool_comp ?? '').toLowerCase().includes(q)
    );
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
    editIdx = -1; editData = {};
    fetchDirData();
  }

  function deleteOHRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.oh = src.oh.filter((_, i) => i !== idx);
    fetchDirData();
  }

  // CH functions
  function addCHRow() {
    const src = getSrc();
    if (!src) return;
    src.ch = [...(src.ch ?? []), { od: 9.625, grade: 'L80', weight: 40, top: 0, bot: 2500 }];
    fetchDirData();
  }

  function saveCHRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.ch = src.ch.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1; editData = {};
    fetchDirData();
  }

  function deleteCHRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.ch = src.ch.filter((_, i) => i !== idx);
    fetchDirData();
  }

  // Cementing functions
  function addCemRow() {
    const src = getSrc();
    if (!src) return;
    src.cementing = [...(src.cementing ?? []), { od: 9.625, top: 0, bot: 2500 }];
    fetchDirData();
  }

  function saveCemRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.cementing = src.cementing.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1; editData = {};
    fetchDirData();
  }

  function deleteCemRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.cementing = src.cementing.filter((_, i) => i !== idx);
    fetchDirData();
  }

  // Strata functions
  function addStrataRow() {
    const src = getSrc();
    if (!src) return;
    src.strata = [...(src.strata ?? []), { strata: 'New Layer', top: 0, color: '#aaaaaa' }];
    fetchDirData();
  }

  function saveStrataRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    src.strata = src.strata.map((s, i) => i === editIdx ? { ...s, ...editData } : s);
    editIdx = -1; editData = {};
    fetchDirData();
  }

  function deleteStrataRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this row?')) return;
    src.strata = src.strata.filter((_, i) => i !== idx);
    fetchDirData();
  }

  // Survey / deviation functions
  function _getSurvey(src) {
    return src?.profile ?? src?.survey ?? [];
  }
  function _setSurvey(src, arr) {
    if (src.profile !== undefined) src.profile = arr;
    else if (src.survey !== undefined) src.survey = arr;
    else src.profile = arr;
  }

  function addSurveyRow() {
    const src = getSrc();
    if (!src) return;
    const arr = _getSurvey(src);
    const lastMd = arr.length ? +(arr[arr.length - 1].md ?? 0) + 500 : 0;
    _setSurvey(src, [...arr, { md: lastMd, dev: 0, az: 0 }]);
    fetchDirData();
  }

  function saveSurveyRow() {
    const src = getSrc();
    if (!src || editIdx < 0) return;
    const arr = _getSurvey(src);
    _setSurvey(src, arr.map((s, i) => i === editIdx ? { ...s, ...editData } : s));
    editIdx = -1; editData = {};
    fetchDirData();
  }

  function deleteSurveyRow(idx) {
    const src = getSrc();
    if (!src || !confirm('Delete this survey point?')) return;
    _setSurvey(src, _getSurvey(src).filter((_, i) => i !== idx));
    fetchDirData();
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
  {@const { oh, ch, cem, str, perf, completions, sy, syD, sxL, sxR, wellName, rulerTicks, totalW, totalH, centerX, strataW, hasDir, dirPath, dirSide, dirAxis, hasProfileData, wellDir, dtx, yScale, diaScale, maxR } = geo}

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


  <!-- Main layout -->
  <div class="flex overflow-hidden relative" style="height: 100%">

    <!-- Toolbar -->
    <div class="schematic-toolbar">
      <div class="tb-item group">
        <button class="tb-btn" onclick={downloadWson} aria-label="Save">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 12h10M8 3v7M5 7l3 3 3-3"/></svg>
        </button>
        <span class="tb-tip">Save</span>
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

      <!-- record button sits above bottom two (Completions + Survey) -->
      <div class="tb-sep"></div>
      <div class="tb-item group">
        <button class="tb-btn" class:tb-recording={recording} onclick={toggleRecording} aria-label="Record">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="8" cy="8" r="5.5"/>
            {#if !recording}<circle cx="8" cy="8" r="3" fill="currentColor" stroke="none"/>{/if}
            {#if recording}<rect x="5.5" y="5.5" width="5" height="5" rx="1" fill="#ef4444" stroke="none"/>{/if}
          </svg>
        </button>
        <span class="tb-tip">{recording ? 'Stop recording' : 'Record'}</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showCompletionsEditor} onclick={() => { showCompletionsEditor = !showCompletionsEditor; editingComp = null; compSearch = ''; }} aria-label="Completions">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="6" y1="2" x2="6" y2="14"/><line x1="10" y1="2" x2="10" y2="14"/><line x1="6" y1="5" x2="10" y2="5"/><line x1="6" y1="9" x2="10" y2="9"/></svg>
        </button>
        <span class="tb-tip">Completions</span>
      </div>

      <div class="tb-item group">
        <button class="tb-btn" class:tb-active={showSurveyEditor} onclick={() => { showSurveyEditor = !showSurveyEditor; editIdx = -1; editData = {}; }} aria-label="Survey">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none"/><line x1="8" y1="1" x2="8" y2="4"/><line x1="8" y1="12" x2="8" y2="15"/></svg>
        </button>
        <span class="tb-tip">Survey</span>
      </div>

    </div>

    <!-- SVG area (relative so the display button can float top-right) -->
    <div class="overflow-auto bg-white flex-1 relative">
      <!-- Display options button — top-right overlay -->
      <button
        class="absolute top-2 right-2 z-20 w-7 h-7 flex items-center justify-center rounded-full border text-sm font-bold shadow-sm transition-all
          {showDisplayOpts ? 'bg-blue-100 border-blue-400 text-blue-700' : 'bg-white border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-800'}"
        onclick={() => (showDisplayOpts = !showDisplayOpts)}
        aria-label="Display options"
        title="Display options"
      >⚙</button>

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

        <!-- ── Structured well information header ───────────────────────── -->
        {#if HEADER_H}
        {@const HH2  = HEADER_H / 2}
        {@const LBW  = strataW + RULER_W}
        {@const TBW  = 280}
        {@const RBX  = LBW + TBW}
        {@const RBW  = Math.max(0, totalW - RBX)}
        {@const CW   = Math.floor(RBW / 2)}

        <!-- Background + outer border -->
        <rect x="0" y="0" width={totalW} height={HEADER_H} fill="white"/>
        <rect x="0" y="0" width={totalW} height={HEADER_H} fill="none" stroke="#555" stroke-width="1.2"/>

        <!-- Top accent stripe -->
        <rect x="0" y="0" width={totalW} height="4" fill="#1e3a5f"/>

        <!-- "Well Schematic" title block (top-left, spans LBW) -->
        <rect x="0" y="4" width={LBW} height={HH2 - 4} fill="#f8fafc" stroke="#bbb" stroke-width="0.5"/>
        <text x={LBW - 8} y="12" font-size="16" font-weight="bold" fill="#14532d"
          text-anchor="end" dominant-baseline="hanging" font-family="Arial,sans-serif">Well Schematic</text>

        <!-- Formation Tops + ruler label (bottom-left) -->
        {#if strataW > 0}
          <rect x="0" y={HH2} width={strataW} height={HH2} fill="#f0f4f8" stroke="#bbb" stroke-width="0.5"/>
          <text x={strataW / 2} y={HH2 + 10} font-size="8.5" font-weight="600" text-anchor="middle"
            dominant-baseline="hanging" font-family="sans-serif" fill="#334155">FORMATION TOPS</text>
          <text x={strataW / 2} y={HH2 + 26} font-size="8" text-anchor="middle"
            dominant-baseline="hanging" font-family="sans-serif" fill="#64748b">{hasDir ? 'TVD' : 'MD'}</text>
        {/if}
        <rect x={strataW} y={HH2} width={RULER_W} height={HH2} fill="none" stroke="#bbb" stroke-width="0.5"/>

        <!-- Well Name + Description block (middle) -->
        <rect x={LBW} y="4" width={TBW} height={HEADER_H - 4} fill="none" stroke="#bbb" stroke-width="0.5"/>
        <text x={LBW + 8} y="10" font-size="9.5" font-weight="700" dominant-baseline="hanging"
          font-family="sans-serif" fill="#374151">Well Name</text>
        <text x={LBW + 72} y="10" font-size="9.5" dominant-baseline="hanging"
          font-family="sans-serif" fill="#111827">{headerFields.wellName}</text>
        <line x1={LBW} y1={HH2} x2={LBW + TBW} y2={HH2} stroke="#bbb" stroke-width="0.5"/>
        <text x={LBW + 8} y={HH2 + 8} font-size="9" font-weight="700" dominant-baseline="hanging"
          font-family="sans-serif" fill="#374151">Description</text>
        <text x={LBW + 8} y={HH2 + 22} font-size="8.5" dominant-baseline="hanging"
          font-family="sans-serif" fill="#4b5563">{headerFields.desc}</text>

        <!-- Right fields: Company / State / Country / Location -->
        {#if RBW > 40}
          <!-- Company -->
          <rect x={RBX} y="4" width={CW} height={HH2 - 4} fill="none" stroke="#bbb" stroke-width="0.5"/>
          <text x={RBX + 6} y="10" font-size="9.5" font-weight="700" dominant-baseline="hanging"
            font-family="sans-serif" fill="#374151">Company</text>
          <text x={RBX + 6} y="26" font-size="8.5" dominant-baseline="hanging"
            font-family="sans-serif" fill="#4b5563">{headerFields.company}</text>

          <!-- State -->
          <rect x={RBX + CW} y="4" width={RBW - CW} height={HH2 - 4} fill="none" stroke="#bbb" stroke-width="0.5"/>
          <text x={RBX + CW + 6} y="10" font-size="9.5" font-weight="700" dominant-baseline="hanging"
            font-family="sans-serif" fill="#374151">State</text>
          <text x={RBX + CW + 6} y="26" font-size="8.5" dominant-baseline="hanging"
            font-family="sans-serif" fill="#4b5563">{headerFields.state}</text>

          <!-- Country -->
          <rect x={RBX} y={HH2} width={CW} height={HH2} fill="none" stroke="#bbb" stroke-width="0.5"/>
          <text x={RBX + 6} y={HH2 + 8} font-size="9.5" font-weight="700" dominant-baseline="hanging"
            font-family="sans-serif" fill="#374151">Country</text>
          <text x={RBX + 6} y={HH2 + 24} font-size="8.5" dominant-baseline="hanging"
            font-family="sans-serif" fill="#4b5563">{headerFields.country}</text>

          <!-- Location -->
          <rect x={RBX + CW} y={HH2} width={RBW - CW} height={HH2} fill="none" stroke="#bbb" stroke-width="0.5"/>
          <text x={RBX + CW + 6} y={HH2 + 8} font-size="9.5" font-weight="700" dominant-baseline="hanging"
            font-family="sans-serif" fill="#374151">Location</text>
          <text x={RBX + CW + 6} y={HH2 + 24} font-size="8.5" dominant-baseline="hanging"
            font-family="sans-serif" fill="#4b5563">{headerFields.location}</text>
        {/if}
        {/if}
        <!-- ── End header ─────────────────────────────────────────────────── -->

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
              {@const y = syD(s.top)}
              {@const ht = syD(s.bot) - y}
              <rect {x} {y} width={w} height={ht} fill="#f3e8ff" stroke="#9333ea" stroke-width="1" stroke-dasharray="5 3"/>
            {/if}
          {/each}
        {/if}

        {#if showCement}
          {#each cementRects(cem, oh, sy, sxL, sxR) as cr}
            {#if hasDir && dirSide}
              <path d={dirSide(cr.top, cr.bot, cr.casingR, cr.holeR, -1)} fill="url(#cement-fill)"/>
              <path d={dirSide(cr.top, cr.bot, cr.casingR, cr.holeR,  1)} fill="url(#cement-fill)"/>
            {:else}
              {@const y = syD(cr.top)}
              {@const ht = syD(cr.bot) - y}
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
              {@const y = syD(c.top)}
              {@const ht = syD(c.bot) - y}
              <rect {x} {y} width={w} height={ht} fill="azure" stroke="#111" stroke-width="1.5"/>
            {/if}
          {/each}
        {/if}

        {#if showCompletions}
          {#each completions as comp, i}
            {@const r = (comp.od ?? 2.875) / 2}
            {@const rOuter = r * (comp.od_multiplier ?? 1.2)}
            {@const type = compTypeOf(comp)}

            <g ondblclick={() => { canvasComp = { ...comp, _editIdx: i }; showCanvasCompEditor = true; }} style="cursor:pointer">

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
              <!-- Straight completions — use syD for DTX-consistent depth positions -->
              {@const ytop = syD(comp._top)}
              {@const ybot = syD(comp._bot)}
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

            {/if}
            </g>
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

        <!-- Labella collision-resolved annotations — anchor x,y computed via txPoint  -->
        <!-- so they follow the deviated wellbore and track diaScale / centerX changes -->
        {#if annotations.compNodes.length || annotations.bhNodes.length}
          {@const ANN_COMP_X = centerX + maxR * diaScale + 14}
          {@const ANN_LEFT_X = sxL(maxR) - 8}
          <g font-size="8" font-family="sans-serif">
            {#each annotations.compNodes as node}
              {@const [ax, ay] = txPoint(node.data.radius, node.data.md, hasDir ? wellDir : null, dtx, yScale, diaScale, centerX, displayOpts.autoScale)}
              <line x1={ax} y1={ay}
                    x2={ANN_COMP_X - 2} y2={node.currentPos - 3}
                    stroke="#6b7280" stroke-width="0.8" stroke-dasharray="3,2"/>
              <circle cx={ax} cy={ay} r="2" fill="#6b7280" opacity="0.7"/>
              <text x={ANN_COMP_X + 3} y={node.currentPos} text-anchor="start" fill="#374151">{node.data.text}</text>
            {/each}
            {#each annotations.bhNodes as node}
              {@const [ax, ay] = txPoint(-node.data.radius, node.data.md, hasDir ? wellDir : null, dtx, yScale, diaScale, centerX, displayOpts.autoScale)}
              <line x1={ax} y1={ay}
                    x2={ANN_LEFT_X} y2={node.currentPos - 3}
                    stroke="#4f86c6" stroke-width="0.8" stroke-dasharray="4,2"/>
              <circle cx={ax} cy={ay} r="2" fill="#4f86c6" opacity="0.7"/>
              <text x={ANN_LEFT_X - 3} y={node.currentPos} text-anchor="end" fill="#1e40af">{node.data.text}</text>
            {/each}
          </g>
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

    <!-- Canvas Component Quick-Editor -->
    <FloatingPanel
      title={canvasComp?.description || 'Edit Component'}
      visible={showCanvasCompEditor}
      onClose={() => { showCanvasCompEditor = false; canvasComp = null; }}
      width={220}
      x={120}
      y={120}
    >
      {#snippet children()}
        {#if canvasComp}
          <div class="flex flex-col gap-2 p-2.5">
            <div>
              <label class="block text-xs text-slate-500 mb-0.5">Description</label>
              <input type="text" bind:value={canvasComp.description}
                class="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white"/>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-xs text-slate-500 mb-0.5">OD (in)</label>
                <input type="number" step="0.001" bind:value={canvasComp.od}
                  class="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white"/>
              </div>
              <div>
                <label class="block text-xs text-slate-500 mb-0.5">Length (m)</label>
                <input type="number" step="0.1" bind:value={canvasComp.length}
                  class="w-full text-xs border border-slate-200 rounded px-2 py-1 bg-white"/>
              </div>
            </div>
            <div class="flex gap-1.5 pt-0.5">
              <button onclick={saveCanvasComp}
                class="flex-1 text-xs bg-blue-600 text-white rounded px-2 py-1.5 hover:bg-blue-700 font-medium">Done</button>
              <button onclick={deleteCanvasComp}
                class="text-xs bg-red-50 text-red-600 border border-red-200 rounded px-2 py-1.5 hover:bg-red-100">Delete</button>
            </div>
          </div>
        {/if}
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

    <!-- Survey / Deviation Editor -->
    <FloatingPanel
      title="Survey Data"
      visible={showSurveyEditor}
      onClose={() => { showSurveyEditor = false; editIdx = -1; editData = {}; }}
      width={255}
      x={100}
      y={80}
    >
      {#snippet children()}
        <p class="text-xs text-slate-500 px-3 pt-2 pb-1">
          MD / Inclination / Azimuth stations. Enable <strong>Directional</strong> in Display Options to render the deviated wellbore.
          {#if geo?.hasProfileData}<span class="text-green-600 font-medium ml-1">✓ Active</span>{/if}
        </p>
        <div class="p-2 overflow-y-auto" style="max-height:55vh">
          <table class="w-full text-xs">
            <thead class="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th class="px-2 py-1.5 text-center font-semibold text-gray-700">MD (m)</th>
                <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Inc (°)</th>
                <th class="px-2 py-1.5 text-center font-semibold text-gray-700">Az (°)</th>
                <th class="px-2 py-1.5 text-center font-semibold text-gray-700 w-14">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              {#each _getSurvey(getSrc() ?? {}) as row, i}
                {#if editIdx === i}
                  <tr class="bg-blue-50">
                    <td class="px-1 py-1"><input type="number" step="1" bind:value={editData.md} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveSurveyRow()}/></td>
                    <td class="px-1 py-1"><input type="number" step="0.1" min="0" max="180" bind:value={editData.dev} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveSurveyRow()}/></td>
                    <td class="px-1 py-1"><input type="number" step="0.1" min="0" max="360" bind:value={editData.az} class="w-full border border-slate-300 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-500" onkeydown={e => e.key === 'Enter' && saveSurveyRow()}/></td>
                    <td class="px-1 py-1"><div class="flex gap-1 justify-center">
                      <button onclick={saveSurveyRow} class="p-1 bg-green-500 text-white rounded hover:bg-green-600 text-xs leading-none" title="Save">✓</button>
                      <button onclick={cancelEdit} class="p-1 bg-gray-400 text-white rounded hover:bg-gray-500 text-xs leading-none" title="Cancel">✕</button>
                    </div></td>
                  </tr>
                {:else}
                  <tr class="hover:bg-slate-50 cursor-pointer" onclick={() => startEditRow(i, row)}>
                    <td class="px-2 py-1.5 text-center">{row.md ?? row.MD ?? 0}</td>
                    <td class="px-2 py-1.5 text-center">{(+(row.dev ?? row.inc ?? row.INC ?? 0)).toFixed(2)}°</td>
                    <td class="px-2 py-1.5 text-center">{(+(row.az ?? row.AZ ?? 0)).toFixed(2)}°</td>
                    <td class="px-2 py-1.5"><div class="flex gap-1 justify-center">
                      <button onclick={e => { e.stopPropagation(); startEditRow(i, row); }} class="p-1 text-blue-600 hover:bg-blue-50 rounded text-xs leading-none" title="Edit">✎</button>
                      <button onclick={e => { e.stopPropagation(); deleteSurveyRow(i); }} class="p-1 text-red-500 hover:bg-red-50 rounded text-xs leading-none" title="Delete">✕</button>
                    </div></td>
                  </tr>
                {/if}
              {/each}
              {#if _getSurvey(getSrc() ?? {}).length === 0}
                <tr><td colspan="4" class="px-2 py-4 text-center text-slate-400">No survey data — add stations below</td></tr>
              {/if}
            </tbody>
          </table>
          <div class="flex justify-end pt-2">
            <button onclick={addSurveyRow} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 text-xs font-medium">+ Add Station</button>
          </div>
        </div>
      {/snippet}
    </FloatingPanel>

    <!-- Completions Editor -->
    <FloatingPanel
      title="Completions Editor"
      visible={showCompletionsEditor}
      onClose={() => { showCompletionsEditor = false; editingComp = null; compSearch = ''; }}
      width={280}
      x={80}
      y={60}
    >
      {#snippet children()}
        <div class="p-2">

          <!-- Catalog search (queries /api/schematic filtercomps from comp_list.xlsx) -->
          <div class="relative mb-3">
            <div class="flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-300 rounded bg-white focus-within:ring-1 focus-within:ring-blue-500">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" class="text-slate-400 flex-shrink-0"><circle cx="6" cy="6" r="5"/><line x1="10" y1="10" x2="14" y2="14"/></svg>
              <input
                type="text"
                placeholder="Search catalog (e.g. packer 7 inch)…"
                bind:value={compSearch}
                oninput={onCompSearchInput}
                onfocus={() => (compSearchFocused = true)}
                onblur={() => setTimeout(() => (compSearchFocused = false), 200)}
                class="flex-1 text-xs bg-transparent outline-none"
              />
              {#if catalogLoading}
                <span class="text-xs text-slate-400 animate-pulse">…</span>
              {/if}
            </div>
            <div class="text-xs text-slate-400 mt-0.5 px-0.5">
              {getSrc()?.completions?.length ?? 0} in schematic
              {#if catalogResults.length > 0} · {catalogResults.length} catalog matches{/if}
            </div>

            <!-- Catalog dropdown results -->
            {#if compSearch.trim() && compSearchFocused && catalogResults.length > 0}
              <div class="absolute left-0 right-0 top-full mt-0.5 bg-white border border-slate-200 rounded-lg shadow-xl z-50 max-h-56 overflow-y-auto">
                <div class="px-2.5 py-1 bg-slate-50 border-b border-slate-100 text-xs text-slate-500 font-medium sticky top-0">
                  Catalog — click to pre-fill form
                </div>
                {#each catalogResults as item}
                  <button
                    class="w-full text-left px-2.5 py-1.5 hover:bg-blue-50 border-b border-slate-100 last:border-0"
                    onmousedown={() => selectCatalogItem(item)}
                  >
                    <div class="text-xs font-medium text-slate-800 truncate">{item.description ?? item.Description ?? '—'}</div>
                    <div class="text-xs text-slate-400 truncate">
                      {item.tool_comp ?? item.Tool_Comp ?? ''}
                      {#if item.od ?? item.OD} · OD {item.od ?? item.OD}"{/if}
                      {#if item.length ?? item.Length} · {item.length ?? item.Length}m{/if}
                    </div>
                  </button>
                {/each}
              </div>
            {:else if compSearch.trim() && compSearchFocused && !catalogLoading}
              <div class="absolute left-0 right-0 top-full mt-0.5 bg-white border border-slate-200 rounded-lg shadow-lg z-50 px-3 py-2 text-xs text-slate-400">
                No catalog matches — you can still add manually below
              </div>
            {/if}
          </div>

          <!-- Inline edit / add form -->
          {#if editingComp}
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-2.5 mb-3">
              <div class="text-xs font-semibold text-slate-700 mb-2">{isNewComp ? 'Add Completion' : 'Edit Completion'}</div>
              <div class="grid grid-cols-2 gap-x-2 gap-y-1.5">
                {#each [
                  ['description','Description','text'],
                  ['tool_comp','Tool Comp','text'],
                  ['od','OD (in)','number'],
                  ['od_multiplier','OD Multiplier','number'],
                  ['length','Length (m)','number'],
                  ['weight','Weight','number'],
                  ['noJoints','No. Joints','number'],
                  ['avgJointLength','Avg Joint Len','number'],
                ] as [field, label, type]}
                  <div>
                    <label class="block text-xs text-gray-500 mb-0.5">{label}</label>
                    <input
                      {type}
                      step={type === 'number' ? '0.001' : undefined}
                      bind:value={editingComp[field]}
                      class="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      onkeydown={e => e.key === 'Enter' && saveComp()}
                    />
                  </div>
                {/each}
              </div>
              <div class="flex gap-2 mt-2.5">
                <button onclick={saveComp} class="px-3 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600 font-medium">{isNewComp ? 'Add' : 'Save'}</button>
                <button onclick={cancelComp} class="px-3 py-1 bg-gray-400 text-white rounded text-xs hover:bg-gray-500">Cancel</button>
              </div>
            </div>
          {:else}
            <div class="flex justify-end mb-2">
              <button onclick={startAddComp} class="px-2 py-1 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 text-xs font-medium">+ Add</button>
            </div>
          {/if}

          <!-- Full list -->
          <div class="space-y-1">
            {#each filteredComps() as { c, i }}
              <div ondblclick={() => startEditCompByIdx(i)} class="flex items-start justify-between px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer {editingComp?._editIdx === i ? 'border-blue-400 bg-blue-50' : ''}">
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium text-slate-800 truncate">{c.description || '—'}</div>
                  <div class="text-xs text-slate-500">
                    {#if c.tool_comp}<span class="mr-1.5">{c.tool_comp}</span>{/if}OD {c.od}" · {c.length}m{#if c.weight} · {c.weight}kg{/if}
                  </div>
                </div>
                <div class="flex items-center gap-0.5 ml-1.5 flex-shrink-0">
                  <button onclick={() => moveComp(i, -1)} class="p-1 text-slate-400 hover:text-slate-700 rounded text-xs leading-none">↑</button>
                  <button onclick={() => moveComp(i,  1)} class="p-1 text-slate-400 hover:text-slate-700 rounded text-xs leading-none">↓</button>
                  <button onclick={() => startEditCompByIdx(i)} class="p-1 text-blue-600 hover:bg-blue-50 rounded text-xs leading-none">✎</button>
                  <button onclick={() => deleteComp(i)} class="p-1 text-red-500 hover:bg-red-50 rounded text-xs leading-none">✕</button>
                </div>
              </div>
            {/each}
            {#if filteredComps().length === 0}
              <div class="text-center py-5 text-slate-400 text-xs">{compSearch ? 'No matches' : 'No completions yet'}</div>
            {/if}
          </div>

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

  .tb-btn.tb-recording {
    color: #ef4444;
    animation: tb-pulse 1s ease-in-out infinite;
  }

  @keyframes tb-pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.5; }
  }

  .tb-sep {
    width: 18px;
    height: 1px;
    background: #e2e8f0;
    margin: 2px 0;
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
