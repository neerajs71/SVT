/**
 * SwSimandoux — COMPUTE node
 * Simandoux water saturation (quadratic solution).
 *
 * 1/Rt = (φ^m / (a·Rw)) · Sw² + (Vcl/Rcl) · Sw
 * Solve quadratic: A·Sw² + B·Sw − 1/Rt = 0
 *   A = φ^m / (a·Rw)
 *   B = Vcl / Rcl
 */
export default {
  id:       'SwSimandoux',
  label:    'Sw — Simandoux',
  category: 'compute',
  colour:   '#7c3aed',

  inputs: [
    { key: 'phi', label: 'φ (porosity)', dataType: 'array'  },
    { key: 'rt',  label: 'Rt (resist.)', dataType: 'array'  },
    { key: 'vcl', label: 'Vcl',          dataType: 'array'  },
    { key: 'rw',  label: 'Rw (ohm·m)',   dataType: 'scalar' },
    { key: 'rcl', label: 'Rcl (ohm·m)',  dataType: 'scalar' },
    { key: 'a',   label: 'a',            dataType: 'scalar' },
    { key: 'm',   label: 'm',            dataType: 'scalar' },
    { key: 'n',   label: 'n',            dataType: 'scalar' },
  ],
  outputs: [
    { key: 'sw', label: 'Sw', dataType: 'array' },
  ],

  params: [
    { key: 'rw',  label: 'Rw (ohm·m)',  type: 'number', default: 0.05 },
    { key: 'rcl', label: 'Rcl (ohm·m)', type: 'number', default: 4    },
    { key: 'a',   label: 'a',           type: 'number', default: 1    },
    { key: 'm',   label: 'm',           type: 'number', default: 2    },
    { key: 'n',   label: 'n',           type: 'number', default: 2    },
  ],

  formula: '1/Rt = (φ^m/a·Rw)·Sw² + (Vcl/Rcl)·Sw',

  compute(inputs, params) {
    const { phi, rt, vcl } = inputs;
    if (!phi) throw new Error('SwSimandoux: porosity not connected');
    if (!rt)  throw new Error('SwSimandoux: resistivity not connected');
    if (!vcl) throw new Error('SwSimandoux: Vclay not connected');

    const rw  = inputs.rw  ?? Number(params.rw);
    const rcl = inputs.rcl ?? Number(params.rcl);
    const a   = inputs.a   ?? Number(params.a);
    const m   = inputs.m   ?? Number(params.m);

    const rtMap  = new Map(Array.from(rt.depths).map((d, i)  => [d, rt.values[i]]));
    const vclMap = new Map(Array.from(vcl.depths).map((d, i) => [d, vcl.values[i]]));

    const depths = [], swVals = [];
    for (let i = 0; i < phi.depths.length; i++) {
      const d  = phi.depths[i];
      const p  = phi.values[i];
      const r  = rtMap.get(d);
      const vc = vclMap.get(d);
      if (r == null || vc == null || p <= 0 || r <= 0) continue;

      const A = (p ** m) / (a * rw);
      const B = vc / (rcl || 1);
      // A·Sw² + B·Sw − 1/Rt = 0  →  Sw = (−B + √(B²+4A/Rt)) / (2A)
      const disc = B * B + 4 * A / r;
      if (disc < 0) continue;
      const sw = Math.max(0, Math.min(1, (-B + Math.sqrt(disc)) / (2 * A)));
      depths.push(d);
      swVals.push(sw);
    }
    return { sw: { depths: new Float64Array(depths), values: new Float64Array(swVals) } };
  },
};
