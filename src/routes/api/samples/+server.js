/**
 * GET  /api/samples          — list files in static/samples/
 * POST /api/samples          — upload a file into static/samples/
 * DELETE /api/samples?name=  — delete a file from static/samples/
 */

import { json, error } from '@sveltejs/kit';
import { readdir, writeFile, unlink, stat } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const SAMPLES_DIR = resolve('static/samples');

// Ensure the directory exists
if (!existsSync(SAMPLES_DIR)) mkdirSync(SAMPLES_DIR, { recursive: true });

// ── GET — list ────────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const entries = await readdir(SAMPLES_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter(e => e.isFile())
        .map(async e => {
          const s = await stat(join(SAMPLES_DIR, e.name));
          return { name: e.name, size: s.size, mtime: s.mtimeMs };
        })
    );
    files.sort((a, b) => b.mtime - a.mtime);
    return json({ files });
  } catch (e) {
    return error(500, e.message);
  }
}

// ── POST — upload ─────────────────────────────────────────────────────────────
export async function POST({ request }) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || typeof file === 'string') return error(400, 'No file uploaded');

    // Sanitise filename — no path traversal
    const name = basename(file.name).replace(/[^\w.\-]/g, '_');
    if (!name) return error(400, 'Invalid filename');

    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(join(SAMPLES_DIR, name), buf);

    return json({ ok: true, name, size: buf.length });
  } catch (e) {
    return error(500, e.message);
  }
}

// ── DELETE — remove ───────────────────────────────────────────────────────────
export async function DELETE({ url }) {
  try {
    const name = url.searchParams.get('name');
    if (!name) return error(400, 'name param required');

    // Prevent path traversal
    const safe = basename(name);
    const path = join(SAMPLES_DIR, safe);
    if (!path.startsWith(SAMPLES_DIR)) return error(400, 'Invalid path');

    await unlink(path);
    return json({ ok: true });
  } catch (e) {
    return error(500, e.message);
  }
}
