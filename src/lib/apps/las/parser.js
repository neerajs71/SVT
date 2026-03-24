/**
 * LAS (Log ASCII Standard) parser — supports LAS 1.2 and 2.0.
 *
 * LAS file structure:
 *   ~V  VERSION section   – VERS, WRAP
 *   ~W  WELL section      – STRT, STOP, STEP, NULL, COMP, WELL, …
 *   ~C  CURVE section     – one line per channel: MNEM.UNIT :DESC
 *   ~P  PARAMETER section – optional well parameters
 *   ~O  OTHER section     – free text
 *   ~A  ASCII data        – whitespace-delimited numbers, one row per depth
 */

/**
 * Parse one LAS information line into its parts.
 * Format:  MNEM.UNIT  value  :description
 * @param {string} line
 * @returns {{ mnem:string, unit:string, value:string, desc:string } | null}
 */
function parseInfoLine(line) {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) return null;

  const before = line.slice(0, colonIdx);
  const desc   = line.slice(colonIdx + 1).trim();

  const dotIdx = before.indexOf('.');
  if (dotIdx === -1) return null;

  const mnem     = before.slice(0, dotIdx).trim().toUpperCase();
  const afterDot = before.slice(dotIdx + 1);
  const spaceIdx = afterDot.search(/\s/);
  const unit  = (spaceIdx === -1 ? afterDot : afterDot.slice(0, spaceIdx)).trim();
  const value = (spaceIdx === -1 ? ''       : afterDot.slice(spaceIdx)).trim();

  return { mnem, unit, value, desc };
}

/**
 * Identify the single-letter type of a section header line (e.g. '~W …' → 'W').
 * @param {string} line  Must start with '~'
 * @returns {string}
 */
function sectionType(line) {
  return (line[1] ?? '').toUpperCase();
}

/**
 * Parse a LAS file (given as a string) into a structured object.
 *
 * @param {string} text
 * @returns {{
 *   version: string|null,
 *   wrap: boolean,
 *   nullValue: number,
 *   well: Record<string,{value:string,unit:string,desc:string}>,
 *   curves: Array<{mnem:string,unit:string,desc:string}>,
 *   params: Array<{mnem:string,unit:string,value:string,desc:string}>,
 *   data: number[][],
 * }}
 */
export function parseLAS(text) {
  const result = {
    version:   null,
    wrap:      false,
    nullValue: -999.25,
    well:      {},
    curves:    [],
    params:    [],
    data:      [],
  };

  const lines = text.split(/\r?\n/);
  let section = null;      // current section letter
  let inData  = false;

  // Buffer for WRAP=YES multi-line rows
  let wrapBuffer = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Blank or comment
    if (!line || line.startsWith('#')) continue;

    // Section header
    if (line.startsWith('~')) {
      const t = sectionType(line);
      if (t === 'A') {
        inData  = true;
        section = 'A';
        wrapBuffer = [];
      } else {
        inData  = false;
        section = t;
      }
      continue;
    }

    // ASCII data section
    if (inData) {
      const tokens = line.split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      const nums = tokens.map(Number);
      if (nums.some(isNaN)) continue; // skip non-numeric rows

      if (result.wrap) {
        // WRAP YES: accumulate tokens across lines until we have enough for one row
        wrapBuffer.push(...nums);
        const nc = result.curves.length || 1;
        while (wrapBuffer.length >= nc) {
          result.data.push(wrapBuffer.splice(0, nc));
        }
      } else {
        result.data.push(nums);
      }
      continue;
    }

    // Info sections
    if (!section) continue;
    const item = parseInfoLine(line);
    if (!item) continue;

    if (section === 'V') {
      if (item.mnem === 'VERS') result.version   = item.value.trim() || null;
      if (item.mnem === 'WRAP') result.wrap       = item.value.trim().toUpperCase() === 'YES';
    }

    if (section === 'W') {
      if (item.mnem === 'NULL') {
        const n = parseFloat(item.value);
        if (!isNaN(n)) result.nullValue = n;
      }
      result.well[item.mnem] = { value: item.value.trim(), unit: item.unit, desc: item.desc };
    }

    if (section === 'C') {
      result.curves.push({ mnem: item.mnem, unit: item.unit, desc: item.desc });
    }

    if (section === 'P') {
      result.params.push(item);
    }
  }

  // Flush any leftover wrap buffer
  if (result.wrap && wrapBuffer.length) {
    result.data.push(wrapBuffer);
  }

  return result;
}
