import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp } from 'lucide-react';
import BboxTracker from './BboxTracker';
import SourceLayer from './SourceLayer';
import DrawControl from '../drawing/DrawControl';
import ArrowControl from '../drawing/ArrowControl';
import RulerControl from '../drawing/RulerControl';
import SymbolControl from '../drawing/SymbolControl';
import OverlayLayer from './OverlayLayer';
import ZoneControls from './ZoneControls';
import MapToolbar from './MapToolbar';
import { basemaps } from './basemaps';
import { getDemoManifest, isDemoMode } from '../demo/demoMode';
import {
  useBackendStatusStore,
  useBboxStore,
  useFeatureCacheStore,
  useLayerStore,
  useMapStore,
  useTimelineStore,
} from '../store';
import type { LayerKey } from '../api/types';
import { TIME_AWARE_LAYERS } from './timeAware';


// Registers the underlying Leaflet map instance into a Zustand store so other
// components (zone controls, etc.) can call flyTo without prop drilling.
function MapHandle() {
  const map = useMap();
  const setMap = useMapStore((s) => s.setMap);
  useEffect(() => {
    setMap(map);
    return () => setMap(null);
  }, [map, setMap]);
  return null;
}

const ALL_LAYERS: LayerKey[] = [
  'osm', 'digiroad', 'mml', 'mml_contours', 'statfin',
  'syke', 'fmi', 'fmi_forecast', 'astronomy',
  'opencellid', 'starlink', 'exposure', 'mcoo',
];

