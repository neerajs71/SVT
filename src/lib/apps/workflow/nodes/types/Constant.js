/**
 * Constant — SOURCE node
 * Emits a fixed scalar value (Rw, a, m, n, GRmin, GRmax, …).
 * Output: scalar (number)
 */
export default {
  id:       'Constant',
  label:    'Constant',
  category: 'source',
  colour:   '#6b7280',

  inputs:  [],
  outputs: [
    { key: 'val', label: 'Value', dataType: 'scalar' },
  ],

  params: [
    { key: 'label', label: 'Name',  type: 'text',   default: 'value' },
    { key: 'value', label: 'Value', type: 'number', default: 1 },
  ],

  compute(inputs, params) {
    return { val: Number(params.value) };
  },
};
