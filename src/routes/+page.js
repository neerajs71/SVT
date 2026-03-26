// Loads dev-tab file info server-side so it's available immediately on mount
export async function load({ fetch }) {
  try {
    const res = await fetch('/api/dev-tabs');
    if (res.ok) return { devTabs: await res.json() };
  } catch { /* Drive not configured */ }
  return { devTabs: [] };
}
