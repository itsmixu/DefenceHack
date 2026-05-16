import type {
  AstronomicalResponse,
  CreatePlanBody,
  CreateVersionBody,
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
  FsFolder,
  FsFileMeta,
  FsFileContent,
  FsTree,
  FsSaveBody,
  FsHierarchy,
  FsUpdateMetadataBody,
  IpbExportV2,
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

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function deleteReq(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    throw new Error(`DELETE ${url} -> HTTP ${res.status}`);
  }
}

// ─── Sources & layers ─────────────────────────────────────────────────────

export function getSources(): Promise<SourceInfo[]> {
  return fetchJson<SourceInfo[]>('/api/sources');
}

export function getLayer(layer: LayerKey, query: BboxQuery): Promise<LayerResponse> {
  // Demo mode: if the page is opened with `?demo=1` or `localStorage.demo === '1'`,
  // load canned demo files from `public/demo/layers/<layer>.json` so the frontend
  // works without a backend.
  try {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const demoQ = params.get('demo');
      const demoLocal = window.localStorage?.getItem?.('demo');
      if (demoQ === '1' || demoLocal === '1') {
        return fetchJson<LayerResponse>(`/demo/layers/${layer}.json`);
      }
    }
  } catch {
    // ignore and fall back to normal behaviour
  }
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

/**
 * Capture current FMI conditions for the given bbox. Returns a condensed
 * snapshot object suitable for storing in a plan/version. Returns undefined
 * if the API is unavailable or no observations are present.
 */
