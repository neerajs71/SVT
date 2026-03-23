/**
 * RemoteDataSource
 * Fetches a Google Drive folder tree from the server-side /api/drive endpoint.
 * The client never handles credentials — all auth stays on the server.
 */

export class RemoteDataSource {
  /**
   * Fetch the full tree from the server.
   * Returns the same tree shape as LocalDataSource.buildTree():
   *   { name, type: 'dir', children: { ... } }
   *
   * @returns {Promise<object>}
   */
  async fetchTree() {
    const res = await fetch('/api/drive');
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`Remote drive error ${res.status}: ${msg}`);
    }
    return res.json();
  }

  /**
   * Fetch the children of a specific folder by its Drive ID.
   * Used for lazy expansion of sub-folders.
   *
   * @param {string} folderId
   * @returns {Promise<object>}
   */
  async fetchFolder(folderId) {
    const res = await fetch(`/api/drive?folderId=${encodeURIComponent(folderId)}`);
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`Remote drive error ${res.status}: ${msg}`);
    }
    return res.json();
  }
}
