/**
 * Vclay — TRANSFORM node
 * Computes volume of clay from IGR using one of 5 methods.
 *
 * Inputs:  igr (array)
 * Output:  vcl (array, same depths)
 * Params:  method — 'linear' | 'larionov_old' | 'larionov_tertiary' | 'clavier' | 'steiber'
 */

function vclFrom(igr, method) {
  const I = igr;
  switch (method) {
    case 'larionov_old':       return 0.33 * (2 ** (2 * I) - 1);
    case 'larionov_tertiary':  return 0.083 * (2 ** (3.7 * I) - 1);
    case 'clavier':            return 1.7 - Math.sqrt(3.38 - (I + 0.7) ** 2);
    case 'steiber':            return I / (3 - 2 * I);
    default:                   return I;  // linear
  }
}

export default {
  id:       'Vclay',
  label:    'Vclay',
  category: 'transform',
  colour:   '#d97706',

  inputs: [
    { key: 'igr', label: 'IGR', dataType: 'array' },
  ],
  outputs: [
    { key: 'vcl', label: 'Vcl', dataType: 'array' },
  ],

  params: [
    {
      key: 'method', label: 'Method', type: 'select', default: 'linear',
      options: [
        { value: 'linear',              label: 'Linear (IGR)' },
        { value: 'larionov_old',        label: 'Larionov Older Rocks' },
        { value: 'larionov_tertiary',   label: 'Larionov Tertiary' },
        { value: 'clavier',             label: 'Clavier' },
        { value: 'steiber',             label: 'Steiber' },
      ],
    },
  ],

  compute(inputs, params) {
    const { igr } = inputs;
    if (!igr) throw new Error('Vclay: IGR input not connected');
    const method = params.method ?? 'linear';
    const values = new Float64Array(igr.values.length);
    for (let i = 0; i < igr.values.length; i++) {
      values[i] = Math.max(0, Math.min(1, vclFrom(igr.values[i], method)));
    }
    return { vcl: { depths: igr.depths, values } };
  },

  // Formula strings for display
  formulas: {
    linear:             'Vcl = IGR',
    larionov_old:       'Vcl = 0.33 × (2^(2·IGR) − 1)',
    larionov_tertiary:  'Vcl = 0.083 × (2^(3.7·IGR) − 1)',
    clavier:            'Vcl = 1.7 − √(3.38 − (IGR+0.7)²)',
    steiber:            'Vcl = IGR / (3 − 2·IGR)',
  },
};
