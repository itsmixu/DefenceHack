import { useEffect, useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import type { FeatureCollection } from 'geojson';
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

// Only these layers genuinely return different data for different timestamps.
// All other layers (mml, digiroad, opencellid, starlink, exposure, mcoo) are static
// and must NOT be re-fetched when the timeline scrubber moves — doing so would
// erase their cache and cause unnecessary network requests.
// astronomy: computed locally by astral — any date, zero latency.
// fmi_forecast: different forecast at different base times.
// statfin: annual resolution — skip (same data all year, not useful to re-fetch hourly).
const TIME_AWARE: Set<LayerKey> = new Set(['fmi', 'osm', 'astronomy', 'fmi_forecast']);

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
  const setStatus = useLayerStore((s) => s.setStatus);
  const setLoading = useLayerStore((s) => s.setLoading);
  const setBackendUnavailable = useBackendStatusStore((s) => s.setUnavailable);
  const setBackendAvailable = useBackendStatusStore((s) => s.setAvailable);
  const addBatch = useFeatureCacheStore((s) => s.addBatch);
  const cachedFeatures = useFeatureCacheStore((s) => s.features[layer]);
  const coveredList = useFeatureCacheStore((s) => s.covered[layer]);
  const osmEnabled = useOsmPoiFilterStore((s) => s.enabled);
  const selectedMs = useTimelineStore((s) => s.selectedMs);
  const selectedIso = useMemo(() => new Date(selectedMs).toISOString(), [selectedMs]);

  // Decide whether the current viewport is already covered by a previously
  // fetched bbox. If so, skip the network request and just render the cache.
  const { needsFetch, fetchBboxStr } = useMemo(() => {
    if (!bbox) return { needsFetch: false, fetchBboxStr: null as string | null };
    const viewport = parseBbox(bbox);
    const covered = coveredList ?? [];
    const alreadyCovered = covered.some((b) => bboxContains(b, viewport));
    if (alreadyCovered) return { needsFetch: false, fetchBboxStr: null };
    // Pre-fetch a slightly larger area so small pans stay in cache.
    const expanded = expandBbox(viewport, 0.5);
    return { needsFetch: true, fetchBboxStr: expanded.join(',') };
  }, [bbox, coveredList]);

  const isTimeAware = TIME_AWARE.has(layer);

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

  const style = useMemo(() => getStyleForLayer(layer), [layer]);

  const collection = useMemo<FeatureCollection | null>(() => {
    if (!cachedFeatures || cachedFeatures.length === 0) return null;
    if (layer !== 'osm') return { type: 'FeatureCollection', features: cachedFeatures };

    const visible = cachedFeatures.filter((f) => {
      const cat = String((f.properties as Record<string, unknown> | null)?.category ?? '');
      return osmEnabled.includes(cat as (typeof osmEnabled)[number]);
    });
    return { type: 'FeatureCollection', features: visible };
  }, [cachedFeatures, layer, osmEnabled]);

  if (!collection || collection.features.length === 0) return null;

  return (
    <GeoJSON
      key={`${layer}-${cachedFeatures?.length ?? 0}`}
      data={collection}
      style={style.style}
      pointToLayer={style.pointToLayer}
      onEachFeature={style.onEachFeature}
    />
  );
}