export async function fetchConditionsSnapshot(
  bbox: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const t = new Date().toISOString();
    const data = await getTimelineSnapshot({ bbox, t, sources: 'fmi' });
    const fmiFeatures = data.layers?.fmi?.features ?? [];
    if (fmiFeatures.length === 0) return { fetched_at: t };
    const first = (fmiFeatures[0].properties ?? {}) as Record<string, unknown>;
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

// ── Plans ─────────────────────────────────────────────────────────────────

/** List saved plans. Pass `all: true` for every plan (hierarchy tree), or `parentId` for children of one. */
export function listPlans(opts?: { all?: boolean; parentId?: string }): Promise<PlanSummary[]> {
  const params: Record<string, string | undefined> = {};
  if (opts?.all) params.all = 'true';
  if (opts?.parentId) params.parent_id = opts.parentId;
  return fetchJson<PlanSummary[]>(`/api/plans${buildQuery(params)}`);
}

export function getPlan(id: string): Promise<Plan> {
  return fetchJson<Plan>(`/api/plans/${id}`);
}

export function createPlan(body: CreatePlanBody): Promise<Plan> {
  return postJson<Plan>('/api/plans', body);
}

export function updatePlan(id: string, body: Partial<CreatePlanBody>): Promise<Plan> {
  return putJson<Plan>(`/api/plans/${id}`, body);
}

export function deletePlan(id: string): Promise<void> {
  return deleteReq(`/api/plans/${id}`);
}

// ── Plan versions ─────────────────────────────────────────────────────────

export function listPlanVersions(planId: string): Promise<PlanVersionSummary[]> {
  return fetchJson<PlanVersionSummary[]>(`/api/plans/${planId}/versions`);
}

export function getPlanVersion(planId: string, version: number): Promise<PlanVersion> {
  return fetchJson<PlanVersion>(`/api/plans/${planId}/versions/${version}`);
}

export function createPlanVersion(planId: string, body: CreateVersionBody): Promise<PlanVersion> {
  return postJson<PlanVersion>(`/api/plans/${planId}/versions`, body);
}

// ── Operations ────────────────────────────────────────────────────────────

export function listOperations(planId?: string): Promise<Operation[]> {
  return fetchJson<Operation[]>(`/api/operations${planId ? `?plan_id=${planId}` : ''}`);
}

export function getOperation(id: string): Promise<Operation> {
  return fetchJson<Operation>(`/api/operations/${id}`);
}

export function createOperation(body: Omit<Operation, 'id'>): Promise<Operation> {
  return postJson<Operation>('/api/operations', body);
}

export function recordOperationActual(id: string, body: OperationActual): Promise<Operation> {
  return patchJson<Operation>(`/api/operations/${id}/actual`, body);
}

// ── Filesystem ────────────────────────────────────────────────────────────

export function fsGetTree(): Promise<FsTree> {
  return fetchJson<FsTree>('/api/fs/tree');
}

export function fsGetRecent(limit = 10): Promise<FsFileMeta[]> {
  return fetchJson<FsFileMeta[]>(`/api/fs/recent?limit=${limit}`);
}

export function fsSearch(q: string): Promise<FsFileMeta[]> {
  return fetchJson<FsFileMeta[]>(`/api/fs/search?q=${encodeURIComponent(q)}`);
}

export function fsOpenFile(id: string): Promise<FsFileContent> {
  return fetchJson<FsFileContent>(`/api/fs/files/${id}`);
}

export function fsSaveFile(body: FsSaveBody): Promise<FsFileMeta> {
  return postJson<FsFileMeta>('/api/fs/files', body);
}

export function fsRenameFile(id: string, name: string): Promise<FsFileMeta> {
  return patchJson<FsFileMeta>(`/api/fs/files/${id}`, { name });
}

export function fsMoveFile(id: string, folder_id: string | null): Promise<FsFileMeta> {
  return patchJson<FsFileMeta>(`/api/fs/files/${id}`, { folder_id });
}

/** Update any subset of name/folder/rank/unit/commander_name/parent_file_id. */
export function fsUpdateMetadata(id: string, body: FsUpdateMetadataBody): Promise<FsFileMeta> {
  return patchJson<FsFileMeta>(`/api/fs/files/${id}`, body);
}

// ── Command hierarchy ─────────────────────────────────────────────────────────

/** Full command picture: self + ancestors + descendants + siblings. */
export function fsGetHierarchy(id: string): Promise<FsHierarchy> {
  return fetchJson<FsHierarchy>(`/api/fs/files/${id}/hierarchy`);
}

/** Walk parent_file_id from this file up to the root commander. */
export function fsListAncestors(id: string): Promise<FsFileMeta[]> {
  return fetchJson<FsFileMeta[]>(`/api/fs/files/${id}/ancestors`);
}

/** Subordinate files (recursive by default). */
export function fsListDescendants(id: string, recursive = true): Promise<FsFileMeta[]> {
  return fetchJson<FsFileMeta[]>(`/api/fs/files/${id}/descendants?recursive=${recursive}`);
}

export interface RanksResponse {
  default: number;
  min: number;
  max: number;
  levels: { rank: number; name: string }[];
}

/** Echelon table for rank-picker UIs. */
export function fsListRanks(): Promise<RanksResponse> {
  return fetchJson<RanksResponse>('/api/fs/ranks');
}

export function fsDuplicateFile(id: string, name?: string): Promise<FsFileMeta> {
  return postJson<FsFileMeta>(`/api/fs/files/${id}/duplicate`, name ? { name } : {});
}

export function fsDeleteFile(id: string): Promise<void> {
  return deleteReq(`/api/fs/files/${id}`);
}

export function fsCreateFolder(name: string, parent_id?: string | null): Promise<FsFolder> {
  return postJson<FsFolder>('/api/fs/folders', { name, parent_id: parent_id ?? null });
}

export function fsRenameFolder(id: string, name: string): Promise<FsFolder> {
  return patchJson<FsFolder>(`/api/fs/folders/${id}`, { name });
}

export async function fsDeleteFolder(id: string, recursive = false): Promise<void> {
  const res = await fetch(`/api/fs/folders/${id}?recursive=${recursive}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || `DELETE /api/fs/folders/${id} -> HTTP ${res.status}`);
  }
}

/** Fetch and immediately trigger a browser download of the .ipb.json export. */
export async function fsExportDownload(id: string, fileName: string): Promise<void> {
  const res = await fetch(`/api/fs/files/${id}/export`);
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(fileName.replace(/[^\w\s\-. ]/g, '_') || 'operation').trim()}.ipb.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Import a parsed .ipb.json v2 document. Returns the created file metadata. */
export async function fsImportFile(
  data: IpbExportV2,
  strategy: 'fresh' | 'merge' = 'fresh',
): Promise<FsFileMeta> {
  const res = await fetch(`/api/fs/import?strategy=${strategy}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg || `Import failed: HTTP ${res.status}`);
  }
  return (await res.json()) as FsFileMeta;
}
