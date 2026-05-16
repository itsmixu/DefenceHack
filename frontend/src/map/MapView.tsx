import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import BboxTracker from './BboxTracker';
import SourceLayer from './SourceLayer';
import DrawControl from '../drawing/DrawControl';
import LayerSlots from './LayerSlots';
import ZoneControls from './ZoneControls';
import { basemaps } from './basemaps';
import {
  useBackendStatusStore,
  useFeatureCacheStore,
  useLayerStore,
  useMapStore,
  useTimelineStore,
} from '../store';
import type { LayerKey } from '../api/types';

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
  'opencellid', 'n2yo', 'exposure', 'mcoo',
];

export default function MapView() {
  const [basemapPanelOpen, setBasemapPanelOpen] = useState(true);
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

  const clearAllFeatures = useFeatureCacheStore((s) => s.clearAll);
  const clearFeature = useFeatureCacheStore((s) => s.clear);
  const rangeStartMs = useTimelineStore((s) => s.rangeStartMs);
  const rangeEndMs = useTimelineStore((s) => s.rangeEndMs);
  const stepMinutes = useTimelineStore((s) => s.stepMinutes);
  const selectedMs = useTimelineStore((s) => s.selectedMs);
  const setSelectedMs = useTimelineStore((s) => s.setSelectedMs);
  const queryClient = useQueryClient();
  const [timelineStartMs, setTimelineStartMs] = useState(rangeStartMs);

  const stepMs = stepMinutes * 60 * 1000;
  const timelineSpanMs = rangeEndMs - rangeStartMs;
  const maxStartMs = Math.max(rangeStartMs, rangeEndMs - stepMs);
  const visibleStartMs = Math.min(maxStartMs, Math.max(rangeStartMs, timelineStartMs));
  const visibleEndMs = Math.min(rangeEndMs, visibleStartMs + timelineSpanMs);
  const sliderSteps = Math.max(1, Math.round((visibleEndMs - visibleStartMs) / stepMs));
  const sliderValue = Math.min(sliderSteps, Math.max(0, Math.round((selectedMs - visibleStartMs) / stepMs)));
  const selectedIso = useMemo(() => new Date(selectedMs).toISOString(), [selectedMs]);
  const selectedLocal = useMemo(
    () => new Date(selectedMs).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }),
    [selectedMs],
  );
  const timelineStartInput = useMemo(() => toDatetimeLocalValue(visibleStartMs), [visibleStartMs]);
  const selectedInput = useMemo(() => toDatetimeLocalValue(selectedMs), [selectedMs]);
  const sectionTimes = useMemo(() => {
    const sections = 6;
    return Array.from({ length: sections + 1 }, (_, i) => {
      const ratio = i / sections;
      const ms = Math.round(visibleStartMs + (visibleEndMs - visibleStartMs) * ratio);
      return Math.round(ms / stepMs) * stepMs;
    });
  }, [visibleStartMs, visibleEndMs, stepMs]);

  useEffect(() => {
    setTimelineStartMs(rangeStartMs);
  }, [rangeStartMs]);

  // When the timeline scrubs, only clear and re-fetch time-aware layers (fmi, osm).
  // Static layers (mml, digiroad, opencellid, etc.) retain their cache so they
  // don't make unnecessary network requests on every slider move.
  useEffect(() => {
    (['fmi', 'osm'] as const).forEach((l) => {
      clearFeature(l);
      queryClient.invalidateQueries({ queryKey: ['layer', l] });
    });
  }, [selectedMs, clearFeature, queryClient]);

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

  const handleForceReload = () => {
    clearAllFeatures();
    queryClient.invalidateQueries({ queryKey: ['layer'] });
  };

  return (
    <div className="relative h-full w-full">
      <MapContainer center={[64, 25]} zoom={5} className="h-full w-full">
        {activeBasemapList.map((b) => (
          <TileLayer
            key={b.id}
            url={b.url}
            attribution={b.attribution}
            maxZoom={b.maxZoom}
            opacity={basemapOpacity[b.id] ?? 1}
            eventHandlers={{
              loading: () => setBasemapLayerLoading(b.id, true),
              load: () => setBasemapLayerLoading(b.id, false),
              tileerror: () => setBasemapLayerLoading(b.id, false),
            }}
          />
        ))}
        <MapHandle />
        <BboxTracker />
        <DrawControl />
        {ALL_LAYERS.map((id) => (active[id] ? <SourceLayer key={id} layer={id} /> : null))}
      </MapContainer>

      <LayerSlots />
      <ZoneControls />

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

      {backendUnavailable && (
        <div className="pointer-events-none absolute left-1/2 top-36 z-[1000] -translate-x-1/2 rounded border border-red-300/40 bg-black/85 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-red-200 shadow-[0_10px_26px_rgba(0,0,0,0.6)] backdrop-blur-sm">
          Backend offline — start backend on port 8000.
          {backendReason ? ` ${backendReason}` : ''}
        </div>
      )}

      <div className="pointer-events-auto absolute right-3 top-24 z-[1000] flex flex-col gap-2 rounded border border-white/15 bg-black/95 p-2 text-xs text-white/85 shadow-[0_10px_32px_rgba(0,0,0,0.5)]">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setBasemapPanelOpen((s) => !s)}
            className="flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/70 hover:text-white"
            title={basemapPanelOpen ? 'Collapse basemap stack' : 'Expand basemap stack'}
          >
            Basemap Stack
            {basemapPanelOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleForceReload}
            className="rounded border border-white/20 bg-white/[0.06] p-1 text-white/85 hover:bg-white/[0.14] hover:text-white"
            title="Discard cached features and refetch every active layer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

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

      <div className="pointer-events-auto absolute inset-x-0 top-0 z-[1000] border-b border-white/15 bg-[#0b0b0b] px-2 py-1 text-white shadow-[0_4px_14px_rgba(0,0,0,0.5)]">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/60">Timeline</span>
            <div className="flex flex-wrap items-center gap-1.5 text-[9px] uppercase tracking-[0.04em] text-white/75">
              <label className="flex items-center gap-1">
                <span className="font-mono">Start</span>
                <input
                  type="datetime-local"
                  value={timelineStartInput}
                  onChange={(e) => {
                    const ms = new Date(e.target.value).getTime();
                    if (Number.isFinite(ms)) setTimelineStartMs(ms);
                  }}
                  className="rounded border border-white/20 bg-black px-1 py-0.5 text-[10px] text-white"
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="font-mono">Selected</span>
                <input
                  type="datetime-local"
                  value={selectedInput}
                  onChange={(e) => {
                    const ms = new Date(e.target.value).getTime();
                    if (Number.isFinite(ms)) setSelectedMs(ms);
                  }}
                  className="rounded border border-white/20 bg-black px-1 py-0.5 text-[10px] text-white"
                />
              </label>
              <span className="font-mono text-white/50">step {stepMinutes}m</span>
            </div>
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
            className="h-1 w-full accent-white"
            aria-label="Operational timeline"
          />

          <div className="grid grid-cols-7 gap-0.5">
            {sectionTimes.map((ms, idx) => (
              <button
                key={`${ms}-${idx}`}
                type="button"
                onClick={() => setSelectedMs(ms)}
                className="rounded border border-white/15 bg-[#161616] px-1 py-0.5 text-center font-mono text-[9px] uppercase tracking-[0.02em] text-white/75 hover:bg-white/[0.12]"
                title={new Date(ms).toISOString()}
              >
                {new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
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
