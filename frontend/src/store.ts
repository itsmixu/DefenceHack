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
  zoom: number | null;
  setBbox: (bbox: string) => void;
  setZoom: (zoom: number) => void;
}

export const useBboxStore = create<BboxState>((set) => ({
  bbox: null,
  zoom: null,
  setBbox: (bbox) => set({ bbox }),
  setZoom: (zoom) => set({ zoom }),
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
  // Live thumb position — updates on every slider onChange while dragging.
  selectedMs: number;
  // Debounced fetch trigger — only updates on slider release / commit.
  committedMs: number;
  setSelectedMs: (ms: number) => void;
  // Sets selectedMs AND immediately commits — for one-shot interactions
  // (datetime-local inputs, section buttons, programmatic moves).
  commitSelectedMs: (ms: number) => void;
  // Copies the current selectedMs into committedMs — for slider release.
  commitSelected: () => void;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  rangeStartMs: timelineNowMs - TIMELINE_RANGE_PAST_HOURS * 60 * 60 * 1000,
  rangeEndMs: timelineNowMs + TIMELINE_RANGE_FUTURE_HOURS * 60 * 60 * 1000,
  stepMinutes: TIMELINE_STEP_MINUTES,
  selectedMs: timelineNowMs,
  committedMs: timelineNowMs,
  setSelectedMs: (ms) => {
    const { rangeStartMs, rangeEndMs } = get();
    const clamped = Math.min(rangeEndMs, Math.max(rangeStartMs, ms));
    set({ selectedMs: clamped });
  },
  commitSelectedMs: (ms) => {
    const { rangeStartMs, rangeEndMs } = get();
    const clamped = Math.min(rangeEndMs, Math.max(rangeStartMs, ms));
    set({ selectedMs: clamped, committedMs: clamped });
  },
  commitSelected: () => set({ committedMs: get().selectedMs }),
}));

