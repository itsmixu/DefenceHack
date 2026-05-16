import type { Feature, FeatureCollection } from 'geojson';

export type SourceId =
  | 'osm'
  | 'digiroad'
  | 'mml'
  | 'mml_contours'
  | 'statfin'
  | 'fmi'
  | 'opencellid'
  | 'n2yo'
  | 'exposure';

export type LayerKey = SourceId | 'mcoo';

export interface SourceInfo {
  id: SourceId;
  name: string;
  description?: string;
  bbox_required?: boolean;
  tags?: string[];
  auth_required?: boolean;
}

export type LayerStatus = 'ok' | 'unavailable' | 'error';

export interface LayerMeta {
  status: LayerStatus;
  reason?: string;
  [key: string]: unknown;
}

export interface LayerResponse extends FeatureCollection {
  meta: LayerMeta;
}

export type DrawnFeature = Feature & {
  properties: { feature_type?: string; [k: string]: unknown };
};

export interface TerrainEffectsResponse {
  summary: string;
  functions: Record<
    string,
    { rating: string; rationale: string; key_factors: string[] }
  >;
  source_status?: Record<string, string>;
  meta?: LayerMeta;
}

// ── Plans & versions ──────────────────────────────────────────────────────────
//
// A Plan is a named save of the current map state. Multiple version snapshots
// can be attached to each plan so trainees can scrub through how the plan
// evolved from initial draft to final approved order.

export interface Plan {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  bbox: [number, number, number, number] | null;
  drawn_features: FeatureCollection;
  active_layers: string[];
  notes: string;
  role?: string;
}

/** Summary returned by GET /api/plans (no drawn_features to keep payload small). */
export type PlanSummary = Omit<Plan, 'drawn_features'>;

export interface PlanVersion {
  plan_id: string;
  version: number;
  label: string;
  role?: string;
  saved_at: string;
  bbox: [number, number, number, number] | null;
  drawn_features: FeatureCollection;
  active_layers: string[];
  notes: string;
  /** Snapshot of live data captured at save time (fmi, astronomy, etc.). */
  conditions_snapshot?: Record<string, unknown>;
}

/** Summary returned by GET /api/plans/{id}/versions (no drawn_features). */
export type PlanVersionSummary = Omit<PlanVersion, 'drawn_features'>;

export interface CreatePlanBody {
  name: string;
  bbox?: [number, number, number, number];
  drawn_features?: FeatureCollection;
  active_layers?: string[];
  notes?: string;
  role?: string;
}

export interface CreateVersionBody {
  label: string;
  role?: string;
  bbox?: [number, number, number, number];
  drawn_features?: FeatureCollection;
  active_layers?: string[];
  notes?: string;
  conditions_snapshot?: Record<string, unknown>;
}
