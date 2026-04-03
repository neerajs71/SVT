/**
 * CurveSource — SOURCE node
 * Pulls one named curve from a LAS or DLIS file slot.
 * Output: array { depths, values }
 */
export default {
  id:       'CurveSource',
  label:    'Curve Source',
  category: 'source',
  colour:   '#16a34a',

  inputs:  [],
  outputs: [
    { key: 'out', label: 'Curve', dataType: 'array' },
  ],

  params: [
    { key: 'slot',  label: 'File slot', type: 'text',   default: 'F1' },
    { key: 'curve', label: 'Mnemonic',  type: 'text',   default: 'GR' },
  ],

  // compute is called by engine with (inputs, params, slotData)
  // slotData: Map<slotKey, { depths: Float64Array, curves: Map<mnemonic, Float64Array> }>
  compute(inputs, params, slotData) {
    const slot = slotData?.get(params.slot);
    if (!slot) throw new Error(`Slot "${params.slot}" not loaded`);
    const values = slot.curves.get(params.curve.toUpperCase());
    if (!values) throw new Error(`Curve "${params.curve}" not found in ${params.slot}`);
    return { out: { depths: slot.depths, values } };
  },
};
