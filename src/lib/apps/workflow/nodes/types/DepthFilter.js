/**
 * DepthFilter — FILTER node
 * Clips an array curve to a depth range [depthMin, depthMax].
 */
export default {
  id:       'DepthFilter',
  label:    'Depth Filter',
  category: 'filter',
  colour:   '#0891b2',

  inputs: [
    { key: 'in',       label: 'Curve',     dataType: 'array'  },
    { key: 'depthMin', label: 'Depth min', dataType: 'scalar' },
    { key: 'depthMax', label: 'Depth max', dataType: 'scalar' },
  ],
  outputs: [
    { key: 'out', label: 'Clipped', dataType: 'array' },
  ],

  params: [
    { key: 'depthMin', label: 'Depth min', type: 'number', default: 0 },
    { key: 'depthMax', label: 'Depth max', type: 'number', default: 5000 },
  ],

  compute(inputs, params) {
    const curve = inputs.in;
    if (!curve) throw new Error('DepthFilter: no input connected');
    const dMin = inputs.depthMin ?? Number(params.depthMin);
    const dMax = inputs.depthMax ?? Number(params.depthMax);

    const indices = [];
    for (let i = 0; i < curve.depths.length; i++) {
      if (curve.depths[i] >= dMin && curve.depths[i] <= dMax) indices.push(i);
    }

    const depths = new Float64Array(indices.map(i => curve.depths[i]));
    const values = new Float64Array(indices.map(i => curve.values[i]));
    return { out: { depths, values } };
  },
};
