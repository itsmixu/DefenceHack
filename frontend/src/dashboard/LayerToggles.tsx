import { RefreshCw, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useBboxStore, useFeatureCacheStore, useLayerStore, useToastStore } from '../store';
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
  { id: 'osm',          label: 'Points of interest', hint: 'hospitals, fuel, power' },
  { id: 'digiroad',     label: 'Roads & bridges',    hint: 'passability, width, load limits' },
  { id: 'mml',          label: 'Terrain types',      hint: 'forest, swamp, fields, water — go/no-go context' },
  { id: 'mml_contours', label: 'Elevation',          hint: 'contour lines — hills, ridges, dead ground' },
  { id: 'statfin',      label: 'Population',         hint: 'civilian density by area — billeting & support' },
  { id: 'fmi',          label: 'Live weather',       hint: 'current wind, temp & visibility at met stations' },
  { id: 'fmi_forecast', label: 'Weather forecast',   hint: '48-hour wind, rain & drone-fly conditions' },
  { id: 'syke',         label: 'Flood & nature',     hint: 'flood risk zones, protected areas (Natura 2000)' },
  { id: 'opencellid',   label: 'Cell towers',        hint: 'coverage radii — signals intelligence & comms' },
  { id: 'starlink',     label: 'Starlink passes',    hint: 'live satellite positions & coverage footprints' },
  { id: 'astronomy',    label: 'Light conditions',   hint: 'sunrise, sunset, moon phase — night ops window' },
  { id: 'exposure',     label: 'Cover & exposure',   hint: 'L1 = hard cover → L5 = fully exposed open ground' },
  { id: 'mcoo',         label: 'Vehicle mobility',   hint: 'go / slow-go / no-go for wheeled & tracked vehicles' },
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
  const pushToast = useToastStore((s) => s.push);

  const handleReload = () => {
    queryClient.invalidateQueries({ queryKey: ['layer'] });
  };

  const handleClearCache = () => {
    clearAllFeatures();
    queryClient.invalidateQueries({ queryKey: ['layer'] });
    pushToast('info', 'Map data cache cleared');
  };

  return (
    <div>
      <div className="mb-3">
        <LayerSlots />
      </div>
      <div className="mb-2 flex items-center justify-center gap-1.5">
        <button
          type="button"
          onClick={handleReload}
          className="flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/75 transition hover:border-white hover:bg-white hover:text-black"
          style={{ borderColor: '#393939', background: '#1a1a1a' }}
          title="Refetch every active layer (keeps the cache)"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
        <button
          type="button"
          onClick={handleClearCache}
          className="flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/75 transition hover:border-white hover:bg-white hover:text-black"
          style={{ borderColor: '#393939', background: '#1a1a1a' }}
          title="Discard cached layer features and refetch on next viewport change"
        >
          <Trash2 className="h-3 w-3" />
          Clear cache
        </button>
      </div>
      <ul className="space-y-1">
        {LAYERS.map((l) => {
          const isOsm = l.id === 'osm';
          const minZoom = MIN_ZOOM_BY_LAYER[l.id];
          const suppressed = !!active[l.id] && isLayerSuppressedByZoom(l.id, zoom);
          return (
            <li key={l.id} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 hover:bg-white/[0.04]">
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
                    className="rounded-lg border border-amber-300/50 bg-amber-300/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-amber-200"
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
                <div className="mt-2 rounded-lg border border-white/15 bg-black/45 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/65">
                      POI filters
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={setAllOsm}
                        className="rounded-lg border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/80 hover:bg-white/[0.12]"
                      >
                        all
                      </button>
                      <button
                        type="button"
                        onClick={clearAllOsm}
                        className="rounded-lg border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/80 hover:bg-white/[0.12]"
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
                        <span dangerouslySetInnerHTML={{ __html: c.icon }} style={{ color: c.color, display: 'inline-flex', alignItems: 'center' }} />
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
