/**
 * DLIS parsing utilities — thin wrappers around the parser library.
 */

import * as DLIS from '$lib/ts/dlis/index';

/** @param {ArrayBuffer} arrayBuffer */
export async function parseDLISFile(arrayBuffer) {
  const info = DLIS.Validator.getFileInfo(arrayBuffer);
  if (!info.isValid) {
    const bytes = new Uint8Array(arrayBuffer, 0, Math.min(80, arrayBuffer.byteLength));
    // Replace non-printable bytes with '.' for display
    const printable = Array.from(bytes)
      .map(b => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : '.')
      .join('');
    const err = new Error(info.error ?? 'Unknown validation error');
    err.diagnostic = printable;
    throw err;
  }
  return DLIS.parse(arrayBuffer);
}

/**
 * Extract x/y data for a single named channel from a parse result.
 * Returns null if the channel isn't found, or an object with xs/ys arrays.
 * @param {object} parseResult
 * @param {string} channelName
 */
export function extractCurveData(parseResult, channelName) {
  for (const lf of parseResult?.logicalFiles ?? []) {
    for (const [frameKey, simpleFrame] of lf.simpleFrames) {
      const channels = simpleFrame.Channels;
      if (!channels.length) continue;

      const chIdx = channels.findIndex(c => c.ObName?.identifier === channelName);
      if (chIdx === -1) continue;

      const frameDatas = lf.frameDataDict.get(frameKey) ?? [];
      if (!frameDatas.length) return null;

      const numCh = channels.length;
      const xs = [], ys = [];

      for (const fd of frameDatas) {
        // Each fData.slots may contain multiple rows worth of data if the
        // segment packed more than one sample (numRows > 1).
        const numRows = fd.slots.length >= numCh
          ? Math.floor(fd.slots.length / numCh)
          : 0;

        if (numRows > 0) {
          for (let row = 0; row < numRows; row++) {
            const base = row * numCh;
            const rawX = fd.slots[base];          // first channel = index
            const rawY = fd.slots[base + chIdx];
            xs.push(Array.isArray(rawX) ? rawX[0] : Number(rawX));
            ys.push(Array.isArray(rawY) ? rawY[0] : Number(rawY));
          }
        } else {
          // Fallback: use frameNumber as index
          xs.push(fd.frameNumber);
          const rawY = fd.slots[chIdx];
          ys.push(rawY !== undefined
            ? (Array.isArray(rawY) ? rawY[0] : Number(rawY))
            : NaN);
        }
      }

      // Downsample to max 1 000 points so the SVG stays responsive
      const MAX = 1000;
      if (xs.length > MAX) {
        const step = Math.ceil(xs.length / MAX);
        return {
          channelName,
          units: channels[chIdx]?.Units ?? '',
          indexName: channels[0]?.ObName?.identifier ?? 'Index',
          xs: xs.filter((_, i) => i % step === 0),
          ys: ys.filter((_, i) => i % step === 0),
        };
      }

      return {
        channelName,
        units: channels[chIdx]?.Units ?? '',
        indexName: channels[0]?.ObName?.identifier ?? 'Index',
        xs,
        ys,
      };
    }
  }
  return null;
}

/**
 * Extract flat channel and frame lists from a parse result.
 * @param {object} parseResult
 */
export function processChannelsAndFrames(parseResult) {
  const channels = [];
  const frames = [];
  let totalEFLRs = 0;

  for (const lf of parseResult.logicalFiles ?? []) {
    if (!lf?.eflrList) continue;
    totalEFLRs += lf.eflrList.length;

    for (const eflr of lf.eflrList) {
      if (!eflr?.objects) continue;
      const setType = eflr.setType?.trim().toUpperCase() ?? '';

      if (setType === 'CHANNEL') {
        for (const obj of eflr.objects) {
          const name = obj.name?.identifier ?? obj.ObName?.identifier ?? '';
          if (!name) continue;
          channels.push({
            name,
            longName: getAttr(obj, 'LONG-NAME') ?? '',
            units: getAttr(obj, 'UNITS') ?? '',
            repCode: getAttr(obj, 'REPRESENTATION-CODE') ?? 0,
            dimension: getAttr(obj, 'DIMENSION') ?? 1,
            logicalFile: lf.id ?? '',
          });
        }
      }

      if (setType === 'FRAME') {
        for (const obj of eflr.objects) {
          const name = obj.name?.identifier ?? obj.ObName?.identifier ?? '';
          if (!name) continue;
          frames.push({
            name,
            indexType: getAttr(obj, 'INDEX-TYPE') ?? '',
            spacing: getAttr(obj, 'SPACING') ?? '',
            indexMin: getAttr(obj, 'INDEX-MIN') ?? '',
            indexMax: getAttr(obj, 'INDEX-MAX') ?? '',
            logicalFile: lf.id ?? '',
          });
        }
      }
    }
  }

  return { channels, frames, totalEFLRs };
}

