import type {
  LayerResponse,
  SourceInfo,
  TerrainEffectsResponse,
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

/** List all saved plans (no drawn_features — summary only). */
export function listPlans(): Promise<PlanSummary[]> {
  return fetchJson<PlanSummary[]>('/api/plans');
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
