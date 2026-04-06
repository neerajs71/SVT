/**
 * TPL template parser + LAS curve extractor.
 */

export function parseTpl(text) {
  return JSON.parse(text);
}

/**
 * Extract one curve from a parsed LAS object.
 * Returns { depths[], values[] } or null if mnemonic not found.
 */
export function extractLasCurve(las, mnemonic) {
  if (!las?.curves || !las?.data) return null;
  const upper = mnemonic.toUpperCase();
  const curveIdx = las.curves.findIndex(c => c.mnem === upper);
  if (curveIdx === -1) return null;

  const nv = las.nullValue ?? -999.25;
  const depths = [], values = [];
  for (const row of las.data) {
    const d = row[0], v = row[curveIdx];
    if (d === nv || v === nv || !isFinite(d) || !isFinite(v)) continue;
    depths.push(d);
    values.push(v);
  }
  return { depths, values };
}

/**
 * Extract well name from a parsed LAS object, falling back to filename.
 */
export function getLasWellName(las, fallback = 'Unknown Well') {
  return las?.well?.WELL?.value?.trim() ||
         las?.well?.WN?.value?.trim() ||
         fallback;
}

/**
 * Recursively collect all files from a datasource tree node.
 */
export function collectFiles(node, parentPath = '') {
  const items = [];
  for (const [name, child] of Object.entries(node?.children ?? {})) {
    const path = parentPath ? `${parentPath}/${name}` : name;
    if (child.type === 'file') {
      items.push({ ...child, path, name });
    } else {
      items.push(...collectFiles(child, path));
    }
  }
  return items;
}
