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

function getAttr(obj, label) {
  const list = obj.attrList ?? obj.attributes ?? [];
  const attr = list.find(a => a?.label === label);
  return attr?.value ?? null;
}
