/**
 * Hardcoded sample files to auto-open on load (dev convenience).
 * Each entry is the full path as it appears in the remote Drive tree.
 * Edit this list to change which tabs open automatically.
 *
 * TPL_PATH: update with the actual Drive path once the file is uploaded.
 */
const W1 = 'SAMPLE_1/fields/FIELD_FICTION/wells/W1';

export const SAMPLE_TABS = [
  // ── Well schematics (WSON) ────────────────────────────────────────────
  `${W1}/schematics/Fat_Design.wson`,
  `${W1}/schematics/W1_new2.wson`,

  // ── Plot templates (TPL) ──────────────────────────────────────────────
  `${W1}/plots/P1.tpl`,
  `${W1}/plots/P2.tpl`,

  // ── Well log files (DLIS / LAS) ───────────────────────────────────────
  `${W1}/files/166-1005A_std-proc.dlis`,
  `${W1}/files/toabaja-01_DIL_proc.dlis`,
];
