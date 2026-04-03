/**
 * Arithmetic — TRANSFORM node
 * Generic element-wise math on two inputs (array op array, array op scalar, scalar op scalar).
 * ops: add, sub, mul, div, pow
 */

export default {
  id:       'Arithmetic',
  label:    'Arithmetic',
  category: 'transform',
  colour:   '#7c3aed',

  inputs: [
    { key: 'a', label: 'A', dataType: 'any' },
    { key: 'b', label: 'B', dataType: 'any' },
  ],
  outputs: [
    { key: 'out', label: 'Out', dataType: 'any' },
  ],

  params: [
    {
      key: 'op', label: 'Operation', type: 'select', default: 'add',
      options: [
        { value: 'add', label: 'A + B' },
        { value: 'sub', label: 'A − B' },
        { value: 'mul', label: 'A × B' },
        { value: 'div', label: 'A ÷ B' },
        { value: 'pow', label: 'A ^ B' },
      ],
    },
  ],

  compute(inputs, params) {
    const { a, b } = inputs;
    const op = params.op ?? 'add';

    const applyOp = (x, y) => {
      switch (op) {
        case 'add': return x + y;
        case 'sub': return x - y;
        case 'mul': return x * y;
        case 'div': return y !== 0 ? x / y : NaN;
        case 'pow': return x ** y;
      }
    };

    // Both scalars
    if (typeof a === 'number' && typeof b === 'number') {
      return { out: applyOp(a, b) };
    }

    // At least one is an array
    const arr = typeof a === 'object' ? a : b;
    const scalarA = typeof a === 'number' ? a : null;
    const scalarB = typeof b === 'number' ? b : null;
    const arrA    = typeof a === 'object' ? a.values : null;
    const arrB    = typeof b === 'object' ? b.values : null;

    const n = arr.values.length;
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = arrA ? arrA[i] : scalarA;
      const y = arrB ? arrB[i] : scalarB;
      values[i] = applyOp(x, y);
    }
    return { out: { depths: arr.depths, values } };
  },
};
