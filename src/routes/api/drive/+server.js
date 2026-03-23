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
 * The client never sees credentials or raw Drive IDs beyond the root.
 *
 * Environment variables (set in .env):
 *   GOOGLE_DRIVE_FOLDER_ID           - root folder ID or Google Drive URL
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT     - JSON string of service account key
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH - path to service account JSON file (fallback)
 */

import { json, error } from '@sveltejs/kit';
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Service Account ─────────────────────────────────────────────────────────

function loadCredentials() {
  if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT);
    } catch {
      throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT is not valid JSON');
    }
  }
  if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH) {
    const p = resolve(process.cwd(), process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH);
    if (!existsSync(p)) throw new Error(`Service account file not found: ${p}`);
    return JSON.parse(readFileSync(p, 'utf-8'));
  }
  throw new Error(
    'No service account configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT or GOOGLE_DRIVE_SERVICE_ACCOUNT_PATH.'
  );
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

  const res = await fetch(creds.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwtToken
    })
  });

  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${msg}`);
  }

  const data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiry = now + 3600_000;
  return _cachedToken;
}

// ─── Drive API helpers ────────────────────────────────────────────────────────

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * List immediate children of a Drive folder.
 * @param {string} folderId
 * @param {string} accessToken
 * @returns {Promise<Array<{id, name, mimeType}>>}
 */
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

/**
 * Recursively build a tree node (up to maxDepth levels).
 * @param {string} folderId
 * @param {string} name
 * @param {string} accessToken
 * @param {number} depth
 * @param {number} maxDepth
 */
async function buildNode(folderId, name, accessToken, depth = 0, maxDepth = 4) {
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

// ─── Extract folder ID from URL ───────────────────────────────────────────────

function extractFolderId(input) {
  const trimmed = input.trim();
  if (!trimmed.includes('/') && !trimmed.includes('?')) return trimmed;
  const m = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : trimmed;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET({ url }) {
  const rootEnv = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootEnv) {
    throw error(500, 'GOOGLE_DRIVE_FOLDER_ID is not configured');
  }

  const rootId = extractFolderId(rootEnv);
  // Allow optional ?folderId=... for lazy sub-folder loading
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
