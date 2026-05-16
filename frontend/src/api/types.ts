import type { Feature, FeatureCollection } from 'geojson';

export type SourceId =
  | 'osm'
  | 'digiroad'
  | 'mml'
  | 'mml_contours'
  | 'statfin'
  | 'fmi'
  | 'fmi_forecast'
  | 'opencellid'
  | 'n2yo'
  | 'exposure'
  | 'syke'
  | 'astronomy';

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

// ── Phase planning ─────────────────────────────────────────────────────────────
// A plan can have up to 5 phases. Each phase has its own drawn shapes and active
// layers. The commander switches between phases; each phase can be annotated
// independently (e.g. "Phase 1 — Approach", "Phase 2 — Assault").

export interface Phase {
  id: number;        // 1-5
  name: string;      // user-editable, e.g. "Phase 1 — Approach"
  drawn_features: FeatureCollection;
  active_layers: string[];
  notes: string;
  conditions_snapshot?: Record<string, unknown>;
}

// ── Plans & versions ──────────────────────────────────────────────────────────

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
  // Command hierarchy
  unit?: string;
  commander_name?: string;
  parent_plan_id?: string | null;
  // Phase planning
  phases?: Phase[];
  // Conditions captured at save time
  conditions_snapshot?: Record<string, unknown>;
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
  unit?: string;
  commander_name?: string;
  parent_plan_id?: string | null;
  phases?: Phase[];
  conditions_snapshot?: Record<string, unknown>;
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
