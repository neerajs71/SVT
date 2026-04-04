/**
 * Well-log measurement type registry.
 *
 * Each entry defines:
 *   id          — stable key stored in curveDefinition.measurementType
 *   name        — display name
 *   units       — ordered list of allowed unit strings
 *   defaultUnit — pre-selected unit
 *   defaultMin  — suggested xMin
 *   defaultMax  — suggested xMax
 *   scaleType   — 'linear' | 'logarithmic'
 */
export const MEASUREMENT_TYPES = [
  // ── Depth / Index ──────────────────────────────────────────────────────
  { id: 'depth',          name: 'Depth',                units: ['ft', 'm'],               defaultUnit: 'ft',    defaultMin: 0,      defaultMax: 5000,   scaleType: 'linear' },

  // ── Natural Gamma Ray ──────────────────────────────────────────────────
  { id: 'gamma_ray',      name: 'Gamma Ray',            units: ['API', 'gAPI'],            defaultUnit: 'API',   defaultMin: 0,      defaultMax: 150,    scaleType: 'linear' },

  // ── Resistivity ────────────────────────────────────────────────────────
  { id: 'resistivity',    name: 'Resistivity',          units: ['ohm·m', 'Ω·m'],           defaultUnit: 'ohm·m', defaultMin: 0.2,    defaultMax: 2000,   scaleType: 'logarithmic' },

  // ── Density ────────────────────────────────────────────────────────────
  { id: 'density',        name: 'Bulk Density',         units: ['g/cc', 'kg/m³'],          defaultUnit: 'g/cc',  defaultMin: 1.95,   defaultMax: 2.95,   scaleType: 'linear' },
  { id: 'density_corr',   name: 'Density Correction',  units: ['g/cc', 'kg/m³'],          defaultUnit: 'g/cc',  defaultMin: -0.2,   defaultMax: 0.2,    scaleType: 'linear' },

  // ── Neutron Porosity ───────────────────────────────────────────────────
  { id: 'neutron_por',    name: 'Neutron Porosity',     units: ['%', 'v/v', 'dec'],        defaultUnit: '%',     defaultMin: 45,     defaultMax: -15,    scaleType: 'linear' },

  // ── Sonic ──────────────────────────────────────────────────────────────
  { id: 'dt',             name: 'Sonic DT',             units: ['µs/ft', 'µs/m', 'ns/m'], defaultUnit: 'µs/ft', defaultMin: 140,    defaultMax: 40,     scaleType: 'linear' },
  { id: 'dtc',            name: 'Compressional DT',     units: ['µs/ft', 'µs/m'],         defaultUnit: 'µs/ft', defaultMin: 140,    defaultMax: 40,     scaleType: 'linear' },
  { id: 'dts',            name: 'Shear DT',             units: ['µs/ft', 'µs/m'],         defaultUnit: 'µs/ft', defaultMin: 340,    defaultMax: 40,     scaleType: 'linear' },

  // ── Caliper / Diameter ─────────────────────────────────────────────────
  { id: 'caliper',        name: 'Caliper',              units: ['in', 'mm', 'cm'],         defaultUnit: 'in',    defaultMin: 6,      defaultMax: 16,     scaleType: 'linear' },

  // ── Spontaneous Potential ──────────────────────────────────────────────
  { id: 'sp',             name: 'SP',                   units: ['mV'],                     defaultUnit: 'mV',    defaultMin: -160,   defaultMax: 40,     scaleType: 'linear' },

  // ── Photoelectric Factor ───────────────────────────────────────────────
  { id: 'pef',            name: 'Photoelectric Factor', units: ['b/e'],                    defaultUnit: 'b/e',   defaultMin: 0,      defaultMax: 10,     scaleType: 'linear' },

  // ── Porosity (computed) ────────────────────────────────────────────────
  { id: 'porosity',       name: 'Porosity',             units: ['%', 'v/v', 'dec'],        defaultUnit: '%',     defaultMin: 45,     defaultMax: -15,    scaleType: 'linear' },

  // ── Water Saturation ───────────────────────────────────────────────────
  { id: 'sw',             name: 'Water Saturation',     units: ['%', 'v/v', 'dec'],        defaultUnit: '%',     defaultMin: 0,      defaultMax: 100,    scaleType: 'linear' },

  // ── Volume of Shale ────────────────────────────────────────────────────
  { id: 'vsh',            name: 'Volume of Shale',      units: ['%', 'v/v', 'dec'],        defaultUnit: '%',     defaultMin: 0,      defaultMax: 100,    scaleType: 'linear' },

  // ── Temperature ────────────────────────────────────────────────────────
  { id: 'temperature',    name: 'Temperature',          units: ['°F', '°C', 'K'],          defaultUnit: '°F',    defaultMin: 60,     defaultMax: 300,    scaleType: 'linear' },

  // ── Pressure ───────────────────────────────────────────────────────────
  { id: 'pressure',       name: 'Pressure',             units: ['psi', 'kPa', 'MPa', 'bar'], defaultUnit: 'psi', defaultMin: 0,    defaultMax: 10000,  scaleType: 'linear' },

  // ── Velocity ───────────────────────────────────────────────────────────
  { id: 'velocity',       name: 'Velocity',             units: ['ft/s', 'm/s', 'km/s'],    defaultUnit: 'ft/s',  defaultMin: 5000,   defaultMax: 20000,  scaleType: 'linear' },

  // ── Acoustic Impedance ─────────────────────────────────────────────────
  { id: 'ai',             name: 'Acoustic Impedance',   units: ['g/cc·ft/s', 'kg/m²·s'],  defaultUnit: 'g/cc·ft/s', defaultMin: 0, defaultMax: 60000, scaleType: 'linear' },

  // ── Permeability ───────────────────────────────────────────────────────
  { id: 'permeability',   name: 'Permeability',         units: ['mD', 'D'],                defaultUnit: 'mD',    defaultMin: 0.01,   defaultMax: 1000,   scaleType: 'logarithmic' },

  // ── ROP ────────────────────────────────────────────────────────────────
  { id: 'rop',            name: 'ROP',                  units: ['ft/hr', 'm/hr'],          defaultUnit: 'ft/hr', defaultMin: 0,      defaultMax: 200,    scaleType: 'linear' },

  // ── Generic fallback ───────────────────────────────────────────────────
  { id: 'custom',         name: 'Custom',               units: [],                         defaultUnit: '',      defaultMin: 0,      defaultMax: 100,    scaleType: 'linear' },
];

