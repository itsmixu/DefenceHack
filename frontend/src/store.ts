import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Map as LeafletMap } from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import type {
  DrawnFeature,
  FsFileContent,
  LayerKey,
  LayerStatus,
  Phase,
  Rank,
} from './api/types';
import { RANK_DEFAULT } from './api/types';
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

// =============================================================================
// Open-files / tab system with command-hierarchy combine logic
// =============================================================================
//
// PROBLEM
//   An officer planning at battalion level wants to see what their company
//   commanders have planned, overlay those plans on top of their own map,
//   and optionally merge a subordinate's drawn features into one of their
//   own phases. A company commander does NOT get to peek into the
//   battalion's plan — command authority is one-way, top-down.
//
// MENTAL MODEL
//   Each open file lives in a "tab". Exactly one tab is ACTIVE at any time:
//   its map state (drawn features, layers, viewport, timeline) is loaded
//   into the live stores (useDrawnStore / useLayerStore / useFeatureCacheStore
//   / useTimelineStore) and is what the user is currently editing.
//
//   The other open tabs are dormant — their state lives only inside this
//   store. The user can pick any dormant tab as the new active tab; we
//   snapshot the outgoing tab's state into its own record before swapping
//   the incoming tab's state into the live stores.
//
// OVERLAY (the "combine" feature)
//   When the active tab outranks one or more open tabs, the user may add
//   those subordinate tabs to the OVERLAY set. Overlay tabs are dormant
//   AND read-only AND visualised on top of the active map's drawings,
//   tagged with the subordinate's unit name. Editing those features is
//   not allowed — the user must explicitly MERGE them into the active
//   tab's current phase first (which copies the drawn features over).
//
// RANK GATING
//   `canCommand(a, b)` returns true iff `a.rank > b.rank` OR `b` is a
//   descendant of `a` in the parent_file_id graph. Either condition is
//   sufficient: rank is the cheap check that doesn't need network calls,
//   the parent_file_id graph is what was explicitly set up by the user.
//
//   Subordinates may still OPEN their commander's file as a tab (and
//   switch to it), but cannot use it as an overlay or merge from it.

/**
 * One snapshot of a saved file held in the open-files store.
 *
 * The `phases` array is the source of truth for this tab while it's open.
 * When this tab is the active tab, the contents of its current phase are
 * mirrored into the live editing stores; when the user switches tabs, the
 * live stores are flushed back into this object before the next tab is
 * promoted.
 */
export interface OpenFileTab {
  id: string;                       // file ID — matches FsFileMeta.id
  name: string;
  folderId: string | null;
  rank: Rank;
  unit: string;
  commanderName: string;
  parentFileId: string | null;
  phases: Phase[];
  activePhaseId: number;
  /** True if the user has made edits since last save-to-disk. */
  isDirty: boolean;
  /** Monotonic timestamp set when the tab was opened (used for ordering). */
  openedAt: number;
}

/**
 * A snapshot of the live editing stores at a single point in time.
 *
 * Passed into the store when switching tabs / phases so the outgoing
 * context can be captured without coupling this store to the live ones.
 */
export interface LiveMapState {
  drawnFeatures: DrawnFeature[];
  activeLayers: LayerKey[];
  layerSnapshots: Record<string, FeatureCollection>;
  bbox: [number, number, number, number] | null;
  center: [number, number] | null;
  zoom: number | null;
  timelineSelectedMs: number | null;
}

export type RankRelation =
  | 'self'        // same file
  | 'commands'    // a outranks b (or b is descendant of a)
  | 'commandedBy' // b outranks a
  | 'peer'        // same rank, neither is descendant of the other
  | 'unrelated';

interface OpenFilesState {
  /** Insertion-ordered tabs. */
  tabs: OpenFileTab[];
  /** Currently active tab — its phase data is mirrored to the live stores. */
  activeTabId: string | null;
  /**
   * Dormant tabs whose drawings should be visualised on top of the active
   * tab's map. Always a strict subset of `tabs - activeTabId`. Adding a tab
   * to this set is only permitted if the active tab outranks it.
   */
  overlayTabIds: string[];

  // ── Read-only selectors ─────────────────────────────────────────────────
  getActiveTab: () => OpenFileTab | null;
  getTab: (id: string) => OpenFileTab | null;
  getOverlayTabs: () => OpenFileTab[];

