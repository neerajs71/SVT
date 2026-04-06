import { json } from '@sveltejs/kit';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';

// ── Component catalog (loaded from comp_list.xlsx) ────────────────────────
let dfSearch = [];  // lowercase search_string per row
let compData  = []; // raw rows from Excel

function loadCompList() {
  const paths = [
    join(process.cwd(), 'static', 'comp_list.xlsx'),              // dev
    join(process.cwd(), 'build', 'client', 'comp_list.xlsx'),     // production (node build from project root)
    join(process.cwd(), 'client', 'comp_list.xlsx'),              // production (cwd inside build/)
    join(process.cwd(), 'src', 'lib', 'apps', 'wson', 'comp_list.xlsx'),
    join(process.cwd(), 'comp_list.xlsx'),
  ];
  for (const p of paths) {
    try {
      const wb = XLSX.read(readFileSync(p), { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      compData  = XLSX.utils.sheet_to_json(ws);
      dfSearch  = compData.map(r => (r.search_string || '').toLowerCase());
      console.log(`[filtercomps] loaded ${compData.length} rows from ${p}`);
      return;
    } catch { /* try next */ }
  }
  console.warn('[filtercomps] comp_list.xlsx not found — component search disabled');
}

loadCompList();

// ── Pure-JS math helpers ───────────────────────────────────────────────────
const dot3  = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross3 = (a, b) => [
  a[1]*b[2] - a[2]*b[1],
  a[2]*b[0] - a[0]*b[2],
  a[0]*b[1] - a[1]*b[0]
];
const norm3 = v => { const m = Math.sqrt(dot3(v,v)); return m > 0 ? v.map(x => x/m) : v; };
const add3  = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub3  = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const scl3  = (v, s) => v.map(x => x*s);

// Spherical linear interpolation of unit 3-vectors
function slerp3(v1, v2, t) {
  const d = Math.max(-1, Math.min(1, dot3(v1, v2)));
  const th = Math.acos(d);
  if (th < 1e-10) return [...v1];
  const st = Math.sin(th);
  return v1.map((_, i) => v1[i]*Math.sin((1-t)*th)/st + v2[i]*Math.sin(t*th)/st);
}

// ── WellProfile: arc-segment calculation (port of server/profile.ts) ───────
function sphPoint(dev, az) {
  const d2r = Math.PI / 180;
  const phi = d2r * dev, theta = d2r * az;
  return norm3([Math.sin(phi)*Math.cos(theta), Math.sin(phi)*Math.sin(theta), Math.cos(phi)]);
}

function controlSegment(spt1, spt2, p1) {
  try {
    const angPsi = Math.acos(Math.max(-1, Math.min(1, dot3(spt1.dir, spt2.dir))));
    const rotAxis = cross3(spt1.dir, spt2.dir);
    const radCurvature = angPsi < 1e-10 ? 1e9 : (spt2.md - spt1.md) / angPsi;
    const delTang = angPsi < 1e-10 ? (spt2.md - spt1.md)/2 : radCurvature * Math.tan(angPsi/2);
    const relP1Mid = scl3(spt1.dir, delTang);
    const relMidP2 = scl3(spt2.dir, delTang);
    const p2 = add3(p1, add3(relP1Mid, relMidP2));

    // q1 = normalize(cross(normalize(relP1Mid), rotAxis)) * radCurvature
    const q1Dir = norm3(cross3(norm3(relP1Mid), rotAxis));
    const q1    = scl3(q1Dir, radCurvature);
    const ptPivot = sub3(p1, q1);
    const q2    = sub3(p2, ptPivot);
    const q1u   = norm3(q1);
    const q2u   = norm3(q2);
    const dirMult = rotAxis[1] >= 0 ? 1 : -1;  // dirMult from y-component of rotAxis

    return { md1: spt1.md, md2: spt2.md, radCurvature, p1: [...p1], p2, ptPivot, q1u, q2u, rotAxis, dirMult };
  } catch (e) {
    return null;
  }
}

function buildSegments(survey, td = 3000) {
  // Normalise and perturb survey (port of WellProfile.cleanSurvey)
  if (!survey || survey.length === 0) {
    // Default vertical
    survey = [{ md: 0, dev: 0, az: 0 }, { md: td/2, dev: 0.02, az: 0 }, { md: td, dev: 0.04, az: 0 }];
  }

  const perturbed = [];
  perturbed.push({ md: survey[0].md ?? 0, dev: survey[0].dev ?? survey[0].inc ?? 0, az: survey[0].az ?? 0 });
  for (let i = 1; i < survey.length; i++) {
    const prev = perturbed[perturbed.length - 1];
    const cur  = survey[i];
    const dev  = cur.dev ?? cur.inc ?? 0;
    const az   = cur.az ?? 0;
    perturbed.push({ md: cur.md ?? 0, dev: dev === prev.dev ? dev + 0.02 : dev, az });
  }
  // Extend by 2000m beyond last station
  const last = perturbed[perturbed.length - 1];
  perturbed.push({ md: last.md + 2000, dev: last.dev + 0.02, az: last.az });

  const clSurv = perturbed.map(p => ({ md: p.md, dir: sphPoint(p.dev, p.az) }));

  const segs = [];
  let p1 = [0, 0, clSurv[0].md];  // [N, E, TVD_start]
  for (let i = 0; i < clSurv.length - 1; i++) {
    const seg = controlSegment(clSurv[i], clSurv[i+1], [...p1]);
    if (seg) { segs.push(seg); p1 = seg.p2; }
  }
  return segs;
}

// ── AutoNodes: DTX autoscale (simplified, no turf dependency) ─────────────
// Implements the same concept as dlis autonodes.ts but with pure JS polygon math
function polygonArea(coords) {
  // Shoelace formula
  let area = 0;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    area += (coords[j][0] + coords[i][0]) * (coords[j][1] - coords[i][1]);
  }
  return Math.abs(area / 2);
}

function autoNodes(nodes, maxDepth) {
  // Collect all breakpoints
  const breaks = new Set([0, maxDepth]);
  for (const nd of nodes) { breaks.add(nd.start); breaks.add(nd.end); }
  const bpts = [...breaks].sort((a, b) => a - b);

  // Assign weight to each interval
  const intervals = [];
  for (let i = 0; i < bpts.length - 1; i++) {
    const s = bpts[i], e = bpts[i+1], len = e - s;
    if (len <= 0) continue; // skip zero-length or negative intervals
    let weight = 1;
    for (const nd of nodes) {
      if (nd.start <= s && nd.end >= e && len < 50) {
        const w = 50 / (0.3 * len);
        weight = Math.max(weight, isFinite(w) ? w : 1);
      }
    }
    intervals.push({ s, e, len, w: weight });
  }

  // Cumulative weighted → DTX
  const totalW = intervals.reduce((sum, iv) => sum + iv.len * iv.w, 0);
  const depth = [0], depthTx = [0];
  let cumReal = 0, cumWt = 0;
  for (const iv of intervals) {
    cumReal += iv.len;
    cumWt   += iv.len * iv.w;
    depth.push(cumReal);
    depthTx.push(cumWt * maxDepth / totalW);
  }
  return { depth, depthTx };
}

// ── Server endpoint ────────────────────────────────────────────────────────
export const POST = async ({ request }) => {
  try {
    const body = await request.json();

    if (body.action === 'filtercomps') {
      const q = (body.q || '').toLowerCase().trim();
      if (!q) return json({ items: [], cols: compData.length ? Object.keys(compData[0]) : [] });
      const words = q.split(/\s+/).filter(Boolean);
      const items = [];
      for (let i = 0; i < dfSearch.length; i++) {
        if (words.every(w => dfSearch[i].includes(w))) items.push(compData[i]);
        if (items.length >= (body.s ?? 30)) break;
      }
      return json({ items, cols: compData.length ? Object.keys(compData[0]) : [] });
    }

    if (body.action === 'autonodes') {
      const { nodes = [], maxDepth = 3000, survey = [] } = body;
      const td = maxDepth || 3000;

      const dtx   = autoNodes(nodes, td);
      const prNorm = buildSegments(survey, td);

      // Auto-scaled survey: remap depths using DTX linear interpolation
      const lerpDTX = (d) => {
        if (dtx.depth.length < 2) return d;
        if (d <= dtx.depth[0]) return dtx.depthTx[0];
        if (d >= dtx.depth[dtx.depth.length - 1]) return dtx.depthTx[dtx.depthTx.length - 1];
        for (let i = 1; i < dtx.depth.length; i++) {
          if (d <= dtx.depth[i]) {
            const t = (d - dtx.depth[i-1]) / (dtx.depth[i] - dtx.depth[i-1]);
            return dtx.depthTx[i-1] + t * (dtx.depthTx[i] - dtx.depthTx[i-1]);
          }
        }
        return d;
      };

      const autoSurvey = survey.map(p => ({ ...p, md: lerpDTX(p.md ?? 0) }));
      const prAuto     = buildSegments(autoSurvey.length ? autoSurvey : survey, td);

      return json({ dtx, prNorm, prAuto });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[/api/schematic]', e);
    return json({ error: String(e) }, { status: 500 });
  }
};
