import type { Feature, FeatureCollection } from 'geojson';

export type SourceId =
  | 'osm'
  | 'digiroad'
  | 'mml'
  | 'mml_contours'
  | 'statfin'
  | 'fmi'
  | 'fmi_forecast'
  | 'syke'
  | 'opencellid'
  | 'n2yo'
  | 'exposure'
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

export type LayerStatus = 'ok' | 'unavailable' | 'error' | 'partial' | 'degraded';

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

// ─── /api/analyze/terrain-effects ─────────────────────────────────────────

export interface TerrainFunctionRating {
  rating: 'unrestricted' | 'restricted' | 'severely_restricted' | 'unknown';
  cite?: string;
  rationale?: string;
  key_factors?: string[];
}

export interface TerrainEffectsResponse {
  bbox: [number, number, number, number];
  t: string | null;
  doctrine: string;
  summary: string;
  functions: Record<string, TerrainFunctionRating>;
  mobility?: {
    bridge_count?: number;
    weighted_mech_speed_kmh?: number;
    network_capacity_vph?: number;
    flow_classes?: Record<string, number>;
    [k: string]: unknown;
  };
  terrain_composition?: {
    no_go_pct: number;
    slow_go_pct: number;
    go_pct: number;
    total_polygons: number;
  };
  weather?: {
    avg_temp_c: number | null;
    avg_wind_ms: number | null;
    stations: number;
    environment_rating?: string;
    aviation_rating?: string;
  };
  source_status?: Record<string, string>;
  meta?: LayerMeta;
}

// ─── /api/analyze/drone-conditions ────────────────────────────────────────

export type DroneRating = 'go' | 'marginal' | 'no-go' | 'unknown';

export interface DroneForecastStep {
  time: string;
  drone_rating: DroneRating;
  drone_summary?: string;
  wind_ms?: number | null;
  gust_ms?: number | null;
  temperature_c?: number | null;
  precipitation_mmh?: number | null;
  ceiling_m?: number | null;
}

export interface DroneConditionsResponse {
  bbox: [number, number, number, number];
  t: string | null;
  summary: {
    current_rating: DroneRating;
    next_go_window?: string | null;
    forecast_hours_available?: number;
    [k: string]: unknown;
  };
  station_features: FeatureCollection;
  forecast_timeline: DroneForecastStep[];
  thresholds: Record<string, number>;
  meta?: LayerMeta;
}

// ─── /api/analyze/mobility ────────────────────────────────────────────────

export type VehicleClass = 'tank' | 'wheeled' | 'tracked' | 'logistics' | 'foot';

export interface MobilityResponse extends FeatureCollection {
  meta: LayerMeta & {
    vehicle_class?: VehicleClass;
    weighted_speed_kmh?: number;
  };
}

// ─── /api/analyze/viewshed ────────────────────────────────────────────────

export interface ViewshedResponse extends FeatureCollection {
  meta: LayerMeta & {
    observer?: {
      lon: number;
      lat: number;
      height_m: number;
      horizon_km: number;
    } | null;
  };
}

// ─── /api/analyze/astronomical ────────────────────────────────────────────

export interface AstronomicalDayProps {
  date: string;
  sunrise?: string;
  sunset?: string;
  civil_dawn?: string;
  civil_dusk?: string;
  nautical_dawn?: string;
  nautical_dusk?: string;
  noon?: string;
  moon_illumination_pct: number | null;
  moon_phase_days?: number;
  night_ops_rating: 'dark' | 'partial' | 'bright' | 'unknown';
  darkness_hours?: number | null;
}

export type AstronomicalFeature = Feature & { properties: AstronomicalDayProps };

export interface AstronomicalResponse extends FeatureCollection {
  features: AstronomicalFeature[];
  meta: LayerMeta;
}

// ─── /api/timeline/* ──────────────────────────────────────────────────────

export interface TimelineCapability {
  time_aware: boolean;
  min_date?: string;
  max_date?: string;
  resolution?: string;
  note?: string;
  reason?: string;
}

export interface TimelineCapabilitiesResponse {
  time_aware_sources: SourceId[];
  snapshot_sources: SourceId[];
  oldest_supported_date: string;
  sources: Record<SourceId, TimelineCapability>;
}

export interface TimelineSnapshotResponse {
  t: string;
  bbox: [number, number, number, number];
  layers: Record<string, LayerResponse>;
  source_status: Record<string, string>;
  meta: {
    fetch_ms: number;
    sources_requested: string[];
    sources_fetched: string[];
    sources_skipped: string[];
  };
}

// ── Plans & versions ──────────────────────────────────────────────────────────

export interface Phase {
  id: number;
  name: string;
  drawn_features: FeatureCollection;
  active_layers: string[];
  notes: string;
  conditions_snapshot?: Record<string, unknown>;
}

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
  unit?: string;
  commander_name?: string;
  parent_plan_id?: string | null;
  phases?: Phase[];
  conditions_snapshot?: Record<string, unknown>;
}

export type PlanSummary = Omit<Plan, 'drawn_features'>;

export interface PlanVersion {
  plan_id: string;
  version: number;
  label: string;
  role?: string;
  saved_at: string;
  bbox?: [number, number, number, number];
  drawn_features: FeatureCollection;
  active_layers?: string[];
  notes?: string;
  conditions_snapshot?: Record<string, unknown>;
}

export type PlanVersionSummary = Omit<PlanVersion, 'drawn_features'>;

export interface OperationPrediction {
  notes?: string;
  threat_assessment?: string;
  expected_outcome?: string;
}

export interface OperationActual {
  notes?: string;
  outcome?: string;
  recorded_at?: string;
}

export interface Operation {
  id: string;
  name: string;
  plan_id?: string;
  bbox?: [number, number, number, number];
  prediction: OperationPrediction;
  actual?: OperationActual | null;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

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

// ── Filesystem (new project snapshot system) ──────────────────────────────────

export interface FsFolder {
  id: string;
  type: 'folder';
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FsFileMeta {
  id: string;
  type: 'file';
  name: string;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
  bbox?: [number, number, number, number] | null;
  active_layers: string[];
  timeline_selected_ms?: number | null;
  layer_count: number;
  feature_count: number;
  unit?: string;
  commander_name?: string;
  parent_file_id?: string | null;
  notes_preview?: string;
}

export interface FsFileContent extends FsFileMeta {
  notes: string;
  center?: [number, number] | null;
  zoom?: number | null;
  drawn_features: FeatureCollection;
  phases: Phase[];
  current_phase: number;
  layer_snapshots: Record<string, FeatureCollection>;
  conditions: Record<string, unknown>;
}

export interface FsTree {
  folders: FsFolder[];
  files: FsFileMeta[];
}

export interface FsSaveBody {
  id?: string;
  name: string;
  folder_id?: string | null;
  bbox?: [number, number, number, number] | null;
  center?: [number, number] | null;
  zoom?: number | null;
  timeline_selected_ms?: number | null;
  active_layers: string[];
  drawn_features: FeatureCollection;
  phases?: Phase[];
  current_phase?: number;
  layer_snapshots: Record<string, FeatureCollection>;
  conditions?: Record<string, unknown>;
  notes?: string;
  unit?: string;
  commander_name?: string;
  parent_file_id?: string | null;
}