  /**
   * Decide whether `commander` (active tab) is permitted to combine, mirror,
   * or pull plans from `subordinate`.
   *
   * Both conditions taken together — rank delta AND ancestry — make this
   * resistant to mistakes where ranks haven't been set yet (ancestry still
   * grants authority) and where parent links haven't been wired up yet
   * (rank still grants authority).
   */
  canCommand: (commanderId: string, subordinateId: string) => boolean;

  /** Relationship descriptor (used by the UI to label tab badges). */
  rankRelation: (aId: string, bId: string) => RankRelation;

  // ── Tab lifecycle ───────────────────────────────────────────────────────

  /**
   * Open a file as a new tab (or focus the existing tab if already open).
   *
   * If `liveStateForCurrentActive` is provided AND a different tab is
   * already active, that tab's currently-displayed phase is updated with
   * the live state before the new tab takes focus. The caller is
   * responsible for actually loading the new tab's active phase into the
   * live stores after this returns (see `useOpenFilesStore` consumers).
   */
  openTab: (
    content: FsFileContent,
    liveStateForCurrentActive?: LiveMapState,
  ) => OpenFileTab;

  /**
   * Close a tab. If the closed tab was active, the next tab in insertion
   * order is promoted to active (and the caller must load its phase data).
   * Returns the new active tab id (or null if no tabs remain).
   */
  closeTab: (id: string, liveStateForClosedTab?: LiveMapState) => string | null;

  /**
   * Switch focus to another open tab. Captures the outgoing tab's live
   * state first. Caller is responsible for actually mirroring the incoming
   * tab's active phase into the live stores.
   */
  setActiveTab: (id: string, liveStateForCurrentActive?: LiveMapState) => OpenFileTab | null;

  /** Switch the active tab's selected phase. */
  setTabPhase: (
    tabId: string,
    phaseId: number,
    liveStateForCurrentPhase?: LiveMapState,
  ) => Phase | null;

  /**
   * Capture the current live editing state into a tab's active phase
   * without changing focus. Used by save flows.
   */
  snapshotIntoTab: (tabId: string, live: LiveMapState) => void;

  /** Replace a tab's identity/hierarchy fields (after a metadata save). */
  patchTab: (tabId: string, patch: Partial<OpenFileTab>) => void;

  /** Mark a tab dirty/clean (called by the live stores on user edits). */
  markDirty: (tabId: string) => void;
  markClean: (tabId: string) => void;

  // ── Overlay / combine ───────────────────────────────────────────────────

  /**
   * Add a dormant tab to the overlay set. Throws if the active tab does
   * not outrank `tabId` (the rank check is the same one `canCommand` uses).
   */
  addOverlay: (tabId: string) => void;
  removeOverlay: (tabId: string) => void;
  clearOverlays: () => void;
  toggleOverlay: (tabId: string) => void;

  /**
   * Merge an overlay tab's drawn features into the active tab's current
   * phase. Each copied feature gets a fresh ID and a property bag tagging
   * it with the source tab's name/unit/rank so it remains visually
   * traceable after the merge.
   *
   * Returns the merged DrawnFeature[] for the caller to push into
   * `useDrawnStore.setAll` (this store does not touch live state directly).
   */
  mergeOverlayIntoActivePhase: (overlayTabId: string) => DrawnFeature[] | null;

  // ── Bulk reset (e.g. on logout / panic clear) ───────────────────────────
  closeAll: () => void;
}

/**
 * Heuristic: should `a` be allowed to command (overlay / merge / inspect)
 * `b`? Returns true when rank or ancestry grants authority.
 */
function authorityGrants(
  tabs: OpenFileTab[],
  commander: OpenFileTab,
  subordinate: OpenFileTab,
): boolean {
  if (commander.id === subordinate.id) return false;
  if (commander.rank > subordinate.rank) return true;

  // Ancestry check: walk subordinate.parentFileId up the chain. If we hit
  // commander.id, authority is granted regardless of rank.
  const byId = new Map(tabs.map((t) => [t.id, t]));
  let cursor: string | null = subordinate.parentFileId;
  const seen = new Set<string>([subordinate.id]);
  let depth = 0;
  while (cursor && depth < 32) {
    if (cursor === commander.id) return true;
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const next = byId.get(cursor);
    if (!next) break;
    cursor = next.parentFileId;
    depth += 1;
  }
  return false;
}

/** Compute a Phase from a snapshot of the live editing stores. */
function buildPhaseFromLive(base: Phase, live: LiveMapState): Phase {
  return {
    ...base,
    bbox:                 live.bbox,
    center:               live.center,
    zoom:                 live.zoom,
    timeline_selected_ms: live.timelineSelectedMs,
    active_layers:        live.activeLayers,
    drawn_features:       { type: 'FeatureCollection', features: live.drawnFeatures },
    layer_snapshots:      live.layerSnapshots,
  };
}

