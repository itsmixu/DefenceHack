import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { prefetchBbox, PREFETCH_LAYERS } from '../lib/prefetch';
import {
  useBackendStatusStore,
  useMapStore,
  useTimelineStore,
  useToastStore,
  useZonesStore,
  type Bbox4,
  type Zone,
} from '../store';

const okCount = (results: Awaited<ReturnType<typeof prefetchBbox>>) =>
  results.filter((r) => r.ok).length;

export default function ZoneControls() {
  const map = useMapStore((s) => s.map);
  const zones = useZonesStore((s) => s.zones);
  const addZone = useZonesStore((s) => s.add);
  const removeZone = useZonesStore((s) => s.remove);
  const updateZone = useZonesStore((s) => s.update);
  const setPrefetch = useZonesStore((s) => s.setPrefetch);
  const setBackendUnavailable = useBackendStatusStore((s) => s.setUnavailable);
  const setBackendAvailable = useBackendStatusStore((s) => s.setAvailable);
  const committedMs = useTimelineStore((s) => s.committedMs);
  const selectedIso = useMemo(() => new Date(committedMs).toISOString(), [committedMs]);
  const push = useToastStore((s) => s.push);
  const qc = useQueryClient();

  const [open, setOpen] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const runPrefetch = async (zone: Zone) => {
    setBusyId(zone.id);
    setPrefetch(zone.id, 'fetching');
    push('info', `Prefetching ${PREFETCH_LAYERS.length} sources for "${zone.name}"…`);
    try {
      const results = await prefetchBbox(qc, zone.bbox, selectedIso);
      const backendDown = results.some((r) => r.backendDown);
      if (backendDown) {
        setPrefetch(zone.id, 'error');
        setBackendUnavailable('Backend unreachable at /api (is port 8000 running?)');
        push('error', 'Backend is not running. Zone prefetch failed.');
        return;
      }

      setBackendAvailable();
      setPrefetch(zone.id, 'ready', Date.now());
      push('success', `"${zone.name}" ready · ${okCount(results)}/${results.length} sources`);
    } catch (err) {
      setPrefetch(zone.id, 'error');
      push('error', `Prefetch failed for "${zone.name}": ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveCurrent = () => {
    if (!map) {
      push('error', 'Map not ready');
      return;
    }
    const b = map.getBounds();
    const bbox: Bbox4 = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const center = map.getCenter();
    const defaultName = `Zone ${zones.length + 1}`;
    const name = window.prompt('Name this operation zone:', defaultName)?.trim();
    if (!name) return;

    const zone = addZone({
      name,
      bbox,
      center: [center.lat, center.lng],
      zoom: map.getZoom(),
    });
    push('success', `Created zone "${name}" — prefetching all sources…`);
    void runPrefetch(zone);
  };

  const handleZoneClick = (zone: Zone) => {
    if (!map) return;
    map.flyTo(zone.center, zone.zoom, { duration: 0.7 });
  };

  const startEdit = (zone: Zone) => {
    setEditingId(zone.id);
    setDraftName(zone.name);
    push('info', `Editing "${zone.name}" — pan/zoom map, then save`);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraftName('');
  };

  const saveEditFromViewport = (zone: Zone) => {
    if (!map) {
      push('error', 'Map not ready');
      return;
    }

    const b = map.getBounds();
    const center = map.getCenter();
    const nextName = draftName.trim() || zone.name;
    updateZone(zone.id, {
      name: nextName,
      bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      center: [center.lat, center.lng],
      zoom: map.getZoom(),
    });

    cancelEdit();
    push('success', `Updated zone "${nextName}"`);
  };

  return (
    <div className="pointer-events-auto absolute bottom-[88px] left-3 z-[1000] flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleSaveCurrent}
        className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-black/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)] hover:bg-black"
        title="Save the current viewport as an operation zone and prefetch all sources"
      >
        <Plus className="h-3.5 w-3.5" />
        Save zone
      </button>

      {zones.length > 0 && (
        <div className="w-72 rounded-xl border border-white/15 bg-black/95 shadow-[0_10px_28px_rgba(0,0,0,0.45)] overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90 hover:bg-white/[0.06]"
          >
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Operation zones ({zones.length})
            </span>
            <span className="text-white/60">{open ? '−' : '+'}</span>
          </button>

          {open && (
            <ul className="max-h-72 overflow-y-auto border-t border-white/10">
              {zones.map((z) => {
                const isEditing = editingId === z.id;
                return (
                  <li
                    key={z.id}
                    className="flex items-center gap-1 px-2 py-1.5 hover:bg-white/[0.05]"
                  >
                    {isEditing ? (
                      <div className="flex flex-1 flex-col gap-1">
                        <input
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          className="w-full rounded border border-white/25 bg-black/90 px-1.5 py-1 text-xs text-white"
                          placeholder="Zone name"
                        />
                        <span className="text-[10px] uppercase tracking-[0.06em] text-white/45">
                          Save uses current map viewport for size/location
                        </span>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleZoneClick(z)}
                        className="flex flex-1 flex-col items-start gap-0 truncate text-left text-xs text-white/90"
                        title={`Fly to ${z.name} (cached data); refresh button refetches`}
                      >
                        <span className="flex items-center gap-1.5 truncate font-medium">
                          <PrefetchDot status={z.prefetchStatus ?? 'idle'} />
                          <span className="truncate">{z.name}</span>
                        </span>
                        <span className="pl-4 font-mono text-[10px] uppercase tracking-[0.04em] text-white/45">
                          {z.lastFetchedAt
                            ? `fetched ${formatRelative(z.lastFetchedAt)}`
                            : 'never fetched'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => runPrefetch(z)}
                      disabled={busyId === z.id || isEditing}
                      className="rounded p-1 text-white/55 hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
                      title="Re-prefetch all sources"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${busyId === z.id ? 'animate-spin' : ''}`}
                      />
                    </button>

                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveEditFromViewport(z)}
                          className="rounded p-1 text-emerald-300 hover:bg-emerald-500/15"
                          title="Save zone name and current viewport"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded p-1 text-white/55 hover:bg-white/[0.1]"
                          title="Cancel edit"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(z)}
                        className="rounded p-1 text-white/55 hover:bg-white/[0.1] hover:text-white"
                        title="Edit zone name and viewport"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        removeZone(z.id);
                        if (editingId === z.id) cancelEdit();
                        push('info', `Removed zone "${z.name}"`);
                      }}
                      className="rounded p-1 text-white/55 hover:bg-red-500/15 hover:text-red-300"
                      title="Delete zone"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function formatRelative(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function PrefetchDot({ status }: { status: NonNullable<Zone['prefetchStatus']> }) {
  if (status === 'fetching') {
    return <Zap className="h-3 w-3 animate-pulse text-amber-300" />;
  }
  if (status === 'ready') return <span className="h-2 w-2 rounded-full bg-emerald-300" />;
  if (status === 'error') return <span className="h-2 w-2 rounded-full bg-red-300" />;
  return <span className="h-2 w-2 rounded-full bg-white/35" />;
}
