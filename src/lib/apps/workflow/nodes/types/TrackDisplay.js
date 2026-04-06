/**
 * TrackDisplay — OUTPUT node
 * Receives one array curve and renders a depth track inside the workflow canvas.
 * The actual SVG rendering is handled by NodeCanvas (this node just carries config).
 */
export default {
  id:       'TrackDisplay',
  label:    'Track Display',
  category: 'output',
  colour:   '#dc2626',

  inputs: [
    { key: 'data',     label: 'Curve',     dataType: 'array'  },
    { key: 'depthMin', label: 'Depth min', dataType: 'scalar' },
    { key: 'depthMax', label: 'Depth max', dataType: 'scalar' },
  ],
  outputs: [],

  params: [
    { key: 'label',  label: 'Track label', type: 'text',   default: 'Track'   },
    { key: 'colour', label: 'Colour',      type: 'colour', default: '#2563eb' },
    { key: 'xMin',   label: 'X min',       type: 'number', default: 0         },
    { key: 'xMax',   label: 'X max',       type: 'number', default: 1         },
    { key: 'height', label: 'Height (px)', type: 'number', default: 300       },
  ],

  // compute stores the curve data for retrieval by the canvas renderer
  compute(inputs, params) {
    const { data } = inputs;
    if (!data) return { _display: null };

    const dMin = inputs.depthMin ?? null;
    const dMax = inputs.depthMax ?? null;

    // Filter to depth range if provided
    let depths = data.depths;
    let values = data.values;
    if (dMin !== null || dMax !== null) {
      const mn = dMin ?? -Infinity;
      const mx = dMax ?? Infinity;
      const idx = [];
      for (let i = 0; i < depths.length; i++) {
        if (depths[i] >= mn && depths[i] <= mx) idx.push(i);
      }
      depths = new Float64Array(idx.map(i => data.depths[i]));
      values = new Float64Array(idx.map(i => data.values[i]));
    }

    return {
      _display: {
        depths, values,
        label:  params.label  ?? 'Track',
        colour: params.colour ?? '#2563eb',
        xMin:   Number(params.xMin ?? 0),
        xMax:   Number(params.xMax ?? 1),
        height: Number(params.height ?? 300),
      }
    };
  },
};