/** Convert a FsFileContent into the internal tab representation. */
function tabFromContent(content: FsFileContent): OpenFileTab {
  // Reconstruct phases — legacy single-state files get wrapped as Phase 1.
  let phases: Phase[] = content.phases ?? [];
  if (phases.length === 0) {
    phases = [{
      id: 1,
      name: 'Phase 1',
      color: '#3b82f6',
      notes: content.notes ?? '',
      bbox: content.bbox ?? null,
      center: content.center ?? null,
      zoom: content.zoom ?? null,
      timeline_selected_ms: content.timeline_selected_ms ?? null,
      active_layers: content.active_layers ?? [],
      drawn_features: content.drawn_features ?? { type: 'FeatureCollection', features: [] },
      layer_snapshots: content.layer_snapshots ?? {},
      conditions: content.conditions ?? {},
    }];
  }
  const activePhaseId = content.current_phase ?? phases[0]?.id ?? 1;
  return {
    id: content.id,
    name: content.name,
    folderId: content.folder_id,
    rank: (content.rank ?? RANK_DEFAULT) as Rank,
    unit: content.unit ?? '',
    commanderName: content.commander_name ?? '',
    parentFileId: content.parent_file_id ?? null,
    phases,
    activePhaseId,
    isDirty: false,
    openedAt: Date.now(),
  };
}

/** Snapshot live state into a tab's active phase (immutable update). */
function captureLiveIntoTab(tab: OpenFileTab, live: LiveMapState): OpenFileTab {
  const phases = tab.phases.map((p) =>
    p.id === tab.activePhaseId ? buildPhaseFromLive(p, live) : p,
  );
  return { ...tab, phases, isDirty: true };
}

