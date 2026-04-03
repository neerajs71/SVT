/**
 * SwIndonesian — COMPUTE node
 * Indonesian (Poupon-Leveaux) water saturation.
 *
 * 1/√Rt = [φ^(m/2)/√(a·Rw)] · Sw^(n/2) + [Vcl^(1−Vcl/2)/√Rcl] · Sw^(n/2)
 * Solved iteratively (Newton) or via the closed-form rearrangement.
 */
export default {
  id:       'SwIndonesian',
  label:    'Sw — Indonesian',
  category: 'compute',
  colour:   '#0891b2',

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

  formula: '1/√Rt = [φ^(m/2)/√(a·Rw) + Vcl^(1−Vcl/2)/√Rcl] · Sw^(n/2)',

  compute(inputs, params) {
    const { phi, rt, vcl } = inputs;
    if (!phi) throw new Error('SwIndonesian: porosity not connected');
    if (!rt)  throw new Error('SwIndonesian: resistivity not connected');
    if (!vcl) throw new Error('SwIndonesian: Vclay not connected');

    const rw  = inputs.rw  ?? Number(params.rw);
    const rcl = inputs.rcl ?? Number(params.rcl);
    const a   = inputs.a   ?? Number(params.a);
    const m   = inputs.m   ?? Number(params.m);
    const n   = inputs.n   ?? Number(params.n);

    const rtMap  = new Map(Array.from(rt.depths).map((d, i)  => [d, rt.values[i]]));
    const vclMap = new Map(Array.from(vcl.depths).map((d, i) => [d, vcl.values[i]]));

    const depths = [], swVals = [];
    for (let i = 0; i < phi.depths.length; i++) {
      const d  = phi.depths[i];
      const p  = phi.values[i];
      const r  = rtMap.get(d);
      const vc = vclMap.get(d);
      if (r == null || vc == null || p <= 0 || r <= 0) continue;

      // C = 1/√Rt; coefficient = φ^(m/2)/√(a·Rw) + Vcl^(1−Vcl/2)/√Rcl
      const C   = 1 / Math.sqrt(r);
      const coeff = (p ** (m / 2)) / Math.sqrt(a * rw)
                  + (vc ** (1 - vc / 2)) / Math.sqrt(rcl || 1);
      if (coeff <= 0) continue;
      // Sw^(n/2) = C / coeff  →  Sw = (C/coeff)^(2/n)
      const sw = Math.max(0, Math.min(1, (C / coeff) ** (2 / n)));
      depths.push(d);
      swVals.push(sw);
    }
    return { sw: { depths: new Float64Array(depths), values: new Float64Array(swVals) } };
  },
};
