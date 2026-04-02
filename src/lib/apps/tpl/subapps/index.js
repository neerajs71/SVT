import ArchieSw from './ArchieSw.svelte';

/**
 * Registry of TPL sub-apps.
 * Each entry: { id, label, description, component }
 */
export const SUBAPP_REGISTRY = {
  archie_sw: {
    id:          'archie_sw',
    label:       'Sw — Archie',
    description: "Water saturation via Archie's formula",
    component:   ArchieSw,
  },
};
