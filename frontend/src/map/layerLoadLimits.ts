import type { LayerKey } from '../api/types';

// Minimum map zoom at which a layer is allowed to fetch / render. Layers absent
// from this map have no load limit. These limits exist to prevent the browser
// from crashing when a heavy GeoJSON source is enabled while the viewport
// covers a huge area (e.g. all of Finland at z5).
export const MIN_ZOOM_BY_LAYER: Partial<Record<LayerKey, number>> = {
  osm: 11,
  mml: 10,
  mml_contours: 11,
  digiroad: 10,
  opencellid: 14,
};

export function isLayerSuppressedByZoom(layer: LayerKey, zoom: number | null): boolean {
  const min = MIN_ZOOM_BY_LAYER[layer];
  if (min == null) return false;
  if (zoom == null) return false;
  return zoom < min;
}