/** Look up a measurement type by id. Returns undefined if not found. */
export function getMeasurementType(id) {
  return MEASUREMENT_TYPES.find(m => m.id === id);
}

/**
 * Common mnemonic prefixes → measurement type id.
 * Used as a display fallback when no unit is explicitly set on a curve.
 */
const MNEMONIC_MAP = {
  // Depth / index
  DEPT: 'depth', MD: 'depth', TVDSS: 'depth', TVDSD: 'depth', DEPTH: 'depth',
  // Gamma Ray
  GR: 'gamma_ray', GRGC: 'gamma_ray', GRTO: 'gamma_ray', SGR: 'gamma_ray', CGR: 'gamma_ray', GRD: 'gamma_ray',
  // Resistivity
  ILD: 'resistivity', ILM: 'resistivity', MSFL: 'resistivity',
  RT: 'resistivity', RLLD: 'resistivity', RILD: 'resistivity', RILM: 'resistivity',
  LLD: 'resistivity', LLS: 'resistivity', RFOC: 'resistivity', RXO: 'resistivity',
  AT10: 'resistivity', AT20: 'resistivity', AT30: 'resistivity', AT60: 'resistivity', AT90: 'resistivity',
  // Density
  RHOB: 'density', RHOZ: 'density', DEN: 'density', ZDEN: 'density',
  DRHO: 'density_corr',
  // Neutron porosity
  NPHI: 'neutron_por', CNPHI: 'neutron_por', TNPH: 'neutron_por', DPHI: 'neutron_por',
  // Sonic
  DT: 'dt', DTC: 'dtc', DTCO: 'dtc', DTS: 'dts', DTSM: 'dts',
  // Caliper
  CALI: 'caliper', CAL: 'caliper', HCAL: 'caliper', C1: 'caliper', C2: 'caliper',
  // SP
  SP: 'sp',
  // PEF
  PE: 'pef', PEF: 'pef', PEFZ: 'pef',
  // Porosity / Saturation / Vsh
  PHIT: 'porosity', PHIE: 'porosity', PHID: 'porosity', PHIN: 'porosity',
  SW: 'sw', SWT: 'sw', SWE: 'sw', SXO: 'sw',
  VSH: 'vsh', VCL: 'vsh', VSHGR: 'vsh',
  // Temperature / Pressure
  TEMP: 'temperature', BHT: 'temperature',
  PRES: 'pressure', WHP: 'pressure',
  // Velocity
  VP: 'velocity', VS: 'velocity',
  // ROP
  ROP: 'rop', ROPMS: 'rop',
};

/**
 * Return the default unit for a curve mnemonic, inferred by name.
 * e.g. 'GR' → 'API', 'ILD' → 'ohm·m', 'RHOB' → 'g/cc'
 */
export function getUnitByMnemonic(mnemonic) {
  if (!mnemonic) return '';
  const upper = mnemonic.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const typeId = MNEMONIC_MAP[upper];
  if (!typeId) return '';
  return getMeasurementType(typeId)?.defaultUnit ?? '';
}
