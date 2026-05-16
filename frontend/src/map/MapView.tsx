import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { useQueryClient } from '@tanstack/react-query';
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
        <div className="pointer-events-none absolute left-1/2 top-3 z-[1000] -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs text-slate-700 shadow-md">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500" />
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
        <div className="pointer-events-none absolute left-1/2 top-14 z-[1000] -translate-x-1/2 rounded-md border border-red-300 bg-red-50/95 px-3 py-2 text-xs font-medium text-red-800 shadow-md">
          Backend offline — start backend on port 8000.
          {backendReason ? ` ${backendReason}` : ''}
        </div>
      )}

      <div className="pointer-events-auto absolute right-3 top-3 z-[1000] flex flex-col gap-2 rounded-md border border-slate-200 bg-white/95 p-2 text-xs shadow-md">
        <div className="font-semibold text-slate-700">Basemap</div>
        {basemaps.map((b) => {
          const enabled = !!enabledBasemaps[b.id];
          return (
            <div key={b.id} className="rounded border border-slate-200 p-1.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggleBasemap(b.id)}
                />
                <span>{b.label}</span>
              </label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[10px] text-slate-500">opacity</span>
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
                  className="w-24"
                />
                <span className="w-8 text-right text-[10px] text-slate-500">
                  {Math.round((basemapOpacity[b.id] ?? 1) * 100)}%
                </span>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={handleForceReload}
          className="mt-1 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
          title="Discard cached features and refetch every active layer"
        >
          Force reload
        </button>
      </div>
    </div>
  );
}
