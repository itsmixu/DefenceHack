import type { QueryClient } from '@tanstack/react-query';
import { getLayer } from '../api/client';
import type { LayerKey } from '../api/types';
import { type Bbox4, expandBbox, useFeatureCacheStore } from '../store';

// Layers we eagerly fetch when an operation zone is created or activated.
// Keep this in sync with ALL_LAYERS in MapView.
export const PREFETCH_LAYERS: LayerKey[] = [
  'osm',
  'digiroad',
  'mml',
  'mml_contours',
  'statfin',
  'fmi',
  'opencellid',
  'starlink',
  'exposure',
  'mcoo',
];

export interface PrefetchResult {
  layer: LayerKey;
  ok: boolean;
  count: number;
  reason?: string;
  backendDown?: boolean;
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

/** Fetch every source for the given bbox in parallel and feed the results
 *  into the in-memory feature cache. Returns a per-layer summary. */
export async function prefetchBbox(
  qc: QueryClient,
  bbox: Bbox4,
  t?: string,
): Promise<PrefetchResult[]> {
  // Expand the requested bbox a bit so that small differences between the
  // saved zone bounds and the user's actual viewport (after flyTo) still
  // pass the containment check in the feature cache.
  const fetched = expandBbox(bbox, 0.4);
  const bboxStr = fetched.join(',');
  const addBatch = useFeatureCacheStore.getState().addBatch;

  const tasks = PREFETCH_LAYERS.map(async (layer): Promise<PrefetchResult> => {
    try {
      const data = await qc.fetchQuery({
        queryKey: ['layer', layer, bboxStr, t ?? 'now'],
        queryFn: () => getLayer(layer, { bbox: bboxStr, t }),
      });
      const features = data.features ?? [];
      addBatch(layer, fetched, features);
      return { layer, ok: true, count: features.length, reason: data.meta?.reason };
    } catch (err) {
      return {
        layer,
        ok: false,
        count: 0,
        reason: err instanceof Error ? err.message : String(err),
        backendDown: isBackendUnavailableError(err),
      };
    }
  });

  return Promise.all(tasks);
}
