import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Map as LeafletMap } from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import type { DrawnFeature, LayerKey, LayerStatus } from './api/types';
import { ALL_OSM_POI_CATEGORIES, type OsmPoiCategory } from './map/osmPoi';

export type Bbox4 = [number, number, number, number];

// ---------- Map handle (for programmatic flyTo) ----------
interface MapHandleState {
  map: LeafletMap | null;
  setMap: (m: LeafletMap | null) => void;
}
export const useMapStore = create<MapHandleState>((set) => ({
  map: null,
  setMap: (map) => set({ map }),
}));

// ---------- Backend connectivity status ----------
interface BackendStatusState {
  unavailable: boolean;
  reason?: string;
  setUnavailable: (reason?: string) => void;
  setAvailable: () => void;
}

export const useBackendStatusStore = create<BackendStatusState>((set) => ({
  unavailable: false,
  reason: undefined,
  setUnavailable: (reason) => set({ unavailable: true, reason }),
  setAvailable: () => set({ unavailable: false, reason: undefined }),
}));

// ---------- Bbox state ----------
interface BboxState {
  bbox: string | null;
  setBbox: (bbox: string) => void;
}

export const useBboxStore = create<BboxState>((set) => ({
  bbox: null,
  setBbox: (bbox) => set({ bbox }),
}));

// ---------- Timeline state ----------
const TIMELINE_RANGE_PAST_HOURS = 72;
const TIMELINE_RANGE_FUTURE_HOURS = 48;
const TIMELINE_STEP_MINUTES = 60;

const timelineNowMs = Date.now();

interface TimelineState {
  rangeStartMs: number;
  rangeEndMs: number;
  stepMinutes: number;
  selectedMs: number;
  setSelectedMs: (ms: number) => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  rangeStartMs: timelineNowMs - TIMELINE_RANGE_PAST_HOURS * 60 * 60 * 1000,
  rangeEndMs: timelineNowMs + TIMELINE_RANGE_FUTURE_HOURS * 60 * 60 * 1000,
  stepMinutes: TIMELINE_STEP_MINUTES,
  selectedMs: timelineNowMs,
  setSelectedMs: (ms) => {
    const { rangeStartMs, rangeEndMs } = get();
    const clamped = Math.min(rangeEndMs, Math.max(rangeStartMs, ms));
    set({ selectedMs: clamped });
  },
}));

interface LayerState {
  active: Partial<Record<LayerKey, boolean>>;
  status: Partial<Record<LayerKey, LayerStatus>>;
  loading: Partial<Record<LayerKey, boolean>>;
  toggle: (id: LayerKey) => void;
  setStatus: (id: LayerKey, status: LayerStatus) => void;
  setLoading: (id: LayerKey, loading: boolean) => void;
}

export const useLayerStore = create<LayerState>((set) => ({
  active: {},
  status: {},
  loading: {},
  toggle: (id) =>
    set((s) => ({ active: { ...s.active, [id]: !s.active[id] } })),
  setStatus: (id, status) =>
    set((s) => ({ status: { ...s.status, [id]: status } })),
  setLoading: (id, loading) =>
    set((s) => ({ loading: { ...s.loading, [id]: loading } })),
}));

// Per-layer feature cache. Features accumulate as the user pans the map,
// deduplicated by feature key, so that scrolling back over visited area
// is instant. `covered` tracks the bboxes we've successfully fetched; if
// the current viewport is contained in any of them we skip the request.
interface FeatureCacheState {
  features: Partial<Record<LayerKey, Feature[]>>;
  covered: Partial<Record<LayerKey, Bbox4[]>>;
  addBatch: (id: LayerKey, fetched: Bbox4, features: Feature[]) => void;
  clear: (id: LayerKey) => void;
  clearAll: () => void;
}

// 32-bit FNV-1a hash — fast, no deps, good enough to dedupe geometries.
const hashStr = (s: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
};

const featureKey = (f: Feature): string => {
  if (f.id != null) return `id:${f.id}`;
  const props = (f.properties ?? {}) as Record<string, unknown>;
  // Try common stable identifiers across our providers.
  for (const k of ['mtk_id', 'osm_id', 'posti_alue', 'fid', 'gml_id', 'station_id', 'cell_id']) {
    if (props[k] != null) return `${k}:${String(props[k])}`;
  }
  // Fallback: hash the full geometry so every distinct polygon gets a distinct key.
  return `g:${hashStr(JSON.stringify(f.geometry))}`;
};

export const useFeatureCacheStore = create<FeatureCacheState>((set) => ({
  features: {},
  covered: {},
  addBatch: (id, fetched, incoming) =>
    set((s) => {
      const existing = s.features[id] ?? [];
      const seen = new Set(existing.map(featureKey));
      const merged = existing.slice();
      for (const f of incoming) {
        const k = featureKey(f);
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(f);
        }
      }
      const coveredList = s.covered[id] ?? [];
      return {
        features: { ...s.features, [id]: merged },
        covered: { ...s.covered, [id]: [...coveredList, fetched] },
      };
    }),
  clear: (id) =>
    set((s) => ({
      features: { ...s.features, [id]: [] },
      covered: { ...s.covered, [id]: [] },
    })),
  clearAll: () => set({ features: {}, covered: {} }),
}));

