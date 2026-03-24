import { parseLAS } from './parser.js';

/**
 * Read an ArrayBuffer as UTF-8 text and parse as LAS.
 * Throws with a descriptive message if it doesn't look like a LAS file.
 * @param {ArrayBuffer} arrayBuffer
 */
export function parseLASFile(arrayBuffer) {
  const text = new TextDecoder('utf-8').decode(arrayBuffer);

  // A valid LAS file must have at least one section header
  if (!text.includes('~')) {
    const preview = text.slice(0, 40).replace(/\r?\n/g, ' ');
    const err = new Error('No LAS section headers found (missing ~).');
    err.diagnostic = preview;
    throw err;
  }

  const result = parseLAS(text);

  if (!result.curves.length) {
    throw new Error('No curve definitions found in the ~CURVE section.');
  }

  return result;
}

/**
 * Build a summary object from a parsed LAS result.
 * @param {ReturnType<typeof parseLAS>} las
 */
export function processCurves(las) {
  const indexCurve = las.curves[0] ?? { mnem: 'DEPTH', unit: '' };

  const curves = las.curves.map((c, i) => ({
    index: i,
    name:  c.mnem,
    unit:  c.unit,
    desc:  c.desc,
    isIndex: i === 0,
  }));

  const rowCount   = las.data.length;
  const startDepth = las.well['STRT']?.value ?? (las.data[0]?.[0] ?? '—');
  const stopDepth  = las.well['STOP']?.value ?? (las.data[las.data.length - 1]?.[0] ?? '—');
  const step       = las.well['STEP']?.value ?? '—';

  return { curves, indexCurve, rowCount, startDepth, stopDepth, step };
}

/**
 * Extract x/y arrays for a single curve by column index.
 * Null values (matching las.nullValue) are filtered out.
 *
 * @param {ReturnType<typeof parseLAS>} las
 * @param {number} curveIndex  — column index in las.data rows
 * @returns {{ xs: number[], ys: number[], indexName: string, units: string } | null}
 */
export function extractLasCurve(las, curveIndex) {
  if (curveIndex < 0 || curveIndex >= las.curves.length) return null;
  if (!las.data.length) return null;

  const NULL = las.nullValue;
  const xs = [], ys = [];

  for (const row of las.data) {
    const x = row[0];           // index channel is always column 0
    const y = row[curveIndex];
    if (x === undefined || y === undefined) continue;
    if (x === NULL || y === NULL) continue;
    if (!isFinite(x) || !isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }

  // Downsample to max 1 000 points
  const MAX = 1000;
  if (xs.length > MAX) {
    const step = Math.ceil(xs.length / MAX);
    return {
      xs:        xs.filter((_, i) => i % step === 0),
      ys:        ys.filter((_, i) => i % step === 0),
      indexName: las.curves[0]?.mnem ?? 'DEPTH',
      units:     las.curves[curveIndex]?.unit ?? '',
    };
  }

  return {
    xs,
    ys,
    indexName: las.curves[0]?.mnem ?? 'DEPTH',
    units:     las.curves[curveIndex]?.unit ?? '',
  };
}
