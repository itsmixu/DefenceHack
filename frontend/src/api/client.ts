import type {
  LayerResponse,
  SourceInfo,
  TerrainEffectsResponse,
  LayerKey,
} from './types';

export interface BboxQuery {
  bbox: string;
  t?: string;
  [key: string]: string | undefined;
}

const buildQuery = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') search.set(k, v);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function getSources(): Promise<SourceInfo[]> {
  return fetchJson<SourceInfo[]>('/api/sources');
}

export function getLayer(layer: LayerKey, query: BboxQuery): Promise<LayerResponse> {
  if (layer === 'mcoo') {
    return fetchJson<LayerResponse>(`/api/analyze/mcoo${buildQuery(query)}`);
  }
  return fetchJson<LayerResponse>(`/api/layers/${layer}${buildQuery(query)}`);
}

export function getTerrainEffects(query: BboxQuery): Promise<TerrainEffectsResponse> {
  return fetchJson<TerrainEffectsResponse>(`/api/analyze/terrain-effects${buildQuery(query)}`);
}
