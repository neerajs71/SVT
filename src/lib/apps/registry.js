/**
 * App Registry
 *
 * Maps file extensions to Svelte app components.
 * Components receive a `tab` prop: { id, name, ext, file, driveId }
 * and are responsible for loading their own content.
 *
 * Add new entries here as new app types are implemented.
 */

import GenericApp from './generic/GenericApp.svelte';
import DlisApp from './dlis/DlisApp.svelte';
import LasApp from './las/LasApp.svelte';
import WsonApp from './wson/WsonApp.svelte';
import TplApp from './tpl/TplApp.svelte';

export const appRegistry = {
  // DLIS well-log files
  '.dlis':  DlisApp,
  '.dlis1': DlisApp,
  // LAS well-log files
  '.las':   LasApp,
  '.las2':  LasApp,
  // Well schematic files
  '.wson':  WsonApp,
  // Plot template files
  '.tpl':   TplApp,
  // text / markup
  '.txt':  GenericApp,
  '.md':   GenericApp,
  '.json': GenericApp,
  '.xml':  GenericApp,
  '.csv':  GenericApp,
  '.log':  GenericApp,
  '.js':   GenericApp,
  '.ts':   GenericApp,
  '.py':   GenericApp,
};

/**
 * Resolve the app component for a given file extension.
 * Falls back to GenericApp for unregistered extensions.
 *
 * @param {string} ext - e.g. '.las'
 * @returns {typeof import('svelte').SvelteComponent}
 */
export function getApp(ext) {
  return appRegistry[ext.toLowerCase()] ?? GenericApp;
}
