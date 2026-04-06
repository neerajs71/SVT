/**
 * POST /api/compile
 *
 * Receives a .svelte source string, compiles it with svelte/compiler,
 * then transforms all import statements to use window.__SVTC__ globals
 * so the compiled module is self-contained and can be loaded via a blob URL.
 *
 * Import transformation:
 *   import * as $ from 'svelte/internal/client'
 *     → const $ = window.__SVTC__['svelte/internal/client'];
 *
 *   import { tabStore } from '$lib/tabs/tabs.svelte.js'
 *     → const { tabStore } = window.__SVTC__['$lib/tabs/tabs.svelte.js'];
 *
 *   import 'svelte/internal/disclose-version'
 *     → (removed — no-op stub)
 */

import { json, error } from '@sveltejs/kit';
import { compile } from 'svelte/compiler';

/**
 * Transform ESM import statements in compiled Svelte output to
 * window.__SVTC__ global lookups. This makes the code loadable as a
 * blob URL without needing an import map.
 *
 * @param {string} code
 * @returns {string}
 */
function transformImports(code) {
  // 1. Side-effect-only imports (e.g. disclose-version) — drop them
  code = code.replace(
    /^import\s+['"][^'"]+['"]\s*;?\r?\n?/gm,
    ''
  );

  // 2. Namespace imports: import * as NAME from 'MODULE'
  code = code.replace(
    /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/gm,
    (_, name, mod) => `const ${name} = window.__SVTC__[${JSON.stringify(mod)}];`
  );

  // 3. Named imports: import { X, Y as Z } from 'MODULE'
  code = code.replace(
    /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?/gm,
    (_, names, mod) => `const {${names}} = window.__SVTC__[${JSON.stringify(mod)}] ?? {};`
  );

  // 4. Default imports: import NAME from 'MODULE'
  code = code.replace(
    /^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]\s*;?/gm,
    (_, name, mod) => `const ${name} = window.__SVTC__[${JSON.stringify(mod)}]?.default;`
  );

  return code;
}

export async function POST({ request }) {
  let source;
  try {
    ({ source } = await request.json());
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  if (typeof source !== 'string' || !source.trim()) {
    throw error(400, 'source string is required');
  }

  let compiled;
  try {
    compiled = compile(source, {
      generate: 'client',
      dev: false,
      filename: 'component.svelte',
    });
  } catch (e) {
    // Return compile errors as structured 422 so the client can display them
    throw error(422, `Svelte compile error: ${e.message}`);
  }

  const transformed = transformImports(compiled.js.code);

  return json({ code: transformed });
}
