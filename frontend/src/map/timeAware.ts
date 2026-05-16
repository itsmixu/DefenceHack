import type { LayerKey } from '../api/types';

// Layers whose backend provider actually consumes the `t` query param to
// produce different data per timestamp. Cross-checked against the providers:
//   fmi           — observation window around t
//   fmi_forecast  — forecast base time
//   astronomy     — sun/moon for date
//   starlink      — SGP4 propagation at t
// osm is intentionally NOT here: Overpass's [date:...] filter rejects
// now/future timestamps with HTTP 406, and the default committedMs is
// Date.now(). Treat OSM as static (current state only).
export const TIME_AWARE_LAYERS: readonly LayerKey[] = [
  'fmi',
  'fmi_forecast',
  'astronomy',
  'starlink',
] as const;

export const TIME_AWARE_LAYER_SET: ReadonlySet<LayerKey> = new Set(TIME_AWARE_LAYERS);
