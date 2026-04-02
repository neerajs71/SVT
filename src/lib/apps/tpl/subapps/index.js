import Saturation from './Saturation.svelte';

/**
 * Registry of TPL sub-apps.
 * Each entry: { id, label, description, component }
 */
export const SUBAPP_REGISTRY = {
  saturation: {
    id:          'saturation',
    label:       'Saturation',
    description: 'Water saturation — Archie, Simandoux, Indonesian',
    component:   Saturation,
  },
};
