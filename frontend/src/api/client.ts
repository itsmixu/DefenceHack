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

export function getDroneConditions(query: BboxQuery): Promise<DroneConditionsResponse> {
  return fetchJson<DroneConditionsResponse>(`/api/analyze/drone-conditions${buildQuery(query)}`);
}

export function getAstronomical(query: BboxQuery): Promise<AstronomicalResponse> {
  return fetchJson<AstronomicalResponse>(`/api/analyze/astronomical${buildQuery(query)}`);
}

export function getMobility(
  query: BboxQuery & { vehicle_class?: VehicleClass },
): Promise<MobilityResponse> {
  return fetchJson<MobilityResponse>(`/api/analyze/mobility${buildQuery(query)}`);
}

export interface ViewshedQuery extends BboxQuery {
  observer_lon: string;
  observer_lat: string;
  observer_height_m?: string;
}

export function getViewshed(query: ViewshedQuery): Promise<ViewshedResponse> {
  return fetchJson<ViewshedResponse>(`/api/analyze/viewshed${buildQuery(query)}`);
}

// ─── Timeline ─────────────────────────────────────────────────────────────

export function getTimelineCapabilities(): Promise<TimelineCapabilitiesResponse> {
  return fetchJson<TimelineCapabilitiesResponse>('/api/timeline/capabilities');
}

export function getTimelineSnapshot(
  query: BboxQuery & { sources?: string },
): Promise<TimelineSnapshotResponse> {
  return fetchJson<TimelineSnapshotResponse>(`/api/timeline/snapshot${buildQuery(query)}`);
}

// ─── Plans ────────────────────────────────────────────────────────────────

export function listPlans(): Promise<PlanSummary[]> {
  return fetchJson<PlanSummary[]>('/api/plans');
}

export function getPlan(id: string): Promise<Plan> {
  return fetchJson<Plan>(`/api/plans/${id}`);
}

export function createPlan(body: Omit<Plan, 'id'>): Promise<Plan> {
  return fetchJson<Plan>('/api/plans', jsonBody(body));
}

export function updatePlan(id: string, body: Partial<Plan>): Promise<Plan> {
  return fetchJson<Plan>(`/api/plans/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function deletePlan(id: string): Promise<void> {
  const res = await fetch(`/api/plans/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    throw new Error(`DELETE /api/plans/${id} -> HTTP ${res.status}`);
  }
}

// ─── Plan versions ────────────────────────────────────────────────────────

export function listPlanVersions(planId: string): Promise<PlanVersionSummary[]> {
  return fetchJson<PlanVersionSummary[]>(`/api/plans/${planId}/versions`);
}

export function getPlanVersion(planId: string, version: number): Promise<PlanVersion> {
  return fetchJson<PlanVersion>(`/api/plans/${planId}/versions/${version}`);
}

export function createPlanVersion(
  planId: string,
  body: Omit<PlanVersion, 'version' | 'saved_at'>,
): Promise<PlanVersion> {
  return fetchJson<PlanVersion>(`/api/plans/${planId}/versions`, jsonBody(body));
}

// ─── Operations ───────────────────────────────────────────────────────────

export function listOperations(planId?: string): Promise<Operation[]> {
  return fetchJson<Operation[]>(`/api/operations${planId ? `?plan_id=${planId}` : ''}`);
}

export function getOperation(id: string): Promise<Operation> {
  return fetchJson<Operation>(`/api/operations/${id}`);
}

export function createOperation(body: Omit<Operation, 'id'>): Promise<Operation> {
  return fetchJson<Operation>('/api/operations', jsonBody(body));
}

export function recordOperationActual(id: string, body: OperationActual): Promise<Operation> {
  return fetchJson<Operation>(`/api/operations/${id}/actual`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Re-export for callers that want the empty-allowed helper.
export { fetchJsonAllowEmpty };