export const useOpenFilesStore = create<OpenFilesState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  overlayTabIds: [],

  // ── Selectors ──────────────────────────────────────────────────────────
  getActiveTab: () => {
    const { tabs, activeTabId } = get();
    if (!activeTabId) return null;
    return tabs.find((t) => t.id === activeTabId) ?? null;
  },
  getTab: (id) => get().tabs.find((t) => t.id === id) ?? null,
  getOverlayTabs: () => {
    const { tabs, overlayTabIds } = get();
    const idSet = new Set(overlayTabIds);
    return tabs.filter((t) => idSet.has(t.id));
  },

  canCommand: (commanderId, subordinateId) => {
    if (commanderId === subordinateId) return false;
    const { tabs } = get();
    const commander = tabs.find((t) => t.id === commanderId);
    const subordinate = tabs.find((t) => t.id === subordinateId);
    if (!commander || !subordinate) return false;
    return authorityGrants(tabs, commander, subordinate);
  },

  rankRelation: (aId, bId) => {
    if (aId === bId) return 'self';
    const { tabs } = get();
    const a = tabs.find((t) => t.id === aId);
    const b = tabs.find((t) => t.id === bId);
    if (!a || !b) return 'unrelated';
    if (authorityGrants(tabs, a, b)) return 'commands';
    if (authorityGrants(tabs, b, a)) return 'commandedBy';
    if (a.rank === b.rank) return 'peer';
    return 'unrelated';
  },

  // ── Tab lifecycle ──────────────────────────────────────────────────────
  openTab: (content, liveStateForCurrentActive) => {
    const { tabs, activeTabId } = get();

    // Already open? Just focus it.
    const existing = tabs.find((t) => t.id === content.id);
    if (existing) {
      // Capture outgoing tab state first
      const updatedTabs =
        activeTabId && activeTabId !== existing.id && liveStateForCurrentActive
          ? tabs.map((t) =>
              t.id === activeTabId ? captureLiveIntoTab(t, liveStateForCurrentActive) : t,
            )
          : tabs;
      set({
        tabs: updatedTabs,
        activeTabId: existing.id,
        // Drop overlays — they no longer make sense under a new commander
        overlayTabIds: get().overlayTabIds.filter((id) => id !== existing.id),
      });
      return existing;
    }

    const newTab = tabFromContent(content);

    // Capture outgoing tab into the array, then append the new one
    const baseTabs =
      activeTabId && liveStateForCurrentActive
        ? tabs.map((t) =>
            t.id === activeTabId ? captureLiveIntoTab(t, liveStateForCurrentActive) : t,
          )
        : tabs;

    set({
      tabs: [...baseTabs, newTab],
      activeTabId: newTab.id,
      // New active tab → reset overlays (rank constraints may differ)
      overlayTabIds: [],
    });
    return newTab;
  },

  closeTab: (id, liveStateForClosedTab) => {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return activeTabId;

    let updated = [...tabs];

    // If we're closing the active tab and have live state, capture it first
    // (no-op for save purposes — the tab is being discarded — but lets callers
    //  reuse this path before persisting).
    if (id === activeTabId && liveStateForClosedTab) {
      updated[idx] = captureLiveIntoTab(updated[idx], liveStateForClosedTab);
    }

    updated.splice(idx, 1);

    let nextActiveId: string | null = activeTabId;
    if (id === activeTabId) {
      // Prefer the tab that was to the LEFT of the closed one;
      // fall back to the first tab; null if none remain.
      nextActiveId = updated[Math.max(0, idx - 1)]?.id ?? updated[0]?.id ?? null;
    }

    set({
      tabs: updated,
      activeTabId: nextActiveId,
      overlayTabIds: get().overlayTabIds.filter((oid) =>
        updated.some((t) => t.id === oid) && oid !== nextActiveId,
      ),
    });
    return nextActiveId;
  },

  setActiveTab: (id, liveStateForCurrentActive) => {
    const { tabs, activeTabId } = get();
    if (id === activeTabId) return get().getActiveTab();
    const incoming = tabs.find((t) => t.id === id);
    if (!incoming) return null;

    const updatedTabs =
      activeTabId && liveStateForCurrentActive
        ? tabs.map((t) =>
            t.id === activeTabId ? captureLiveIntoTab(t, liveStateForCurrentActive) : t,
          )
        : tabs;

    set({
      tabs: updatedTabs,
      activeTabId: id,
      // Clear overlays — the new active tab may not outrank them
      overlayTabIds: [],
    });
    return incoming;
  },

  setTabPhase: (tabId, phaseId, liveStateForCurrentPhase) => {
    const { tabs } = get();
    const tabIdx = tabs.findIndex((t) => t.id === tabId);
    if (tabIdx === -1) return null;
    const tab = tabs[tabIdx];

    // Capture outgoing phase state if requested
    const phases = liveStateForCurrentPhase
      ? tab.phases.map((p) =>
          p.id === tab.activePhaseId ? buildPhaseFromLive(p, liveStateForCurrentPhase) : p,
        )
      : tab.phases;

    const newPhase = phases.find((p) => p.id === phaseId);
    if (!newPhase) return null;

    const updated: OpenFileTab = {
      ...tab,
      phases,
      activePhaseId: phaseId,
      isDirty: liveStateForCurrentPhase ? true : tab.isDirty,
    };
    const nextTabs = [...tabs];
    nextTabs[tabIdx] = updated;
    set({ tabs: nextTabs });
    return newPhase;
  },

  snapshotIntoTab: (tabId, live) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? captureLiveIntoTab(t, live) : t)),
    }));
  },

  patchTab: (tabId, patch) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)),
    }));
  },

  markDirty: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, isDirty: true } : t)),
    }));
  },
  markClean: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, isDirty: false } : t)),
    }));
  },

  // ── Overlay ─────────────────────────────────────────────────────────────
  addOverlay: (tabId) => {
    const { activeTabId, overlayTabIds, tabs } = get();
    if (!activeTabId || tabId === activeTabId) return;
    if (overlayTabIds.includes(tabId)) return;
    const commander = tabs.find((t) => t.id === activeTabId);
    const subordinate = tabs.find((t) => t.id === tabId);
    if (!commander || !subordinate) return;
    if (!authorityGrants(tabs, commander, subordinate)) {
      // Silent no-op rather than throw — the UI should disable the action.
      return;
    }
    set({ overlayTabIds: [...overlayTabIds, tabId] });
  },

  removeOverlay: (tabId) => {
    set((s) => ({ overlayTabIds: s.overlayTabIds.filter((id) => id !== tabId) }));
  },

  clearOverlays: () => set({ overlayTabIds: [] }),

  toggleOverlay: (tabId) => {
    const { overlayTabIds } = get();
    if (overlayTabIds.includes(tabId)) get().removeOverlay(tabId);
    else get().addOverlay(tabId);
  },

  mergeOverlayIntoActivePhase: (overlayTabId) => {
    const { tabs, activeTabId } = get();
    if (!activeTabId) return null;
    const commander = tabs.find((t) => t.id === activeTabId);
    const subordinate = tabs.find((t) => t.id === overlayTabId);
    if (!commander || !subordinate) return null;
    if (!authorityGrants(tabs, commander, subordinate)) return null;

    // Pull subordinate's current phase drawn features
    const subPhase = subordinate.phases.find((p) => p.id === subordinate.activePhaseId);
    const subFeatures = (subPhase?.drawn_features?.features ?? []) as DrawnFeature[];
    if (subFeatures.length === 0) return [];

    // Tag each merged feature with provenance so the UI can colour them
    // differently and so a future un-merge could surgically pull them back.
    const tagged: DrawnFeature[] = subFeatures.map((f) => ({
      ...f,
      id: `${f.id ?? 'feat'}__from-${subordinate.id.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`,
      properties: {
        ...(f.properties ?? {}),
        _source_tab_id:    subordinate.id,
        _source_unit:      subordinate.unit || subordinate.name,
        _source_rank:      subordinate.rank,
        _source_commander: subordinate.commanderName || null,
        _merged_at:        new Date().toISOString(),
      },
    }));

    // Append into the commander's active phase + flag dirty
    const commanderPhase = commander.phases.find((p) => p.id === commander.activePhaseId);
    const existing = (commanderPhase?.drawn_features?.features ?? []) as DrawnFeature[];
    const merged = [...existing, ...tagged];

    set({
      tabs: tabs.map((t) => {
        if (t.id !== commander.id) return t;
        return {
          ...t,
          isDirty: true,
          phases: t.phases.map((p) =>
            p.id === t.activePhaseId
              ? {
                  ...p,
                  drawn_features: { type: 'FeatureCollection', features: merged },
                }
              : p,
          ),
        };
      }),
    });
    return merged;
  },

  // ── Bulk reset ──────────────────────────────────────────────────────────
  closeAll: () => set({ tabs: [], activeTabId: null, overlayTabIds: [] }),
}));

