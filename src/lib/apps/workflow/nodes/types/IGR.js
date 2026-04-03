/**
 * IGR — TRANSFORM node
 * Gamma Ray Index: IGR = clamp((GR − GRmin) / (GRmax − GRmin), 0, 1)
 *
 * Inputs:  gr (array), grMin (scalar), grMax (scalar)
 * Output:  igr (array, same depths as gr)
 */
export default {
  id:       'IGR',
  label:    'IGR',
  category: 'transform',
  colour:   '#ca8a04',

  inputs: [
    { key: 'gr',    label: 'GR',     dataType: 'array'  },
    { key: 'grMin', label: 'GR min', dataType: 'scalar' },
    { key: 'grMax', label: 'GR max', dataType: 'scalar' },
  ],
  outputs: [
    { key: 'igr', label: 'IGR', dataType: 'array' },
  ],

  params: [],  // all inputs come via ports

  compute(inputs) {
    const { gr, grMin, grMax } = inputs;
    if (!gr) throw new Error('IGR: GR input not connected');
    const min = grMin ?? 10;
    const max = grMax ?? 140;
    const range = max - min || 1;
    const values = new Float64Array(gr.values.length);
    for (let i = 0; i < gr.values.length; i++) {
      values[i] = Math.max(0, Math.min(1, (gr.values[i] - min) / range));
    }
    return { igr: { depths: gr.depths, values } };
  },
};
