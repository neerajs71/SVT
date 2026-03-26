/**
 * GET /api/dev-tabs
 * Dev convenience: returns the first .wson, .dlis, and .las file found
 * in the remote Drive using a single search query (fast).
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const TARGET_EXTS = ['.wson', '.dlis', '.las'];

function loadCredentials() {
  if (env.GOOGLE_DRIVE_SERVICE_ACCOUNT) return JSON.parse(env.GOOGLE_DRIVE_SERVICE_ACCOUNT);
  if (env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH) {
    const p = resolve(process.cwd(), env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH);
    if (!existsSync(p)) throw new Error(`Service account file not found: ${p}`);
    return JSON.parse(readFileSync(p, 'utf-8'));
  }
  throw new Error('No service account configured');
}

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  const now = Date.now();
  if (_cachedToken && _tokenExpiry > now + 5 * 60_000) return _cachedToken;
  const creds = loadCredentials();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: creds.client_email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: creds.token_uri, iat, exp
  })).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(creds.private_key, 'base64url');
  const tokenRes = await fetch(creds.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${payload}.${sig}` })
  });
  const data = await tokenRes.json();
  _cachedToken = data.access_token;
  _tokenExpiry = now + 3600_000;
  return _cachedToken;
}

function extractFolderId(input) {
  const trimmed = input.trim();
  if (!trimmed.includes('/') && !trimmed.includes('?')) return trimmed;
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : trimmed;
}

export async function GET() {
  const rootEnv = env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootEnv) return json([]);

  try {
    const token = await getAccessToken();
    const rootId = extractFolderId(rootEnv);

    // Single Drive search for all target extensions at once
    const extConditions = TARGET_EXTS.map(ext => `name contains '${ext}'`).join(' or ');
    const q = `'${rootId}' in parents or (${extConditions}) and trashed=false`;

    // Search for each extension separately to get one of each
    const results = [];
    for (const ext of TARGET_EXTS) {
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', `name contains '${ext}' and trashed=false`);
      url.searchParams.set('fields', 'files(id,name)');
      url.searchParams.set('orderBy', 'name');
      url.searchParams.set('pageSize', '1');
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) continue;
      const data = await res.json();
      const file = data.files?.[0];
      if (file) results.push({ name: file.name, id: file.id, path: file.name });
    }

    return json(results);
  } catch (err) {
    console.error('[/api/dev-tabs]', err.message);
    return json([]);
  }
}
