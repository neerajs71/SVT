/**
 * GET /api/drive
 * GET /api/drive?folderId=<id>
 *
 * Server-side Google Drive proxy.
 * Authenticates with a service account (JWT → access token) and returns
 * a folder's contents as a tree node compatible with LocalDataSource's format:
 *
 *   { name, type: 'dir'|'file', id, children: { ... } }
 *
 * Environment variables (set in .env):
 *   GOOGLE_DRIVE_FOLDER_ID           - root folder ID or Google Drive URL
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT     - JSON string of service account key
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH - path to service account JSON file (fallback)
 */

import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Service Account ─────────────────────────────────────────────────────────

function loadCredentials() {
  if (env.GOOGLE_DRIVE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(env.GOOGLE_DRIVE_SERVICE_ACCOUNT);
    } catch {
      throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT is not valid JSON');
    }
  }
  if (env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH) {
    const p = resolve(process.cwd(), env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH);
    if (!existsSync(p)) throw new Error(`Service account file not found: ${p}`);
    return JSON.parse(readFileSync(p, 'utf-8'));
  }
  throw new Error(
    'No service account configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT or GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH.'
  );
}

let _cachedToken = null;
let _tokenExpiry = 0;

function validateCredentials(creds) {
  const required = ['client_email', 'private_key', 'token_uri'];
  const missing  = required.filter(k => !creds[k]);
  if (missing.length) {
    throw new Error(
      `Service account JSON is missing required fields: ${missing.join(', ')}. ` +
      `Present fields: ${Object.keys(creds).join(', ')}`
    );
  }
  // Strip Markdown angle-bracket links: <https://...> → https://...
  creds.token_uri = creds.token_uri.replace(/^<(.+)>$/, '$1').trim();
  if (!creds.token_uri.startsWith('http')) {
    throw new Error(`token_uri is not a valid URL: "${creds.token_uri}"`);
  }
  if (!creds.private_key.includes('BEGIN')) {
    throw new Error('private_key does not look like a PEM key — check for missing newlines or quote escaping in the env var');
  }
}

async function getAccessToken() {
  const now = Date.now();
  if (_cachedToken && _tokenExpiry > now + 5 * 60_000) return _cachedToken;

  const creds = loadCredentials();
  validateCredentials(creds);

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: creds.token_uri,
    iat,
    exp
  })).toString('base64url');

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = signer.sign(creds.private_key, 'base64url');

  const jwtToken = `${header}.${payload}.${sig}`;

  const tokenRes = await fetch(creds.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwtToken
    })
  });

  if (!tokenRes.ok) {
    const msg = await tokenRes.text();
    throw new Error(`Token exchange failed (${tokenRes.status}): ${msg}`);
  }

  const data = await tokenRes.json();
  _cachedToken = data.access_token;
  _tokenExpiry = now + 3600_000;
  return _cachedToken;
}

// ─── Drive API helpers ────────────────────────────────────────────────────────

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function listFolder(folderId, accessToken) {
  const all = [];
  let pageToken;

  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
    url.searchParams.set('orderBy', 'folder,name');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`Drive list failed (${res.status}): ${msg}`);
    }
    const data = await res.json();
    all.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

async function buildNode(folderId, name, accessToken, depth = 0, maxDepth = 1) {
  const node = { name, type: 'dir', id: folderId, children: {} };
  if (depth >= maxDepth) return node;

  const items = await listFolder(folderId, accessToken);
  await Promise.all(
    items.map(async item => {
      if (item.mimeType === FOLDER_MIME) {
        node.children[item.name] = await buildNode(item.id, item.name, accessToken, depth + 1, maxDepth);
      } else {
        node.children[item.name] = { name: item.name, type: 'file', id: item.id };
      }
    })
  );
  return node;
}

function extractFolderId(input) {
  const trimmed = input.trim();
  if (!trimmed.includes('/') && !trimmed.includes('?')) return trimmed;
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : trimmed;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET({ url }) {
  const rootEnv = env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootEnv) {
    throw error(500, 'GOOGLE_DRIVE_FOLDER_ID is not configured');
  }

  const rootId   = extractFolderId(rootEnv);
  const folderId = url.searchParams.get('folderId') || rootId;
  const isRoot   = folderId === rootId;

  try {
    const accessToken = await getAccessToken();
    const node = await buildNode(folderId, isRoot ? '' : folderId, accessToken);
    return json(node);
  } catch (err) {
    console.error('[/api/drive]', err.message);
    throw error(500, err.message);
  }
}
