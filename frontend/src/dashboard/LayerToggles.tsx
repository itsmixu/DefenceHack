import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBboxStore, useFeatureCacheStore, useLayerStore } from '../store';
import type { LayerKey, LayerStatus } from '../api/types';
import { useOsmPoiFilterStore } from '../store';
import { OSM_POI_CATEGORIES } from '../map/osmPoi';
import { MIN_ZOOM_BY_LAYER, isLayerSuppressedByZoom } from '../map/layerLoadLimits';
import LayerSlots from '../map/LayerSlots';
import SourceStatusList from './SourceStatusList';

interface LayerEntry {
  id: LayerKey;
  label: string;
  hint?: string;
}

const LAYERS: LayerEntry[] = [
  { id: 'osm', label: 'OSM POIs', hint: 'hospitals, fuel, power' },
  { id: 'digiroad', label: 'Digiroad', hint: 'roads & bridges' },
  { id: 'mml', label: 'MML terrain', hint: 'land cover polygons' },
  { id: 'mml_contours', label: 'MML contours', hint: 'elevation lines' },
  { id: 'statfin', label: 'Population', hint: 'Paavo choropleth' },
  { id: 'fmi', label: 'Weather', hint: 'FMI stations (observations)' },
  { id: 'fmi_forecast', label: 'Forecast', hint: 'FMI HARMONIE 48 h NWP' },
  { id: 'syke', label: 'SYKE', hint: 'flood zones & Natura 2000' },
  { id: 'opencellid', label: 'Cell towers', hint: 'OpenCelliD' },
  { id: 'starlink', label: 'Starlink', hint: 'LEO constellation (live)' },
  { id: 'astronomy', label: 'Astronomy', hint: 'sun / moon / twilight' },
  { id: 'exposure', label: 'Exposure', hint: 'danger zones' },
  { id: 'mcoo', label: 'MCOO', hint: 'go / slow-go / no-go' },
];

const dotForStatus = (s?: LayerStatus) => {
  if (!s || s === 'unknown') return 'bg-white/35';
  if (s === 'ok') return 'bg-emerald-300';
  if (s === 'unavailable' || s === 'partial' || s === 'degraded') return 'bg-amber-300';
  return 'bg-red-300';
};

export default function LayerToggles() {
  const active = useLayerStore((s) => s.active);
  const status = useLayerStore((s) => s.status);
  const loading = useLayerStore((s) => s.loading);
  const toggle = useLayerStore((s) => s.toggle);
  const zoom = useBboxStore((s) => s.zoom);
  const osmEnabled = useOsmPoiFilterStore((s) => s.enabled);
  const toggleOsm = useOsmPoiFilterStore((s) => s.toggle);
  const setAllOsm = useOsmPoiFilterStore((s) => s.setAll);
  const clearAllOsm = useOsmPoiFilterStore((s) => s.clearAll);
  const clearAllFeatures = useFeatureCacheStore((s) => s.clearAll);
  const queryClient = useQueryClient();

  const handleForceReload = () => {
    clearAllFeatures();
    queryClient.invalidateQueries({ queryKey: ['layer'] });
  };

  return (
    <div>
      <div className="mb-3">
        <LayerSlots />
      </div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
          Toggle layers. Each layer fetches when the map viewport changes.
        </p>
        <button
          type="button"
          onClick={handleForceReload}
          className="shrink-0 rounded border border-white/20 bg-white/[0.06] p-1 text-white/85 hover:bg-white/[0.14] hover:text-white"
          title="Discard cached features and refetch every active layer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="space-y-1">
        {LAYERS.map((l) => {
          const isOsm = l.id === 'osm';
          const minZoom = MIN_ZOOM_BY_LAYER[l.id];
          const suppressed = !!active[l.id] && isLayerSuppressedByZoom(l.id, zoom);
          return (
            <li key={l.id} className="rounded border border-white/10 bg-black/30 px-2 py-1.5 hover:bg-white/[0.04]">
              <div className="flex items-center justify-between">
                <label className="flex flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!active[l.id]}
                    onChange={() => toggle(l.id)}
                  />
                  <span className="flex flex-col leading-tight">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">{l.label}</span>
                    {l.hint && <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-white/45">{l.hint}</span>}
                  </span>
                </label>
                {suppressed ? (
                  <span
                    className="rounded border border-amber-300/50 bg-amber-300/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-amber-200"
                    title={`Zoom ≥ ${minZoom} to load this layer (current ${zoom ?? '?'})`}
                  >
                    zoom ≥ {minZoom}
                  </span>
                ) : active[l.id] && loading[l.id] ? (
                  <span
                    className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"
                    title="loading…"
                  />
                ) : (
                  <span
                    className={`h-2 w-2 rounded-full ${dotForStatus(status[l.id])}`}
                    title={status[l.id] ?? 'not loaded'}
                  />
                )}
              </div>

              {isOsm && active.osm && (
                <div className="mt-2 rounded border border-white/15 bg-black/45 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/65">
                      POI filters
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={setAllOsm}
                        className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/80 hover:bg-white/[0.12]"
                      >
                        all
                      </button>
                      <button
                        type="button"
                        onClick={clearAllOsm}
                        className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/80 hover:bg-white/[0.12]"
                      >
                        none
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                    {OSM_POI_CATEGORIES.map((c) => (
                      <label key={c.id} className="flex items-center gap-1 text-[11px] text-white/85">
                        <input
                          type="checkbox"
                          checked={osmEnabled.includes(c.id)}
                          onChange={() => toggleOsm(c.id)}
                        />
                        <span>{c.icon}</span>
                        <span className="truncate">{c.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-white/10 pt-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">Source Status</h3>
        <SourceStatusList />
      </div>
    </div>
  );
}
