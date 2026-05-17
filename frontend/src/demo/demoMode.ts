/**
 * Demo mode — frontend-only, no backend required.
 *
 * Activated by visiting the site with `?demo=1` (or `?demo`).
 * Once active, every `/api/...` request is intercepted and answered from
 * the static snapshot files in `public/demo/` (captured by
 * `scripts/capture-demo-snapshot.sh`). The mode persists for the rest of
 * the tab's lifetime even if the URL is rewritten by Leaflet etc.
 *
 * Side-effects:
 *   - File-manager save / rename / delete are no-ops in demo mode
 *   - Collab sessions are stubbed (this browser is always Alpha, leader)
 *   - The map opens centred on the captured AO (Joensuu by default)
 */

let cachedActive: boolean | null = null;

export interface DemoManifest {
  bbox: [number, number, number, number];
  center: [number, number];
  zoom: number;
  captured_at: string;
  area_label: string;
}

let manifest: DemoManifest | null = null;

/** True when the page is in demo mode (URL flag `?demo=1` or `?demo`). */
export function isDemoMode(): boolean {
  if (cachedActive !== null) return cachedActive;
  if (typeof window === 'undefined') { cachedActive = false; return false; }
  try {
    const params = new URLSearchParams(window.location.search);
    cachedActive = params.has('demo');
  } catch {
    cachedActive = false;
  }
  return cachedActive;
}

export function getDemoManifest(): DemoManifest | null {
  return manifest;
}

/**
 * Replace window.fetch so /api/... URLs are answered from public/demo/.
 * Idempotent. Must run before any React render.
 */
export async function installDemoFetch(): Promise<void> {
  if (!isDemoMode()) return;
  if (typeof window === 'undefined') return;

  // Preload the manifest so the banner / map can read it synchronously.
  try {
    const r = await fetch('/demo/manifest.json');
    if (r.ok) manifest = (await r.json()) as DemoManifest;
  } catch {
    /* leave manifest null — banner falls back to generic copy */
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input
              : input instanceof URL ? input.toString()
              : input.url;
    const path = extractApiPath(url);
    if (path == null) return originalFetch(input as RequestInfo, init);
    return handleDemo(path, init, originalFetch);
  }) as typeof window.fetch;
}

function extractApiPath(url: string): string | null {
  let pathname: string;
  try {
    const u = new URL(url, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    pathname = u.pathname;
  } catch {
    if (!url.startsWith('/')) return null;
    const q = url.indexOf('?');
    pathname = q >= 0 ? url.slice(0, q) : url;
  }
  return pathname.startsWith('/api/') ? pathname : null;
}

const HEADERS_JSON = { 'Content-Type': 'application/json' };

async function handleDemo(
  path: string,
  init: RequestInit | undefined,
  originalFetch: typeof fetch,
): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();

  // ── Health ────────────────────────────────────────────────────────────
  if (path === '/api/health') return json({ status: 'ok', mode: 'demo' });

  // ── Sources / capabilities — static snapshots ─────────────────────────
  if (path === '/api/sources')                 return staticFile(originalFetch, '/demo/sources.json');
  if (path === '/api/timeline/capabilities')   return staticFile(originalFetch, '/demo/timeline-capabilities.json');

  // ── Layer fetches: /api/layers/{layer} or /api/analyze/mcoo ───────────
  const layerMatch = path.match(/^\/api\/layers\/([\w_-]+)$/);
  if (layerMatch) return staticFile(originalFetch, `/demo/layers/${layerMatch[1]}.json`);
  if (path === '/api/analyze/mcoo')            return staticFile(originalFetch, '/demo/layers/mcoo.json');

  // ── Briefing analyses ─────────────────────────────────────────────────
  if (path === '/api/analyze/terrain-effects')  return staticFile(originalFetch, '/demo/analyze/terrain-effects.json');
  if (path === '/api/analyze/drone-conditions') return staticFile(originalFetch, '/demo/analyze/drone-conditions.json');
  if (path === '/api/analyze/astronomical')     return staticFile(originalFetch, '/demo/analyze/astronomical.json');

  // ── Filesystem — stubbed; demo doesn't persist files ──────────────────
  if (path === '/api/fs/tree')   return json({ folders: [], files: [] });
  if (path === '/api/fs/recent') return json([]);
  if (path === '/api/fs/search') return json([]);
  if (path.startsWith('/api/fs/')) {
    if (method === 'GET')    return json({});
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return json({}, 201);
  }

  // ── Collab — stub so the controller never hits a real socket ──────────
  if (path === '/api/collab/files/__global__/join') {
    const snapshot = {
      file_id: '__global__',
      leader_session_id: 'demo-alpha',
      follower_count: 0,
      sessions: [{ session_id: 'demo-alpha', display_name: 'Alpha', role: 'leader', joined_at: 0 }],
    };
    return json({ session_id: 'demo-alpha', snapshot }, 201);
  }
  if (path.startsWith('/api/collab/files/') && path.endsWith('/heartbeat')) {
    return json({ file_id: '__global__', leader_session_id: 'demo-alpha', follower_count: 0, sessions: [] });
  }
  if (path.startsWith('/api/collab/files/') && path.endsWith('/leave')) {
    return new Response(null, { status: 204 });
  }
  if (path.startsWith('/api/collab/files/') && path.endsWith('/broadcast')) {
    return json({ delivered_to: 1 });
  }
  if (path.startsWith('/api/collab/files/') && path.endsWith('/stream')) {
    // Return an empty SSE stream — the EventSource will retry forever
    // but no events will ever come, which is fine for demo.
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (path.startsWith('/api/collab/')) return json({});

  // ── Unknown — degrade gracefully with a 404 response ──────────────────
  return new Response(JSON.stringify({ error: 'demo: not snapshotted', path }), {
    status: 404, headers: HEADERS_JSON,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS_JSON });
}

async function staticFile(originalFetch: typeof fetch, path: string): Promise<Response> {
  // Use the real (un-intercepted) fetch so the static asset is served
  // directly by Vite / the static host.
  return originalFetch(path);
}
