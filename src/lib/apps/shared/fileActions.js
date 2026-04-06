/**
 * Shared file action utilities used by all app viewers.
 */

/**
 * Save content to a FileSystemFileHandle (desktop Chrome/Edge only).
 * @param {FileSystemFileHandle} handle
 * @param {string | ArrayBuffer | Blob} content
 */
export async function saveToHandle(handle, content) {
  const w = await handle.createWritable();
  await w.write(content);
  await w.close();
}

/**
 * Trigger a browser file download.
 * @param {string} filename
 * @param {string | ArrayBuffer | Uint8Array | Blob} content
 * @param {string} mime
 */
export function downloadBlob(filename, content, mime = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