interface LayerState {
  active: Partial<Record<LayerKey, boolean>>;
  status: Partial<Record<LayerKey, LayerStatus>>;
  loading: Partial<Record<LayerKey, boolean>>;
  toggle: (id: LayerKey) => void;
  setStatus: (id: LayerKey, status: LayerStatus) => void;
  setLoading: (id: LayerKey, loading: boolean) => void;
  /** Replace the full active-layer set. Used when loading a saved plan. */
  setActiveLayers: (ids: LayerKey[]) => void;
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
  setActiveLayers: (ids) =>
    set((s) => {
      const next: Partial<Record<LayerKey, boolean>> = {};
      for (const k of Object.keys(s.active) as LayerKey[]) next[k] = false;
      for (const id of ids) next[id] = true;
      return { active: next };
    }),
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
  /** Inject saved layer snapshots directly (bypass network fetch). */
  injectSnapshots: (snapshots: Record<string, { features: Feature[] }>, fileBbox?: Bbox4) => void;
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
  for (const k of ['mtk_id', 'osm_id', 'posti_alue', 'fid', 'gml_id', 'station_id', 'cell_id', 'cellid', 'satid']) {
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
  injectSnapshots: (snapshots, fileBbox) =>
    set((s) => {
      const features = { ...s.features };
      const covered = { ...s.covered };
      const coverageBbox: Bbox4 = fileBbox ?? [-180, -90, 180, 90];
      for (const [id, fc] of Object.entries(snapshots)) {
        if (fc && Array.isArray(fc.features)) {
          features[id as LayerKey] = fc.features as Feature[];
          covered[id as LayerKey] = [coverageBbox];
        }
      }
      return { features, covered };
    }),
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
  addFeature: (f: DrawnFeature) => void;
  removeFeature: (id: string | number) => void;
  updateFeature: (id: string | number, patch: Partial<DrawnFeature>) => void;
  clear: () => void;
  toCollection: () => FeatureCollection;
}

export const useDrawnStore = create<DrawnState>((set, get) => ({
  features: [],
  setAll: (features) => set({ features }),
  addFeature: (f) => set((s) => ({ features: [...s.features, f] })),
  removeFeature: (id) => set((s) => ({ features: s.features.filter((x) => x.id !== id) })),
  updateFeature: (id, patch) => set((s) => ({ features: s.features.map((f) => f.id === id ? { ...f, ...patch } : f) })),
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

// ---------- Tactical drawing state ----------
// Bridges the bottom MapToolbar with DrawControl (inside MapContainer).
// MapToolbar sets pendingType + pendingDrawMode; DrawControl consumes them.

export const MILITARY_FEATURE_TYPES = [
  { type: 'AOI',           label: 'Area of Operations',     mode: 'Polygon'   as const, color: '#ffffff', desc: 'Outer boundary of the operation' },
  { type: 'NAI',           label: 'Named Area of Interest', mode: 'Polygon'   as const, color: '#3b82f6', desc: 'Intel collection target' },
  { type: 'TAI',           label: 'Target Area of Interest',mode: 'Polygon'   as const, color: '#ef4444', desc: 'Engagement / action zone' },
  { type: 'DP',            label: 'Decision Point',         mode: 'Marker'    as const, color: '#f59e0b', desc: 'Triggers a branch in the plan' },
  { type: 'PHASE_LINE',    label: 'Phase Line',             mode: 'Polyline'  as const, color: '#22c55e', desc: 'Control line marking phase transition' },
  { type: 'BOUNDARY',      label: 'Unit Boundary',          mode: 'Polyline'  as const, color: '#f59e0b', desc: 'Lateral boundary between adjacent units' },
  { type: 'ROUTE',         label: 'Route / Axis',           mode: 'Polyline'  as const, color: '#a855f7', desc: 'Axis of advance or withdrawal route' },
  { type: 'OBJECTIVE',     label: 'Objective',              mode: 'Polygon'   as const, color: '#ef4444', desc: 'Named objective to seize/destroy' },
  { type: 'UNIT_FRIENDLY', label: 'Friendly Unit',          mode: 'Marker'    as const, color: '#3b82f6', desc: 'Friendly force position' },
  { type: 'UNIT_ENEMY',    label: 'Enemy / Threat',         mode: 'Marker'    as const, color: '#ef4444', desc: 'Known or suspected enemy position' },
  { type: 'CHOKE_POINT',   label: 'Choke Point',            mode: 'Marker'    as const, color: '#f59e0b', desc: 'Obstacle or terrain bottleneck' },
  { type: 'HIDE_SITE',     label: 'Hide Site / Assembly',   mode: 'Polygon'   as const, color: '#22c55e', desc: 'Assembly area or concealed position' },
  { type: 'annotation',    label: 'Annotation',             mode: 'Polygon'   as const, color: '#9ca3af', desc: 'Freeform note' },
] as const;

export type MilitaryFeatureType = typeof MILITARY_FEATURE_TYPES[number]['type'];

// Active map tool — only one can be active at a time
export type ActiveMapTool = 'arrow' | 'symbol' | 'shape' | 'delete' | 'ruler' | null;

interface TacticalState {
  activeTool: ActiveMapTool;
  setActiveTool: (tool: ActiveMapTool) => void;
  // Geoman shape mode (used when activeTool === 'shape')
  pendingType: MilitaryFeatureType | null;
  pendingDrawMode: 'Polygon' | 'Polyline' | 'Marker' | null;
  setPending: (type: MilitaryFeatureType, mode: 'Polygon' | 'Polyline' | 'Marker') => void;
  clearPending: () => void;
  // Arrow tool
  isArrowMode: boolean;
  arrowColor: string;
  arrowSize: number;
  setArrowMode: (active: boolean) => void;
  setArrowColor: (color: string) => void;
  setArrowSize: (size: number) => void;
  // Symbol tool
  pendingSymbol: { sidc: string; name: string; category: string; isCustom?: boolean; customName?: string } | null;
  setPendingSymbol: (sym: { sidc: string; name: string; category: string; isCustom?: boolean; customName?: string } | null) => void;
  // Delete mode
  isDeleteMode: boolean;
  setDeleteMode: (active: boolean) => void;
}

export const useTacticalStore = create<TacticalState>((set) => ({
  activeTool: null,
  setActiveTool: (activeTool) => set((s) => ({
    activeTool,
    isArrowMode: activeTool === 'arrow',
    isDeleteMode: activeTool === 'delete',
    pendingType: activeTool === 'shape' ? s.pendingType : null,
    pendingDrawMode: activeTool === 'shape' ? s.pendingDrawMode : null,
    pendingSymbol: activeTool === 'symbol' ? s.pendingSymbol : null,
  })),
  pendingType: null,
  pendingDrawMode: null,
  setPending: (pendingType, pendingDrawMode) => set({ pendingType, pendingDrawMode, activeTool: 'shape', isArrowMode: false, isDeleteMode: false }),
  clearPending: () => set({ pendingType: null, pendingDrawMode: null }),
  isArrowMode: false,
  arrowColor: '#ef4444',
  arrowSize: 3,
  setArrowMode: (isArrowMode) => set((s) => ({
    isArrowMode,
    activeTool: isArrowMode ? 'arrow' : (s.activeTool === 'arrow' ? null : s.activeTool),
    isDeleteMode: false,
    pendingType: isArrowMode ? null : s.pendingType,
    pendingDrawMode: isArrowMode ? null : s.pendingDrawMode,
  })),
  setArrowColor: (arrowColor) => set({ arrowColor }),
  setArrowSize: (arrowSize) => set({ arrowSize }),
  pendingSymbol: null,
  setPendingSymbol: (pendingSymbol) => set({ pendingSymbol }),
  isDeleteMode: false,
  setDeleteMode: (isDeleteMode) => set((s) => ({
    isDeleteMode,
    activeTool: isDeleteMode ? 'delete' : (s.activeTool === 'delete' ? null : s.activeTool),
  })),
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
