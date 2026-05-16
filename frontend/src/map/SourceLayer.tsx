import { useEffect, useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import type { Feature, FeatureCollection } from 'geojson';
import { getLayer } from '../api/client';
import type { LayerKey } from '../api/types';
import {
  bboxContains,
  expandBbox,
  parseBbox,
  useBackendStatusStore,
  useBboxStore,
  useFeatureCacheStore,
  useLayerStore,
  useOsmPoiFilterStore,
  useTimelineStore,
} from '../store';
import { getStyleForLayer } from './layerStyles';
import { isLayerSuppressedByZoom } from './layerLoadLimits';
import { TIME_AWARE_LAYER_SET } from './timeAware';

interface Props {
  layer: LayerKey;
}

const isBackendUnavailableError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error')
  );
};

export default function SourceLayer({ layer }: Props) {
  const bbox = useBboxStore((s) => s.bbox);
  const zoom = useBboxStore((s) => s.zoom);
  const suppressedByZoom = isLayerSuppressedByZoom(layer, zoom);
  const setStatus = useLayerStore((s) => s.setStatus);
  const setLoading = useLayerStore((s) => s.setLoading);
  const setBackendUnavailable = useBackendStatusStore((s) => s.setUnavailable);
  const setBackendAvailable = useBackendStatusStore((s) => s.setAvailable);
  const addBatch = useFeatureCacheStore((s) => s.addBatch);
  const cachedFeatures = useFeatureCacheStore((s) => s.features[layer]);
  const coveredList = useFeatureCacheStore((s) => s.covered[layer]);
  const osmEnabled = useOsmPoiFilterStore((s) => s.enabled);
  const clearLayerCache = useFeatureCacheStore((s) => s.clear);
  const committedMs = useTimelineStore((s) => s.committedMs);
  const selectedIso = useMemo(() => new Date(committedMs).toISOString(), [committedMs]);
  const isTimeAware = TIME_AWARE_LAYER_SET.has(layer);

  // Time-aware layers return different data per `t`, but the spatial coverage
  // cache (`covered`) is keyed only on bbox. Without this effect, after the
  // first fetch `alreadyCovered` would short-circuit `needsFetch=false` and
  // the slider would never trigger a re-fetch. Clear the layer's cache when
  // the committed time changes so the next render re-fetches for the new `t`.
  useEffect(() => {
    if (!isTimeAware) return;
    clearLayerCache(layer);
  }, [isTimeAware, committedMs, layer, clearLayerCache]);

  // Decide whether the current viewport is already covered by a previously
  // fetched bbox. If so, skip the network request and just render the cache.
  const { needsFetch, fetchBboxStr } = useMemo(() => {
    if (!bbox) return { needsFetch: false, fetchBboxStr: null as string | null };
    if (suppressedByZoom) return { needsFetch: false, fetchBboxStr: null };
    const viewport = parseBbox(bbox);
    const covered = coveredList ?? [];
    const alreadyCovered = covered.some((b) => bboxContains(b, viewport));
    if (alreadyCovered) return { needsFetch: false, fetchBboxStr: null };
    // Pre-fetch a slightly larger area so small pans stay in cache.
    const expanded = expandBbox(viewport, 0.5);
    return { needsFetch: true, fetchBboxStr: expanded.join(',') };
  }, [bbox, coveredList, suppressedByZoom]);

  const query = useQuery({
    // Non-time-aware layers omit selectedIso from the key so they don't
    // invalidate (and re-fetch) every time the timeline scrubber moves.
    queryKey: isTimeAware
      ? ['layer', layer, fetchBboxStr, selectedIso]
      : ['layer', layer, fetchBboxStr],
    enabled: needsFetch && !!fetchBboxStr,
    queryFn: () => {
      if (!fetchBboxStr) throw new Error('no bbox');
      const params = isTimeAware
        ? { bbox: fetchBboxStr, t: selectedIso }
        : { bbox: fetchBboxStr };
      return getLayer(layer, params);
    },
  });

  useEffect(() => {
    setLoading(layer, query.isFetching);
  }, [query.isFetching, layer, setLoading]);

  useEffect(() => {
    return () => setLoading(layer, false);
  }, [layer, setLoading]);

  // Merge fetched features into the per-layer cache.
  useEffect(() => {
    if (!query.data || !fetchBboxStr) return;
    const fetched = parseBbox(fetchBboxStr);
    addBatch(layer, fetched, query.data.features ?? []);
  }, [query.data, fetchBboxStr, layer, addBatch]);

  useEffect(() => {
    if (query.data?.meta?.status) {
      setBackendAvailable();
      setStatus(layer, query.data.meta.status);
    } else if (query.isError) {
      if (isBackendUnavailableError(query.error)) {
        setBackendUnavailable('Backend unreachable at /api (is port 8000 running?)');
      }
      setStatus(layer, 'error');
    } else if (!needsFetch && (cachedFeatures?.length ?? 0) > 0) {
      // No fetch needed and we already have data — stay green.
      setStatus(layer, 'ok');
    }
  }, [
    query.data,
    query.isError,
    query.error,
    needsFetch,
    cachedFeatures,
    layer,
    setStatus,
    setBackendUnavailable,
    setBackendAvailable,
  ]);

  const style = useMemo(() => getStyleForLayer(layer, zoom), [layer, zoom]);

  const collection = useMemo<FeatureCollection | null>(() => {
    if (!cachedFeatures || cachedFeatures.length === 0) return null;

    if (layer === 'osm') {
      const visible = cachedFeatures.filter((f) => {
        const cat = String((f.properties as Record<string, unknown> | null)?.category ?? '');
        return osmEnabled.includes(cat as (typeof osmEnabled)[number]);
      });
      return { type: 'FeatureCollection', features: visible };
    }

    // fmi_forecast returns 9 grid points × 48 hourly timesteps stacked at the
    // same coordinates. Without time filtering the map shows every timestep at
    // once and the slider has no visible effect. Pick the timestep nearest to
    // committedMs at each grid point so each slider move snaps to one frame.
    if (layer === 'fmi_forecast') {
      type GridKey = string;
      const target = committedMs;
      const best = new Map<GridKey, { delta: number; feature: Feature }>();
      for (const f of cachedFeatures) {
        const p = (f.properties ?? {}) as Record<string, unknown>;
        const time = typeof p.time === 'string' ? Date.parse(p.time) : NaN;
        if (!Number.isFinite(time)) continue;
        const i = p.grid_i ?? 0;
        const j = p.grid_j ?? 0;
        const key: GridKey = `${i},${j}`;
        const delta = Math.abs(time - target);
        const cur = best.get(key);
        if (!cur || delta < cur.delta) best.set(key, { delta, feature: f });
      }
      return {
        type: 'FeatureCollection',
        features: [...best.values()].map((v) => v.feature),
      };
    }

    return { type: 'FeatureCollection', features: cachedFeatures };
  }, [cachedFeatures, layer, osmEnabled, committedMs]);

  if (suppressedByZoom) return null;
  if (!collection || collection.features.length === 0) return null;

  return (
    <GeoJSON
      key={`${layer}-${cachedFeatures?.length ?? 0}-${collection.features.length}-${isTimeAware ? committedMs : 'na'}-z${zoom ?? 'na'}`}
      data={collection}
      style={style.style}
      pointToLayer={style.pointToLayer}
      onEachFeature={style.onEachFeature}
    />
  );
}