export const bboxContains = (outer: Bbox4, inner: Bbox4): boolean =>
  outer[0] <= inner[0] &&
  outer[1] <= inner[1] &&
  outer[2] >= inner[2] &&
  outer[3] >= inner[3];

export const expandBbox = (b: Bbox4, factor = 0.5): Bbox4 => {
  const dx = (b[2] - b[0]) * factor * 0.5;
  const dy = (b[3] - b[1]) * factor * 0.5;
  return [b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy];
};

export const parseBbox = (s: string): Bbox4 => {
  const [a, b, c, d] = s.split(',').map(Number);
  return [a, b, c, d];
};

interface DrawnState {
  features: DrawnFeature[];
  setAll: (fs: DrawnFeature[]) => void;
  clear: () => void;
  toCollection: () => FeatureCollection;
}

export const useDrawnStore = create<DrawnState>((set, get) => ({
  features: [],
  setAll: (features) => set({ features }),
  clear: () => set({ features: [] }),
  toCollection: () => ({ type: 'FeatureCollection', features: get().features }),
}));

// ---------- Layer config slots 1..5 (persisted) ----------
export interface LayerSlot {
  layers: LayerKey[];
  savedAt: number;
}

interface LayerSlotsState {
  slots: (LayerSlot | null)[];
  save: (i: number, slot: LayerSlot) => void;
  clear: (i: number) => void;
}

export const useLayerSlotsStore = create<LayerSlotsState>()(
  persist(
    (set) => ({
      slots: [null, null, null, null, null],
      save: (i, slot) =>
        set((s) => {
          const next = s.slots.slice();
          next[i] = slot;
          return { slots: next };
        }),
      clear: (i) =>
        set((s) => {
          const next = s.slots.slice();
          next[i] = null;
          return { slots: next };
        }),
    }),
    { name: 'ipb-layer-slots' },
  ),
);

// ---------- Operation Zones (persisted) ----------
export interface Zone {
  id: string;
  name: string;
  bbox: Bbox4;
  center: [number, number]; // [lat, lon]
  zoom: number;
  createdAt: number;
  prefetchStatus?: 'idle' | 'fetching' | 'ready' | 'error';
  lastFetchedAt?: number;
}

interface ZonesState {
  zones: Zone[];
  add: (z: Omit<Zone, 'id' | 'createdAt' | 'prefetchStatus' | 'lastFetchedAt'>) => Zone;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  update: (
    id: string,
    changes: Partial<Pick<Zone, 'name' | 'bbox' | 'center' | 'zoom'>>,
  ) => void;
  setPrefetch: (
    id: string,
    status: NonNullable<Zone['prefetchStatus']>,
    lastFetchedAt?: number,
  ) => void;
}

const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `z_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const useZonesStore = create<ZonesState>()(
  persist(
    (set) => ({
      zones: [],
      add: (z) => {
        const zone: Zone = {
          ...z,
          id: genId(),
          createdAt: Date.now(),
          prefetchStatus: 'idle',
        };
        set((s) => ({ zones: [...s.zones, zone] }));
        return zone;
      },
      remove: (id) => set((s) => ({ zones: s.zones.filter((z) => z.id !== id) })),
      rename: (id, name) =>
        set((s) => ({
          zones: s.zones.map((z) => (z.id === id ? { ...z, name } : z)),
        })),
      update: (id, changes) =>
        set((s) => ({
          zones: s.zones.map((z) => (z.id === id ? { ...z, ...changes } : z)),
        })),
      setPrefetch: (id, status, lastFetchedAt) =>
        set((s) => ({
          zones: s.zones.map((z) =>
            z.id === id
              ? {
                  ...z,
                  prefetchStatus: status,
                  ...(lastFetchedAt !== undefined ? { lastFetchedAt } : {}),
                }
              : z,
          ),
        })),
    }),
    { name: 'ipb-zones' },
  ),
);

// ---------- Toasts (visual indicators) ----------
export type ToastKind = 'info' | 'success' | 'error';
export interface Toast {
  id: string;
  kind: ToastKind;
  text: string;
}

interface ToastsState {
  toasts: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastsState>((set, get) => ({
  toasts: [],
  push: (kind, text) => {
    const id = genId();
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: get().toasts.filter((t) => t.id !== id) })),
}));

// ---------- OSM POI category filters (persisted) ----------
interface OsmPoiFilterState {
  enabled: OsmPoiCategory[];
  toggle: (category: OsmPoiCategory) => void;
  setAll: () => void;
  clearAll: () => void;
}

export const useOsmPoiFilterStore = create<OsmPoiFilterState>()(
  persist(
    (set) => ({
      enabled: ALL_OSM_POI_CATEGORIES,
      toggle: (category) =>
        set((s) => {
          const has = s.enabled.includes(category);
          return {
            enabled: has ? s.enabled.filter((c) => c !== category) : [...s.enabled, category],
          };
        }),
      setAll: () => set({ enabled: ALL_OSM_POI_CATEGORIES }),
      clearAll: () => set({ enabled: [] }),
    }),
    { name: 'ipb-osm-poi-filters' },
  ),
);
