/**
 * GET /api/dev-tabs
 * Dev convenience: returns the first .wson, .dlis, and .las file found
 * in the remote Drive tree, for auto-opening on page load.
 */
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Re-use the same auth + list helpers from /api/drive
// (duplicated here to keep the endpoint self-contained)
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TARGET_EXTS = new Set(['.wson', '.dlis', '.las']);

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

async function listFolder(folderId, token) {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
  url.searchParams.set('fields', 'files(id,name,mimeType)');
  url.searchParams.set('orderBy', 'folder,name');
  url.searchParams.set('pageSize', '1000');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

function extractFolderId(input) {
  const trimmed = input.trim();
  if (!trimmed.includes('/') && !trimmed.includes('?')) return trimmed;
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : trimmed;
}

// BFS through Drive folders until we find one file of each target extension
async function findFiles(rootId, token) {
  const results = {};
  const queue = [{ folderId: rootId, path: '' }];

  while (queue.length > 0 && Object.keys(results).length < TARGET_EXTS.size) {
    const { folderId, path } = queue.shift();
    const items = await listFolder(folderId, token);

    for (const item of items) {
      const itemPath = path ? `${path}/${item.name}` : item.name;
      if (item.mimeType === FOLDER_MIME) {
        queue.push({ folderId: item.id, path: itemPath });
      } else {
        const ext = item.name.includes('.') ? '.' + item.name.split('.').pop().toLowerCase() : '';
        if (TARGET_EXTS.has(ext) && !results[ext]) {
          results[ext] = { name: item.name, id: item.id, path: itemPath };
        }
      }
      if (Object.keys(results).length >= TARGET_EXTS.size) break;
    }
  }

  return Object.values(results);
}

export async function GET() {
  const rootEnv = env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootEnv) return json([]);

  try {
    const token = await getAccessToken();
    const rootId = extractFolderId(rootEnv);
    const files = await findFiles(rootId, token);
    return json(files);
  } catch (err) {
    console.error('[/api/dev-tabs]', err.message);
    return json([]);
  }
}
