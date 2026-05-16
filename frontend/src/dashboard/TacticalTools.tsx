import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, MousePointer, ChevronDown, ChevronUp, Wind, RefreshCw } from 'lucide-react';
import { MILITARY_FEATURE_TYPES, useTacticalStore, useBboxStore } from '../store';
import type { MilitaryFeatureType } from '../store';
import { getDroneConditions } from '../api/client';

const GROUPS = [
  {
    label: 'IPB Doctrinal',
    types: ['AOI', 'NAI', 'TAI', 'DP'] as MilitaryFeatureType[],
  },
  {
    label: 'Control Measures',
    types: ['PHASE_LINE', 'BOUNDARY', 'ROUTE', 'OBJECTIVE'] as MilitaryFeatureType[],
  },
  {
    label: 'Unit Positions',
    types: ['UNIT_FRIENDLY', 'UNIT_ENEMY', 'CHOKE_POINT', 'HIDE_SITE'] as MilitaryFeatureType[],
  },
  {
    label: 'Freeform',
    types: ['annotation'] as MilitaryFeatureType[],
  },
];

// ── Drone Conditions panel ─────────────────────────────────────────────────────
function DroneConditionsPanel() {
  const bbox = useBboxStore((s) => s.bbox);
  const [open, setOpen] = useState(true);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['drone-conditions', bbox],
    queryFn: () => getDroneConditions({ bbox: bbox! }),
    enabled: !!bbox,
    staleTime: 5 * 60 * 1000,
  });

  const rating = data?.summary?.current_rating;
  const ratingColor =
    rating === 'go' ? '#22c55e' : rating === 'marginal' ? '#f59e0b' : rating === 'no-go' ? '#ef4444' : '#6b7280';
  const ratingLabel =
    rating === 'go' ? '✓ GO' : rating === 'marginal' ? '⚠ MARGINAL' : rating === 'no-go' ? '✗ NO-GO' : '—';

  const nextHours = data?.forecast_timeline?.slice(0, 12) ?? [];

  return (
    <div className="rounded border border-white/10 bg-black/25">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-2.5 py-2"
      >
        <div className="flex items-center gap-2">
          <Wind size={11} className="text-sky-300" />
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-white/70">
            UAS / Drone conditions
          </span>
          {rating && (
            <span
              className="rounded px-1.5 py-px font-mono text-[9px] font-bold uppercase"
              style={{ color: ratingColor, borderColor: ratingColor, border: `1px solid ${ratingColor}20`, background: `${ratingColor}15` }}
            >
              {ratingLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isFetching && (
            <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white/20 border-t-white/60" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); void refetch(); }}
            className="rounded p-0.5 text-white/30 hover:text-white/70"
            title="Refresh drone analysis"
          >
            <RefreshCw size={10} />
          </button>
          {open ? <ChevronUp size={11} className="text-white/40" /> : <ChevronDown size={11} className="text-white/40" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/10 px-2.5 pb-2.5 pt-2">
          {!bbox && (
            <p className="text-[10px] text-white/40">Pan the map to load drone conditions for this area.</p>
          )}

          {bbox && !data && !isFetching && (
            <p className="text-[10px] text-white/40">No data — check backend is running.</p>
          )}

          {data && (
            <div className="space-y-2">
              {/* Current rating summary */}
              <div className="flex items-start gap-3">
                <div
                  className="flex-shrink-0 rounded px-2 py-1 text-center font-mono text-[11px] font-bold"
                  style={{ color: ratingColor, background: `${ratingColor}18`, border: `1px solid ${ratingColor}40` }}
                >
                  {ratingLabel}
                </div>
                <div>
                  {(data.summary.limiting_factors?.length ?? 0) > 0 && (
                    <ul className="space-y-0.5">
                      {data.summary.limiting_factors!.slice(0, 3).map((f, i) => (
                        <li key={i} className="text-[10px] text-amber-200/80">· {f}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-0.5 font-mono text-[9px] text-white/30">
                    {data.summary.station_count} stations · {data.summary.stations_no_go} no-go
                  </p>
                </div>
              </div>

              {/* 12-hour forecast strip */}
              {nextHours.length > 0 && (
                <div>
                  <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.06em] text-white/35">
                    48-h forecast
                  </p>
                  <div className="flex gap-px overflow-hidden rounded">
                    {nextHours.map((h, i) => {
                      const c =
                        h.drone_rating === 'go' ? '#22c55e' :
                        h.drone_rating === 'marginal' ? '#f59e0b' : '#ef4444';
                      const hr = new Date(h.time).getUTCHours().toString().padStart(2, '0');
                      return (
                        <div
                          key={i}
                          title={`${h.time.slice(0, 16)} UTC — ${h.drone_rating}${h.wind_ms != null ? ` · ${h.wind_ms} m/s` : ''}`}
                          className="flex flex-1 flex-col items-center py-1"
                          style={{ background: `${c}25`, borderBottom: `2px solid ${c}` }}
                        >
                          <span style={{ color: c }} className="font-mono text-[8px]">{hr}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-1 flex gap-3 font-mono text-[8px] text-white/30">
                    <span style={{ color: '#22c55e' }}>■ go</span>
                    <span style={{ color: '#f59e0b' }}>■ marginal</span>
                    <span style={{ color: '#ef4444' }}>■ no-go</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tactical drawing palette ───────────────────────────────────────────────────
export default function TacticalTools() {
  const setPending = useTacticalStore((s) => s.setPending);
  const pendingType = useTacticalStore((s) => s.pendingType);

  return (
    <div className="space-y-3">
      {/* UAS drone conditions analysis */}
      <DroneConditionsPanel />

      {/* Drawing instructions / active indicator */}
      <div className="flex items-start gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <MousePointer size={12} className="mt-0.5 flex-shrink-0 text-white/40" />
        <p className="text-[10px] leading-relaxed text-white/55">
          Click a shape below then draw on the map. The tool labels your shape
          automatically and colour-codes it by military type.
        </p>
      </div>

      {pendingType && (
        <div className="flex items-center gap-2 rounded border border-amber-300/40 bg-amber-500/10 px-3 py-2">
          <Crosshair size={12} className="text-amber-300" />
          <span className="text-[11px] text-amber-200">
            Drawing&nbsp;<strong>{pendingType}</strong> — click on the map to start
          </span>
        </div>
      )}

      {/* Military shape palette */}
      {GROUPS.map((group) => (
        <section key={group.label}>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/40">
            {group.label}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {group.types.map((type) => {
              const def = MILITARY_FEATURE_TYPES.find((t) => t.type === type);
              if (!def) return null;
              const isActive = pendingType === type;
              return (
                <button
                  key={type}
                  onClick={() => setPending(type, def.mode)}
                  title={def.desc}
                  style={{
                    borderColor: isActive ? def.color : undefined,
                    backgroundColor: isActive ? `${def.color}18` : undefined,
                  }}
                  className={`flex flex-col items-start rounded border px-2 py-1.5 text-left transition ${
                    isActive
                      ? 'text-white'
                      : 'border-white/10 text-white/65 hover:border-white/30 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ backgroundColor: def.color }} />
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em]">
                      {type === 'annotation' ? 'Note' : type.replace(/_/g, ' ')}
                    </span>
                    <span className="ml-auto font-mono text-[8px] text-white/30">
                      {def.mode === 'Polygon' ? '▪' : def.mode === 'Polyline' ? '—' : '●'}
                    </span>
                  </div>
                  <span className="mt-0.5 text-[9px] leading-tight text-white/40">{def.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <p className="font-mono text-[9px] uppercase tracking-[0.04em] text-white/25">
        Shapes are colour-coded by type. Review drawn shapes in the Drawn tab.
      </p>
    </div>
  );
}