/**
 * Extract all curves in one pass for the multi-track well log view.
 * Processes the first frame found across all logical files.
 * @param {object} parseResult
 * @returns {{ tracks: Array, indexName: string, dMin: number, dMax: number }}
 */
export function extractAllCurvesForTracks(parseResult) {
  const MAX_PTS = 600;

  for (const lf of parseResult?.logicalFiles ?? []) {
    for (const [frameKey, simpleFrame] of lf.simpleFrames) {
      const channels = simpleFrame.Channels;
      if (!channels.length) continue;

      const frameDatas = lf.frameDataDict.get(frameKey) ?? [];
      if (!frameDatas.length) continue;

      const numCh = channels.length;

      // Collect all rows: each row is [ch0, ch1, ch2, ...]
      const rows = [];
      for (const fd of frameDatas) {
        const numRows = fd.slots.length >= numCh
          ? Math.floor(fd.slots.length / numCh)
          : 0;

        if (numRows > 0) {
          for (let r = 0; r < numRows; r++) {
            const base = r * numCh;
            rows.push(
              channels.map((_, ci) => {
                const raw = fd.slots[base + ci];
                return Array.isArray(raw) ? raw[0] : Number(raw);
              })
            );
          }
        } else {
          rows.push(
            channels.map((_, ci) => {
              const raw = fd.slots[ci];
              return raw !== undefined ? (Array.isArray(raw) ? raw[0] : Number(raw)) : NaN;
            })
          );
        }
      }

      // Downsample
      const step = rows.length > MAX_PTS ? Math.ceil(rows.length / MAX_PTS) : 1;
      const sampled = step > 1 ? rows.filter((_, i) => i % step === 0) : rows;

      const depths = sampled.map(r => r[0]).filter(isFinite);
      const dMin = depths.length ? Math.min(...depths) : 0;
      const dMax = depths.length ? Math.max(...depths) : 1;
      const indexName = channels[0]?.ObName?.identifier ?? 'Index';

      // One track per non-index channel
      const tracks = channels.slice(1).map((ch, ci) => {
        const colIdx = ci + 1;
        const pairs = sampled
          .map(r => [r[0], r[colIdx]])
          .filter(([d, v]) => isFinite(d) && isFinite(v));

        const depthArr = pairs.map(p => p[0]);
        const values   = pairs.map(p => p[1]);
        const vMin = values.length ? Math.min(...values) : 0;
        const vMax = values.length ? Math.max(...values) : 1;

        return {
          name:   ch.ObName?.identifier ?? `CH${colIdx}`,
          units:  ch.Units ?? '',
          depths: depthArr,
          values,
          vMin,
          vMax,
        };
      });

      return { tracks, indexName, dMin, dMax };
    }
  }

  return { tracks: [], indexName: 'Index', dMin: 0, dMax: 1 };
}

/**
 * Extract per-logical-file channel and frame summaries from a parse result.
 * Returns one entry per logical file so the caller can let the user pick one.
 *
 * @param {object} parseResult
 * @returns {Array<{ id:string, lfIndex:number, channels:Array, frames:Array }>}
 */
export function extractLogicalFiles(parseResult) {
  return (parseResult.logicalFiles ?? []).map((lf, idx) => {
    const channels = [];
    const frames   = [];

    for (const eflr of (lf.eflrList ?? [])) {
      const setType = eflr.setType?.trim().toUpperCase() ?? '';

      if (setType === 'CHANNEL') {
        for (const obj of (eflr.objects ?? [])) {
          const name = obj.name?.identifier ?? obj.ObName?.identifier ?? '';
          if (!name) continue;
          channels.push({
            name,
            units:    getAttr(obj, 'UNITS')     ?? '',
            longName: getAttr(obj, 'LONG-NAME') ?? '',
          });
        }
      }

      if (setType === 'FRAME') {
        for (const obj of (eflr.objects ?? [])) {
          frames.push({
            name:      obj.name?.identifier ?? obj.ObName?.identifier ?? '',
            indexType: getAttr(obj, 'INDEX-TYPE') ?? '',
            indexMin:  getAttr(obj, 'INDEX-MIN'),
            indexMax:  getAttr(obj, 'INDEX-MAX'),
          });
        }
      }
    }

    return { id: lf.id ?? `LF-${idx + 1}`, lfIndex: idx, channels, frames };
  });
}

function getAttr(obj, label) {
  const list = obj.attrList ?? obj.attributes ?? [];
  const attr = list.find(a => a?.label === label);
  return attr?.value ?? null;
}
