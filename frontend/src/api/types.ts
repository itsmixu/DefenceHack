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
