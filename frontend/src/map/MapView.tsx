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
  'osm',
  'digiroad',
  'mml',
  'mml_contours',
  'statfin',
  'fmi',
  'opencellid',
  'n2yo',
  'exposure',
  'mcoo',
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
  const queryClient = useQueryClient();

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
        <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded border border-white/15 bg-black/70 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-white/90 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur-sm">
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
        <div className="pointer-events-none absolute left-1/2 top-14 z-[1000] -translate-x-1/2 rounded border border-red-300/40 bg-black/85 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-red-200 shadow-[0_10px_26px_rgba(0,0,0,0.6)] backdrop-blur-sm">
          Backend offline — start backend on port 8000.
          {backendReason ? ` ${backendReason}` : ''}
        </div>
      )}

      <div className="pointer-events-auto absolute right-3 top-3 z-[1000] flex flex-col gap-2 rounded border border-white/15 bg-black/95 p-2 text-xs text-white/85 shadow-[0_10px_32px_rgba(0,0,0,0.5)]">
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
    </div>
  );
}
