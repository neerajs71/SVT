/**
 * Device capability detection.
 *
 * Prefer feature detection over UA sniffing wherever possible.
 * All values are computed once at import time (SSR-safe: guards with typeof window).
 */

const _w = typeof window !== 'undefined' ? window : null;
const _nav = typeof navigator !== 'undefined' ? navigator : null;

/**
 * True when the browser supports the File System Access API
 * (showDirectoryPicker). Available on Chrome/Edge desktop.
 * NOT available on iOS Safari, Firefox, or old browsers.
 */
export const hasFileSystemAccess = !!(_w && 'showDirectoryPicker' in _w);

/**
 * True on iOS (iPhone / iPad) regardless of iOS version.
 * Catches modern iPads that report platform = 'MacIntel' via maxTouchPoints.
 */
export const isIOS = !!(_nav && (
  /iPad|iPhone|iPod/.test(_nav.userAgent) ||
  (_nav.platform === 'MacIntel' && _nav.maxTouchPoints > 1)
));

/**
 * True on any mobile/touch device (iOS, Android, etc.)
 */
export const isMobile = !!(_nav && (
  isIOS ||
  /Android|Mobi/i.test(_nav.userAgent) ||
  _nav.maxTouchPoints > 1
));

/**
 * Recommended default sidebar tab:
 * - 'working' on iOS / mobile (no file system access)
 * - datasourceStore.mode otherwise
 */
export function defaultSidebarTab(datasourceMode) {
  return (!hasFileSystemAccess || isMobile) ? 'working' : datasourceMode;
}
