/**
 * SwArchie — COMPUTE node
 * Archie water saturation: Sw = [(a × Rw) / (φ^m × Rt)]^(1/n)
 *
 * Inputs:  phi (array), rt (array), rw (scalar), a (scalar), m (scalar), n (scalar)
 * Output:  sw (array) — depth array aligned to shared depths of phi and rt
 */
export default {
  id:       'SwArchie',
  label:    'Sw — Archie',
  category: 'compute',
  colour:   '#2563eb',

  inputs: [
    { key: 'phi', label: 'φ (porosity)', dataType: 'array'  },
    { key: 'rt',  label: 'Rt (resist.)', dataType: 'array'  },
    { key: 'rw',  label: 'Rw (ohm·m)',   dataType: 'scalar' },
    { key: 'a',   label: 'a',            dataType: 'scalar' },
    { key: 'm',   label: 'm',            dataType: 'scalar' },
    { key: 'n',   label: 'n',            dataType: 'scalar' },
  ],
  outputs: [
    { key: 'sw', label: 'Sw', dataType: 'array' },
  ],

  params: [
    { key: 'rw', label: 'Rw (ohm·m)', type: 'number', default: 0.05 },
    { key: 'a',  label: 'a',          type: 'number', default: 1    },
    { key: 'm',  label: 'm',          type: 'number', default: 2    },
    { key: 'n',  label: 'n',          type: 'number', default: 2    },
  ],

  formula: 'Sw = [(a·Rw) / (φ^m · Rt)]^(1/n)',

  compute(inputs, params) {
    const { phi, rt } = inputs;
    if (!phi) throw new Error('SwArchie: porosity not connected');
    if (!rt)  throw new Error('SwArchie: resistivity not connected');

    const rw = inputs.rw ?? Number(params.rw);
    const a  = inputs.a  ?? Number(params.a);
    const m  = inputs.m  ?? Number(params.m);
    const n  = inputs.n  ?? Number(params.n);

    // Build depth-indexed lookup for rt
    const rtMap = new Map();
    for (let i = 0; i < rt.depths.length; i++) rtMap.set(rt.depths[i], rt.values[i]);

    const depths = [], swVals = [];
    for (let i = 0; i < phi.depths.length; i++) {
      const d = phi.depths[i];
      const p = phi.values[i];
      const r = rtMap.get(d);
      if (r == null || p <= 0 || r <= 0) continue;
      const sw = Math.max(0, Math.min(1, ((a * rw) / (p ** m * r)) ** (1 / n)));
      depths.push(d);
      swVals.push(sw);
    }
    return { sw: { depths: new Float64Array(depths), values: new Float64Array(swVals) } };
  },
};
