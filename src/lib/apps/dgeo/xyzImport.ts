/**
 * xyzImport.ts
 *
 * Parse a 3-column XYZ text file and grid the points into Rail[].
 *
 * Supported formats:
 *   - Comma, tab, or space-delimited
 *   - Optional header row (auto-detected if first data row is non-numeric)
 *   - Comment lines starting with #, ;, or //  are skipped
 *   - At least 3 numeric columns required; extra columns are ignored
 *
 * Coordinate mapping:
 *   The caller selects which column holds X (horizontal), Strike (Y), and Depth (Z).
 *   Data is auto-normalised to the domain coordinate ranges on import.
 *
 * Gridding algorithm:
 *   1. Each point is assigned to its nearest rail band (railCount evenly-spaced bands)
 *   2. Within each band, points are sorted by X and linearly interpolated to a
 *      regular N-point X grid
 *   3. Empty bands are filled by linear interpolation from neighbouring non-empty bands
 */

import type { Rail, Point2D, DomainBounds } from './types.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ColumnStat {
  label: string;   // header name or "Col N"
  min:   number;
  max:   number;
}

export interface ParsedXYZ {
  /** Per-column labels (from header row or auto-generated "Col N") */
  headers:  string[];
  /** All valid numeric rows */
  rows:     number[][];
  /** Per-column min / max statistics */
  stats:    ColumnStat[];
}

// ── parseXYZ ──────────────────────────────────────────────────────────────────

/** Parse a text file into numeric rows.  Returns null on total parse failure. */
export function parseXYZ(text: string): ParsedXYZ | null {
  const lines = text.split(/\r?\n/);

  // Skip empty lines and comment lines
  const nonEmpty = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith(';') && !l.startsWith('//'));

  if (nonEmpty.length === 0) return null;

  // Auto-detect delimiter from first content line
  const firstLine = nonEmpty[0];
  const delimiter = firstLine.includes('\t') ? /\t/ : firstLine.includes(',') ? /,/ : /\s+/;

  // Check if first line is a header (contains non-numeric tokens)
  const firstTokens = firstLine.split(delimiter).map(t => t.trim());
  const hasHeader   = firstTokens.some(t => isNaN(Number(t)) && t.length > 0);

  let headers: string[];
  let dataLines: string[];

  if (hasHeader) {
    headers   = firstTokens.map((t, i) => (t || `Col ${i + 1}`));
    dataLines = nonEmpty.slice(1);
  } else {
    headers   = firstTokens.map((_, i) => `Col ${i + 1}`);
    dataLines = nonEmpty;
  }

  // Parse numeric rows — require at least 3 columns
  const rows: number[][] = [];
  for (const line of dataLines) {
    const tokens = line.split(delimiter).map(t => t.trim());
    const nums   = tokens.map(Number);
    if (nums.length >= 3 && nums.every(n => !isNaN(n))) {
      rows.push(nums);
    }
  }

  if (rows.length === 0) return null;

  // Compute per-column stats
  const nCols = headers.length;
  const stats: ColumnStat[] = Array.from({ length: nCols }, (_, ci) => {
    const vals = rows.map(r => r[ci] ?? NaN).filter(v => !isNaN(v));
    return {
      label: headers[ci],
      min:   vals.length ? Math.min(...vals) : 0,
      max:   vals.length ? Math.max(...vals) : 0,
    };
  });

  return { headers, rows, stats };
}

// ── xyzToRails ────────────────────────────────────────────────────────────────

