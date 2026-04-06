/**
 * SVTC client-side library registry for dynamic component compilation.
 *
 * Sets up window.__SVTC__ with all modules that generated .svelte components
 * are allowed to import. The compile endpoint transforms $lib/... import
 * statements to window.__SVTC__['$lib/...'] lookups, so the compiled component
 * uses the live, already-running module instances (same tabStore etc).
 *
 * Call initLibs() once before mounting any compiled component.
 */

let initialized = false;

export async function initLibs() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const [
    svelteInternalClient,
    tabs,
    datasource,
    lasParser,
    fileActions,
  ] = await Promise.all([
    import('svelte/internal/client'),
    import('$lib/tabs/tabs.svelte.js'),
    import('$lib/datasource/store.svelte.js'),
    import('$lib/apps/las/parser.js'),
    import('$lib/apps/shared/fileActions.js'),
  ]);

  window.__SVTC__ = {
    // Svelte runtime — compiled components use this as `import * as $ from 'svelte/internal/client'`
    'svelte/internal/client': svelteInternalClient,

    // App libraries — available to generated components via $lib/... imports
    '$lib/tabs/tabs.svelte.js':           tabs,
    '$lib/datasource/store.svelte.js':    datasource,
    '$lib/apps/las/parser.js':            lasParser,
    '$lib/apps/shared/fileActions.js':    fileActions,
  };
}
