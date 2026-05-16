import type {
  AstronomicalResponse,
  DroneConditionsResponse,
  LayerKey,
  LayerResponse,
  MobilityResponse,
  Operation,
  OperationActual,
  Plan,
  PlanSummary,
  PlanVersion,
  PlanVersionSummary,
  SourceInfo,
  TerrainEffectsResponse,
  TimelineCapabilitiesResponse,
  TimelineSnapshotResponse,
  VehicleClass,
  ViewshedResponse,
  LayerKey,
  Plan,
  PlanSummary,
  PlanVersion,
  PlanVersionSummary,
  CreatePlanBody,
  CreateVersionBody,
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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function fetchJsonAllowEmpty<T>(url: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(url, init);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

const jsonBody = (data: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

// ─── Sources & layers ─────────────────────────────────────────────────────

export function getSources(): Promise<SourceInfo[]> {
  return fetchJson<SourceInfo[]>('/api/sources');
}

export function getLayer(layer: LayerKey, query: BboxQuery): Promise<LayerResponse> {
  if (layer === 'mcoo') {
    return fetchJson<LayerResponse>(`/api/analyze/mcoo${buildQuery(query)}`);
  }
  return fetchJson<LayerResponse>(`/api/layers/${layer}${buildQuery(query)}`);
}

// ─── Analysis ─────────────────────────────────────────────────────────────

export function getTerrainEffects(query: BboxQuery): Promise<TerrainEffectsResponse> {
  return fetchJson<TerrainEffectsResponse>(`/api/analyze/terrain-effects${buildQuery(query)}`);
}

export interface DroneRating { current_rating: 'go' | 'marginal' | 'no-go'; limiting_factors: string[]; station_count: number }
export interface DroneConditionsResponse {
  summary: DroneRating & { stations_no_go: number; stations_marginal: number };
  station_features: { type: string; features: Array<{ geometry: unknown; properties: Record<string, unknown> }> };
  forecast_timeline: Array<{ time: string; drone_rating: string; wind_ms: number | null; wind_gust_ms: number | null; temp_c: number | null }>;
  thresholds: Record<string, unknown>;
}

export function getDroneConditions(query: BboxQuery): Promise<DroneConditionsResponse> {
  return fetchJson<DroneConditionsResponse>(`/api/analyze/drone-conditions${buildQuery(query)}`);
}

// ── Plans ─────────────────────────────────────────────────────────────────────

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function deleteReq(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${url} -> HTTP ${res.status}`);
}

/** List saved plans. Pass all=true to get every plan (for hierarchy tree). */
export function listPlans(opts?: { all?: boolean; parentId?: string }): Promise<PlanSummary[]> {
  const params: Record<string, string> = {};
  if (opts?.all) params.all = 'true';
  if (opts?.parentId) params.parent_id = opts.parentId;
  return fetchJson<PlanSummary[]>(`/api/plans${buildQuery(params)}`);
}

/**
 * Capture current conditions (FMI weather) at the given bbox and time.
 * Returns a condensed snapshot object suitable for storing in a plan.
 * Returns undefined if the API is unavailable or no data exists.
 */
export async function fetchConditionsSnapshot(
  bbox: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const t = new Date().toISOString();
    const params = new URLSearchParams({ bbox, t, sources: 'fmi' });
    const res = await fetch(`/api/timeline/snapshot?${params}`);
    if (!res.ok) return undefined;
    const data = await res.json() as {
      t: string;
      layers: { fmi?: { features: Array<{ properties: Record<string, unknown> }> } };
    };
    const fmiFeatures = data.layers?.fmi?.features ?? [];
    if (fmiFeatures.length === 0) return { fetched_at: t };
    // Aggregate a simple summary from the first few stations.
    const summaries = fmiFeatures.slice(0, 3).map((f) => f.properties);
    const first = summaries[0];
    return {
      fetched_at: t,
      station: first.station_name ?? first.name ?? 'unknown',
      temperature_c: first.t2m ?? first.temperature,
      wind_speed_ms: first.ws_10min ?? first.wind_speed,
      wind_direction_deg: first.wd_10min ?? first.wind_direction,
      humidity_pct: first.rh ?? first.humidity,
      cloudiness: first.n_man ?? first.cloudiness,
      visibility_m: first.vis ?? first.visibility,
      stations_sampled: fmiFeatures.length,
    };
  } catch {
    return undefined;
  }
}

/** Get a single plan with full drawn_features. */
export function getPlan(id: string): Promise<Plan> {
  return fetchJson<Plan>(`/api/plans/${id}`);
}

/** Create a new plan. Returns the saved plan with its generated id. */
export function createPlan(body: CreatePlanBody): Promise<Plan> {
  return postJson<Plan>('/api/plans', body);
}

/** Overwrite plan fields (partial update — send only what changed). */
export function updatePlan(id: string, body: Partial<CreatePlanBody>): Promise<Plan> {
  return putJson<Plan>(`/api/plans/${id}`, body);
}

/** Delete a plan permanently. */
export function deletePlan(id: string): Promise<void> {
  return deleteReq(`/api/plans/${id}`);
}

// ── Plan versions ─────────────────────────────────────────────────────────────

/** List all version snapshots for a plan (oldest first, no drawn_features). */
export function listPlanVersions(planId: string): Promise<PlanVersionSummary[]> {
  return fetchJson<PlanVersionSummary[]>(`/api/plans/${planId}/versions`);
}

/** Get a specific version snapshot with full drawn_features. */
export function getPlanVersion(planId: string, version: number): Promise<PlanVersion> {
  return fetchJson<PlanVersion>(`/api/plans/${planId}/versions/${version}`);
}

/**
 * Save the current map state as a named, immutable version snapshot.
 *
 * Call this when the commander clicks "Save version" — pass the current
 * drawn_features, active_layers, bbox, notes, and optionally a live
 * conditions_snapshot (last FMI/astronomy response bodies).
 */
export function createPlanVersion(planId: string, body: CreateVersionBody): Promise<PlanVersion> {
  return postJson<PlanVersion>(`/api/plans/${planId}/versions`, body);
}