export default function MapView() {
  const [basemapPanelOpen, setBasemapPanelOpen] = useState(false);
  const [enabledBasemaps, setEnabledBasemaps] = useState<Record<string, boolean>>({
    osm: true,
    mml: false,
    'mml-shade': false,
  });
  const [basemapOpacity, setBasemapOpacity] = useState<Record<string, number>>({
    osm: 1,
    mml: 0.75,
    'mml-shade': 0.6,
  });
  const [loadingBasemapIds, setLoadingBasemapIds] = useState<string[]>([]);
  const active = useLayerStore((s) => s.active);
  const loading = useLayerStore((s) => s.loading);
  const backendUnavailable = useBackendStatusStore((s) => s.unavailable);
  const backendReason = useBackendStatusStore((s) => s.reason);

  const clearFeature = useFeatureCacheStore((s) => s.clear);
  const rangeStartMs = useTimelineStore((s) => s.rangeStartMs);
  const rangeEndMs = useTimelineStore((s) => s.rangeEndMs);
  const stepMinutes = useTimelineStore((s) => s.stepMinutes);
  const selectedMs = useTimelineStore((s) => s.selectedMs);
  const committedMs = useTimelineStore((s) => s.committedMs);
  const setSelectedMs = useTimelineStore((s) => s.setSelectedMs);
  const commitSelected = useTimelineStore((s) => s.commitSelected);
  const commitSelectedMs = useTimelineStore((s) => s.commitSelectedMs);
  const queryClient = useQueryClient();
  const [timelineStartMs, setTimelineStartMs] = useState(rangeStartMs);

  const stepMs = stepMinutes * 60 * 1000;
  // "Now" tick — bumped once a minute so the slider's right edge keeps up
  // with wall-clock without thrashing renders. Snap to a step boundary so
  // the slider step alignment stays clean.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowMs = Math.round(nowTick / stepMs) * stepMs;

  const maxStartMs = Math.max(rangeStartMs, nowMs - stepMs);
  const visibleStartMs = Math.min(maxStartMs, Math.max(rangeStartMs, timelineStartMs));
  const sliderSteps = Math.max(1, Math.round((nowMs - visibleStartMs) / stepMs));
  const sliderValue = Math.min(sliderSteps, Math.max(0, Math.round((selectedMs - visibleStartMs) / stepMs)));
  // Basemap URLs key off the committed time so dragging the slider doesn't
  // thrash tile fetches; the displayed label tracks the live thumb position.
  const committedIso = useMemo(() => new Date(committedMs).toISOString(), [committedMs]);
  const timelineStartInput = useMemo(() => toDatetimeLocalValue(visibleStartMs), [visibleStartMs]);
  const selectedLabel = useMemo(() => {
    const d = new Date(selectedMs);
    return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }, [selectedMs]);
  // Evenly-spaced tick marks along the slider track for visual scale.
  const tickTimes = useMemo(() => {
    const sections = 8;
    const span = nowMs - visibleStartMs;
    return Array.from({ length: sections + 1 }, (_, i) => {
      const ratio = i / sections;
      return Math.round(visibleStartMs + span * ratio);
    });
  }, [visibleStartMs, nowMs]);

  useEffect(() => {
    setTimelineStartMs(rangeStartMs);
  }, [rangeStartMs]);

  // When the committed time changes (slider release / input commit), drop the
  // per-layer feature cache and invalidate react-query keys for every genuinely
  // time-aware layer. Static layers (mml, digiroad, opencellid, etc.) are not
  // in TIME_AWARE_LAYERS, so their caches survive timeline scrubbing.
  useEffect(() => {
    TIME_AWARE_LAYERS.forEach((l) => {
      clearFeature(l);
      queryClient.invalidateQueries({ queryKey: ['layer', l] });
    });
  }, [committedMs, clearFeature, queryClient]);

  const loadingLayers = useMemo(
    () => ALL_LAYERS.filter((id) => active[id] && loading[id]),
    [active, loading],
  );

  const activeBasemapList = useMemo(
    () => basemaps.filter((b) => enabledBasemaps[b.id]),
    [enabledBasemaps],
  );

  const loadingBasemapLabels = useMemo(
    () => basemaps.filter((b) => loadingBasemapIds.includes(b.id)).map((b) => b.label),
    [loadingBasemapIds],
  );

  // ── No-data warning ─────────────────────────────────────────────────────────
  // For each enabled, time-aware basemap, check whether the committed timeline
  // moment is outside its data window (older than minDate, or fresher than
  // lagHours behind now). Show a top-center banner naming the offending layers.
  const basemapsWithoutData = useMemo(() => {
    const offending: string[] = [];
    for (const b of activeBasemapList) {
      if (!b.timeAware) continue;
      const earliest = b.minDate ? Date.parse(b.minDate) : -Infinity;
      const latest   = b.maxDate ? Date.parse(b.maxDate)
                    : b.lagHours != null ? Date.now() - b.lagHours * 3_600_000
                    : Infinity;
      if (committedMs < earliest || committedMs > latest) offending.push(b.label);
    }
    return offending;
  }, [activeBasemapList, committedMs]);

  // Zoom-out-of-range: e.g. NASA cloud cover only renders up to z6, NASA
  // true-colour up to z9. Past that the basemap simply stops drawing.
  const currentZoom = useBboxStore((s) => s.zoom);
  const basemapsZoomedTooFar = useMemo(() => {
    if (currentZoom == null) return [] as { label: string; maxZoom: number }[];
    return activeBasemapList
      .filter((b) => b.maxZoom != null && currentZoom > b.maxZoom)
      .map((b) => ({ label: b.label, maxZoom: b.maxZoom! }));
  }, [activeBasemapList, currentZoom]);

  const toggleBasemap = (id: string) => {
    setEnabledBasemaps((prev) => {
      const currentlyEnabled = !!prev[id];
      const enabledCount = Object.values(prev).filter(Boolean).length;
      if (currentlyEnabled && enabledCount === 1) return prev;
      return { ...prev, [id]: !currentlyEnabled };
    });
  };

  const setBasemapLayerLoading = (id: string, isLoading: boolean) => {
    setLoadingBasemapIds((prev) => {
      if (isLoading) {
        if (prev.includes(id)) return prev;
        return [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  };

  // In demo mode the map opens at the captured AO and panning is clamped
  // tight around it so the user can't wander into bbox cells with no data.
  const demoManifest = isDemoMode() ? getDemoManifest() : null;
  const initialCenter: [number, number] = demoManifest?.center ?? [64, 25];
  const initialZoom = demoManifest?.zoom ?? 5;
  const maxBounds: [[number, number], [number, number]] = demoManifest
    ? [
        [demoManifest.bbox[1] - 0.3, demoManifest.bbox[0] - 0.6],
        [demoManifest.bbox[3] + 0.3, demoManifest.bbox[2] + 0.6],
      ]
    : [
        [58.5, 17.0],
        [71.5, 34.0],
      ];

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        minZoom={4}
        zoomControl={false}
        // Hard-clamp panning. In normal mode this is all of Finland; in demo
        // mode it's a small ring around the captured AO so all data is in view.
        maxBounds={maxBounds}
        maxBoundsViscosity={1.0}
        worldCopyJump={false}
        className="h-full w-full"
      >
        {activeBasemapList.map((b) => {
          // Two time-aware URL conventions:
          //   - {date} in path → substitute with YYYY-MM-DD (NASA GIBS pattern)
          //   - otherwise append ?t=ISO query (FMI WMS pattern)
          let url = b.url;
          let timeKey: string | null = null;
          if (b.timeAware) {
            if (url.includes('{date}')) {
              const date = committedIso.slice(0, 10);
              url = url.replace('{date}', date);
              timeKey = date;
            } else {
              url = `${url}?t=${encodeURIComponent(committedIso)}`;
              timeKey = committedIso;
            }
          }
          const key = timeKey ? `${b.id}:${timeKey}` : b.id;
          return (
            <TileLayer
              key={key}
              url={url}
              attribution={b.attribution}
              maxZoom={b.maxZoom}
              opacity={basemapOpacity[b.id] ?? 1}
              eventHandlers={{
                loading: () => setBasemapLayerLoading(b.id, true),
                load: () => setBasemapLayerLoading(b.id, false),
                tileerror: () => setBasemapLayerLoading(b.id, false),
              }}
            />
          );
        })}
        <MapHandle />
        <BboxTracker />
        <DrawControl />
        <ArrowControl />
        <RulerControl />
        <SymbolControl />
        <OverlayLayer />
        {ALL_LAYERS.map((id) => (active[id] ? <SourceLayer key={id} layer={id} /> : null))}
      </MapContainer>

      <ZoneControls />

      {/* ── Bottom drawing toolbar ── */}
      <MapToolbar />

      {(loadingBasemapLabels.length > 0 || loadingLayers.length > 0) && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-[1000] -translate-x-1/2 rounded border border-white/15 bg-black/70 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-white/90 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            {loadingBasemapLabels.length > 0 && (
              <span>
                Loading basemap
                {loadingBasemapLabels.length === 1 ? '' : 's'}: {loadingBasemapLabels.join(', ')}
              </span>
            )}
            {loadingBasemapLabels.length === 0 && loadingLayers.length > 0 && (
              <span>
                Loading {loadingLayers.length} layer
                {loadingLayers.length === 1 ? '' : 's'}: {loadingLayers.join(', ')}
              </span>
            )}
          </div>
        </div>
      )}


      {basemapsWithoutData.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-12 z-[1000] -translate-x-1/2 rounded-xl border border-amber-300/40 bg-black/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-200 shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur-sm">
          No map data for selected time · {basemapsWithoutData.join(', ')}
        </div>
      )}

      {basemapsZoomedTooFar.length > 0 && (
        <div
          className="pointer-events-none absolute left-1/2 z-[1000] -translate-x-1/2 rounded-xl border border-amber-300/40 bg-black/85 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-amber-200 shadow-[0_8px_24px_rgba(0,0,0,0.55)] backdrop-blur-sm"
          style={{ top: basemapsWithoutData.length > 0 ? 88 : 48 }}
        >
          Zoom out to view · {basemapsZoomedTooFar.map((b) => `${b.label} (max Z${b.maxZoom})`).join(', ')}
        </div>
      )}

      {backendUnavailable && (
        <div className="pointer-events-none absolute left-1/2 top-36 z-[1000] -translate-x-1/2 rounded border border-red-300/40 bg-black/85 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-red-200 shadow-[0_10px_26px_rgba(0,0,0,0.6)] backdrop-blur-sm">
          Backend offline — start backend on port 8000.
          {backendReason ? ` ${backendReason}` : ''}
        </div>
      )}

      <div className="pointer-events-auto absolute right-3 top-3 z-[1000] flex flex-col gap-2 rounded-xl border border-white/15 bg-black/95 p-2 text-xs text-white/85 shadow-[0_10px_32px_rgba(0,0,0,0.5)]">
        <button
          type="button"
          onClick={() => setBasemapPanelOpen((s) => !s)}
          className="flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70 hover:text-white"
          title={basemapPanelOpen ? 'Collapse basemap' : 'Expand basemap'}
        >
          Basemap
          {basemapPanelOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {basemapPanelOpen &&
          basemaps.map((b) => {
            const enabled = !!enabledBasemaps[b.id];
            return (
              <div key={b.id} className="rounded border border-white/10 bg-black/90 p-1.5">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleBasemap(b.id)}
                  />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">{b.label}</span>
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase text-white/55">opacity</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round((basemapOpacity[b.id] ?? 1) * 100)}
                    onChange={(e) => {
                      const value = Number(e.target.value) / 100;
                      setBasemapOpacity((prev) => ({ ...prev, [b.id]: value }));
                    }}
                    className="w-24 accent-white"
                  />
                  <span className="w-8 text-right font-mono text-[10px] text-white/65">
                    {Math.round((basemapOpacity[b.id] ?? 1) * 100)}%
                  </span>
                </div>
              </div>
            );
          })}
      </div>

      <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-[1000] rounded-xl border border-white/15 bg-[#0b0b0b]/95 px-3 py-2 text-white shadow-[0_10px_28px_rgba(0,0,0,0.55)] backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <label className="flex shrink-0 flex-col gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/55">Start</span>
            <input
              type="datetime-local"
              value={timelineStartInput}
              onChange={(e) => {
                const ms = new Date(e.target.value).getTime();
                if (Number.isFinite(ms)) setTimelineStartMs(ms);
              }}
              className="rounded border border-white/20 bg-black px-1.5 py-0.5 font-mono text-[11px] text-white"
            />
          </label>

          <div className="relative flex min-w-0 flex-1 flex-col">
            {/* Tick marks layered behind the slider track */}
            <div className="pointer-events-none relative mt-3 h-2 w-full">
              {tickTimes.map((ms, idx) => {
                const ratio = idx / (tickTimes.length - 1);
                return (
                  <span
                    key={`tick-${idx}`}
                    className="absolute top-0 h-2 w-px bg-white/35"
                    style={{ left: `${ratio * 100}%` }}
                  />
                );
              })}
            </div>

            <input
              type="range"
              min={0}
              max={sliderSteps}
              step={1}
              value={sliderValue}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setSelectedMs(visibleStartMs + idx * stepMs);
              }}
              onPointerUp={commitSelected}
              onMouseUp={commitSelected}
              onTouchEnd={commitSelected}
              onKeyUp={commitSelected}
              className="h-1 w-full accent-white"
              aria-label="Operational timeline"
            />

            {/* Tick labels under the track */}
            <div className="relative mt-1 h-3 w-full">
              {tickTimes.map((ms, idx) => {
                const ratio = idx / (tickTimes.length - 1);
                const label = formatTick(ms, nowMs);
                const align =
                  idx === 0 ? 'translate-x-0' :
                  idx === tickTimes.length - 1 ? '-translate-x-full' :
                  '-translate-x-1/2';
                return (
                  <span
                    key={`label-${idx}`}
                    className={`absolute top-0 font-mono text-[9px] uppercase tracking-[0.04em] text-white/55 ${align}`}
                    style={{ left: `${ratio * 100}%` }}
                    title={new Date(ms).toISOString()}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/55">Now</div>
            <button
              type="button"
              onClick={() => commitSelectedMs(nowMs)}
              className="rounded border border-white/20 bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-white/90 hover:bg-white/[0.14]"
              title="Snap selection to current time"
            >
              {selectedLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTick(ms: number, nowMs: number): string {
  // Closer to "now" → show clock time only; further out → include the date.
  const deltaH = Math.round((nowMs - ms) / (60 * 60 * 1000));
  if (deltaH <= 0) return 'now';
  const d = new Date(ms);
  if (deltaH < 24) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit' });
}

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}
