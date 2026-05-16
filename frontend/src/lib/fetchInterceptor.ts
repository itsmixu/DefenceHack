import { useDebugStore } from './debugStore';

let installed = false;

const isApiUrl = (url: string): boolean => {
  if (url.startsWith('/api/')) return true;
  try {
    const u = new URL(url, window.location.origin);
    return u.origin === window.location.origin && u.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};

const splitUrl = (url: string): { path: string; query: string } => {
  try {
    const u = new URL(url, window.location.origin);
    return { path: u.pathname, query: u.search };
  } catch {
    const qIdx = url.indexOf('?');
    return qIdx >= 0
      ? { path: url.slice(0, qIdx), query: url.slice(qIdx) }
      : { path: url, query: '' };
  }
};

const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function installFetchInterceptor(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  const store = useDebugStore;

  window.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (!isApiUrl(url)) {
      return originalFetch(input as RequestInfo, init);
    }

    const id = genId();
    const { path, query } = splitUrl(url);
    const t0 = performance.now();

    store.getState().start({ id, method, url, path, query });

    try {
      const res = await originalFetch(input as RequestInfo, init);
      const durationMs = Math.round(performance.now() - t0);
      const contentLength = res.headers.get('content-length');

      // Inspect meta.status without consuming the original body.
      let metaStatus: string | undefined;
      let metaReason: string | undefined;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('json')) {
        try {
          const clone = res.clone();
          const text = await clone.text();
          if (text) {
            const data = JSON.parse(text);
            if (data && typeof data === 'object' && data.meta) {
              metaStatus = typeof data.meta.status === 'string' ? data.meta.status : undefined;
              metaReason = typeof data.meta.reason === 'string' ? data.meta.reason : undefined;
            }
          }
        } catch {
          // not fatal — debug panel just won't show meta.status
        }
      }

      store.getState().finish(id, {
        status: res.status,
        ok: res.ok,
        durationMs,
        responseBytes: contentLength ? Number(contentLength) : undefined,
        metaStatus,
        metaReason,
      });

      return res;
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      store.getState().finish(id, {
        ok: false,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
