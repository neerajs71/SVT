/**
 * DLIS parsing utilities — thin wrappers around the parser library.
 */

import * as DLIS from '$lib/ts/dlis/index';

/** @param {ArrayBuffer} arrayBuffer */
export async function parseDLISFile(arrayBuffer) {
  if (!DLIS.Validator.isDLISFile(arrayBuffer)) {
    throw new Error('Not a valid DLIS file.');
  }
  return DLIS.parse(arrayBuffer);
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