export function xyzToRails(
  rows:         number[][],
  xCol:         number,
  strikeCol:    number,
  depthCol:     number,
  domX:         DomainBounds,
  domY:         DomainBounds,
  strikeKm:     number,
  railCount:    number,
  pointsPerRail = 24,
): Rail[] {
  // ── Extract & normalise ──────────────────────────────────────────────────
  const raw = rows
    .filter(r => r[xCol] !== undefined && r[strikeCol] !== undefined && r[depthCol] !== undefined)
    .map(r => ({ x: r[xCol], s: r[strikeCol], d: r[depthCol] }));

  if (raw.length === 0) return [];

  const xs = raw.map(p => p.x),  sArr = raw.map(p => p.s), ds = raw.map(p => p.d);
  const xMin = Math.min(...xs),  xMax = Math.max(...xs);
  const sMin = Math.min(...sArr), sMax = Math.max(...sArr);
  const dMin = Math.min(...ds),  dMax = Math.max(...ds);

  const normX = (v: number) =>
    xMin === xMax ? (domX.min + domX.max) / 2
    : domX.min + (v - xMin) / (xMax - xMin) * (domX.max - domX.min);

  const normS = (v: number) =>
    sMin === sMax ? strikeKm / 2
    : (v - sMin) / (sMax - sMin) * strikeKm;

  const normD = (v: number) =>
    dMin === dMax ? (domY.min + domY.max) / 2
    : domY.min + (v - dMin) / (dMax - dMin) * (domY.max - domY.min);

  const normed = raw.map(p => ({ x: normX(p.x), s: normS(p.s), d: normD(p.d) }));

  // ── Create bands ──────────────────────────────────────────────────────────
  const n       = Math.max(2, railCount);
  const bands: { z: number; pts: { x: number; d: number }[] }[] =
    Array.from({ length: n }, (_, i) => ({ z: (i / (n - 1)) * strikeKm, pts: [] }));

  // Assign each point to its nearest rail band
  for (const p of normed) {
    const fi = (p.s / strikeKm) * (n - 1);
    const ri = Math.max(0, Math.min(n - 1, Math.round(fi)));
    bands[ri].pts.push({ x: p.x, d: p.d });
  }

  // ── Interpolate each band to a regular X grid ─────────────────────────────
  const xGrid: number[] = Array.from(
    { length: pointsPerRail },
    (_, i) => domX.min + (domX.max - domX.min) * i / (pointsPerRail - 1),
  );

  const fallbackDepth = (domY.min + domY.max) / 2;

  function interpolateAtX(pts: { x: number; d: number }[], x: number): number | null {
    if (pts.length === 0) return null;
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    if (x <= sorted[0].x)                  return sorted[0].d;
    if (x >= sorted[sorted.length - 1].x)  return sorted[sorted.length - 1].d;
    let i = 0;
    while (i < sorted.length - 2 && sorted[i + 1].x < x) i++;
    const seg = sorted[i + 1].x - sorted[i].x;
    const t   = seg > 0 ? (x - sorted[i].x) / seg : 0;
    return sorted[i].d + t * (sorted[i + 1].d - sorted[i].d);
  }

  // Build per-band depth arrays (null = empty)
  const bandDepths: (number | null)[][] = bands.map(b =>
    xGrid.map(x => interpolateAtX(b.pts, x))
  );

  // Fill empty bands by interpolating from neighbours
  for (let ri = 0; ri < n; ri++) {
    if (bandDepths[ri].some(v => v === null)) {
      let lo = -1, hi = -1;
      for (let j = ri - 1; j >= 0; j--)     { if (bandDepths[j].every(v => v !== null)) { lo = j; break; } }
      for (let j = ri + 1; j < n; j++)       { if (bandDepths[j].every(v => v !== null)) { hi = j; break; } }

      bandDepths[ri] = xGrid.map((_, xi) => {
        if (lo >= 0 && hi >= 0) {
          const t = (ri - lo) / (hi - lo);
          return (bandDepths[lo][xi] as number) * (1 - t) + (bandDepths[hi][xi] as number) * t;
        }
        if (lo >= 0) return bandDepths[lo][xi] as number;
        if (hi >= 0) return bandDepths[hi][xi] as number;
        return fallbackDepth;
      });
    }
  }

  // ── Assemble Rails ────────────────────────────────────────────────────────
  const clampY = (v: number) => Math.max(domY.min, Math.min(domY.max, v));

  return bands.map((b, ri) => ({
    z:      b.z,
    points: xGrid.map((x, xi) => ({
      x,
      y: clampY(bandDepths[ri][xi] ?? fallbackDepth),
    } as Point2D)),
  }));
}