/**
 * Lightweight selector: returns the drawn features that should be drawn as
 * read-only overlays on the active map. Each entry includes provenance
 * metadata so the UI can render them in their unit's accent colour.
 *
 * Use this from a map layer component to render dimmed overlays alongside
 * the live `useDrawnStore` features.
 */
export interface OverlayDrawnLayer {
  tabId: string;
  tabName: string;
  unit: string;
  rank: Rank;
  commanderName: string;
  features: DrawnFeature[];
}

export function selectOverlayDrawnLayers(state: OpenFilesState): OverlayDrawnLayer[] {
  const out: OverlayDrawnLayer[] = [];
  for (const id of state.overlayTabIds) {
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab) continue;
    const phase = tab.phases.find((p) => p.id === tab.activePhaseId);
    const features = (phase?.drawn_features?.features ?? []) as DrawnFeature[];
    out.push({
      tabId: tab.id,
      tabName: tab.name,
      unit: tab.unit,
      rank: tab.rank,
      commanderName: tab.commanderName,
      features,
    });
  }
  return out;
}

/**
 * Build a fresh LiveMapState snapshot from the existing live stores.
 *
 * Centralised here so every tab-switch / save call site captures the same
 * fields without duplicating glue code. Pass the result into openTab /
 * setActiveTab / setTabPhase as the `liveStateForCurrentActive` argument.
 */
export function captureLiveMapState(map: LeafletMap | null): LiveMapState {
  const drawnFeatures = useDrawnStore.getState().features;
  const activeMap     = useLayerStore.getState().active;
  const allLayerKeys  = Object.keys(activeMap) as LayerKey[];
  const activeLayers  = allLayerKeys.filter((k) => activeMap[k]);

  const featureCache  = useFeatureCacheStore.getState().features;
  const layerSnapshots: Record<string, FeatureCollection> = {};
  for (const [k, feats] of Object.entries(featureCache)) {
    if (feats && feats.length > 0) {
      layerSnapshots[k] = { type: 'FeatureCollection', features: feats };
    }
  }

  const bboxStr  = useBboxStore.getState().bbox;
  const bbox     = bboxStr ? parseBbox(bboxStr) : null;

  let center: [number, number] | null = null;
  let zoom: number | null = null;
  if (map) {
    const c = map.getCenter();
    center = [c.lat, c.lng];
    zoom = map.getZoom();
  }

  return {
    drawnFeatures,
    activeLayers,
    layerSnapshots,
    bbox,
    center,
    zoom,
    timelineSelectedMs: useTimelineStore.getState().selectedMs,
  };
}
