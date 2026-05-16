import { useLayerStore } from '../store';
import type { LayerKey, LayerStatus } from '../api/types';
import { useOsmPoiFilterStore } from '../store';
import { OSM_POI_CATEGORIES } from '../map/osmPoi';

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
  { id: 'fmi', label: 'Weather', hint: 'FMI stations' },
  { id: 'opencellid', label: 'Cell towers', hint: 'OpenCelliD' },
  { id: 'n2yo', label: 'Satellites', hint: 'overpass schedule' },
  { id: 'exposure', label: 'Exposure', hint: 'danger zones' },
  { id: 'mcoo', label: 'MCOO', hint: 'go / slow-go / no-go' },
];

const dotForStatus = (s?: LayerStatus) => {
  if (!s) return 'bg-slate-300';
  if (s === 'ok') return 'bg-green-500';
  if (s === 'unavailable') return 'bg-amber-400';
  return 'bg-red-500';
};

export default function LayerToggles() {
  const active = useLayerStore((s) => s.active);
  const status = useLayerStore((s) => s.status);
  const loading = useLayerStore((s) => s.loading);
  const toggle = useLayerStore((s) => s.toggle);
  const osmEnabled = useOsmPoiFilterStore((s) => s.enabled);
  const toggleOsm = useOsmPoiFilterStore((s) => s.toggle);
  const setAllOsm = useOsmPoiFilterStore((s) => s.setAll);
  const clearAllOsm = useOsmPoiFilterStore((s) => s.clearAll);

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        Toggle layers. Each layer fetches when the map viewport changes.
      </p>
      <ul className="space-y-1">
        {LAYERS.map((l) => {
          const isOsm = l.id === 'osm';
          return (
            <li key={l.id} className="rounded px-2 py-1.5 hover:bg-slate-50">
              <div className="flex items-center justify-between">
                <label className="flex flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!active[l.id]}
                    onChange={() => toggle(l.id)}
                  />
                  <span className="flex flex-col leading-tight">
                    <span className="font-medium text-slate-800">{l.label}</span>
                    {l.hint && <span className="text-[10px] text-slate-500">{l.hint}</span>}
                  </span>
                </label>
                {active[l.id] && loading[l.id] ? (
                  <span
                    className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-sky-500"
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
                <div className="mt-2 rounded border border-slate-200 bg-white/80 p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      POI filters
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={setAllOsm}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                      >
                        all
                      </button>
                      <button
                        type="button"
                        onClick={clearAllOsm}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
                      >
                        none
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                    {OSM_POI_CATEGORIES.map((c) => (
                      <label key={c.id} className="flex items-center gap-1 text-[11px] text-slate-700">
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
    </div>
  );
}
