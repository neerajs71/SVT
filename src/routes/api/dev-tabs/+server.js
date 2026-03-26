/**
 * GET /api/dev-tabs
 *
 * Reads activeTabs.json from Google Drive (stored in the workspace folder,
 * matching the dlis format) and returns { name, id, path } for each tab
 * so the client can auto-open them on load.
 *
 * activeTabs.json format (dlis-compatible):
 * {
 *   "tabs": {
 *     "<tabId>": {
 *       "fileExtension": ".wson",
 *       "label": "fat_design.wson",
 *       "relativePath": "fields/FIELD_FICTION/wells/W1/schematic/fat_design.wson"
 *     }
 *   },
 *   "activeTabId": "<tabId>"
 * }
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

async function driveSearch(q, token, pageSize = 1) {
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', `${q} and trashed=false`);
  url.searchParams.set('fields', 'files(id,name)');
  url.searchParams.set('pageSize', String(pageSize));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.files || [];
}

async function driveDownloadJson(fileId, token) {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

export async function GET() {
  if (!env.GOOGLE_DRIVE_FOLDER_ID) return json([]);

  try {
    const token = await getAccessToken();

    // Find activeTabs.json in Drive (may be one per workspace, take first found)
    const activeTabsFiles = await driveSearch(`name = 'activeTabs.json'`, token, 5);
    if (!activeTabsFiles.length) return json([]);

    // Try each activeTabs.json until we get one with tabs
    let tabs = [];
    for (const atFile of activeTabsFiles) {
      const data = await driveDownloadJson(atFile.id, token);
      if (!data?.tabs) continue;
      const entries = Object.values(data.tabs);
      if (entries.length) { tabs = entries; break; }
    }
    if (!tabs.length) return json([]);

    // Resolve each tab's file ID by searching Drive by filename
    const results = await Promise.all(tabs.map(async tab => {
      const filename = tab.label ?? tab.entityId ?? tab.relativePath?.split('/').pop();
      if (!filename) return null;
      const files = await driveSearch(`name = '${filename.replace(/'/g, "\\'")}'`, token, 1);
      const file = files[0];
      return file ? { name: file.name, id: file.id, path: tab.relativePath ?? file.name } : null;
    }));

    return json(results.filter(Boolean));
  } catch (err) {
    console.error('[/api/dev-tabs]', err.message);
    return json([]);
  }
}
