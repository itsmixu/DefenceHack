import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTerrainEffects } from '../../api/client';
import { useBboxStore, useTimelineStore } from '../../store';
import type { TerrainFunctionRating } from '../../api/types';

const ratingClass = (r?: string) => {
  if (r === 'unrestricted') return 'text-emerald-300';
  if (r === 'restricted') return 'text-amber-300';
  if (r === 'severely_restricted') return 'text-red-300';
  return 'text-white/55';
};

const ratingLabel = (r?: string) => (r ? r.replace(/_/g, ' ') : 'unknown');

const FUNCTION_ORDER = ['maneuver', 'fires', 'intelligence', 'sustainment', 'protection'];

export default function TerrainEffectsCard() {
  const bbox = useBboxStore((s) => s.bbox);
  const selectedMs = useTimelineStore((s) => s.selectedMs);
  const t = useMemo(() => new Date(selectedMs).toISOString(), [selectedMs]);

  const { data, isLoading, error } = useQuery({
    enabled: !!bbox,
    queryKey: ['terrain-effects', bbox, t],
    queryFn: () => getTerrainEffects({ bbox: bbox!, t }),
    staleTime: 60_000,
  });

  if (!bbox) return <EmptyCard title="Terrain Effects" hint="Pan the map to load." />;
  if (isLoading) return <EmptyCard title="Terrain Effects" hint="Loading…" />;
  if (error || !data) return <EmptyCard title="Terrain Effects" hint="Unavailable." />;

  return (
    <section className="rounded border border-white/10 bg-black/40 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
          Terrain Effects Matrix
        </h3>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/45">
          {data.doctrine}
        </span>
      </header>

      <p className="mb-3 text-[11px] leading-snug text-white/80">{data.summary}</p>

      <ul className="space-y-1.5">
        {FUNCTION_ORDER.map((key) => {
          const fn: TerrainFunctionRating | undefined = data.functions[key];
          if (!fn) return null;
          return (
            <li key={key} className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">
                  {key}
                </span>
                <span className="flex items-center gap-1.5">
                  {fn.cite && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-white/40">
                      {fn.cite}
                    </span>
                  )}
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.08em] ${ratingClass(fn.rating)}`}
                  >
                    {ratingLabel(fn.rating)}
                  </span>
                </span>
              </div>
              {fn.rationale && (
                <p className="mt-0.5 text-[10px] leading-snug text-white/65">{fn.rationale}</p>
              )}
            </li>
          );
        })}
      </ul>

      {data.terrain_composition && data.terrain_composition.total_polygons > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-1 text-[10px] uppercase tracking-[0.06em]">
          <Stat color="text-emerald-300" label="go" value={`${data.terrain_composition.go_pct}%`} />
          <Stat color="text-amber-300" label="slow" value={`${data.terrain_composition.slow_go_pct}%`} />
          <Stat color="text-red-300" label="no-go" value={`${data.terrain_composition.no_go_pct}%`} />
        </div>
      )}

      {data.weather && data.weather.stations > 0 && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
          weather:{' '}
          {data.weather.avg_temp_c != null ? `${data.weather.avg_temp_c}°C` : '—'} ·{' '}
          {data.weather.avg_wind_ms != null ? `${data.weather.avg_wind_ms} m/s` : '—'} ·{' '}
          {data.weather.stations} stn
        </p>
      )}

      {data.mobility && (data.mobility.bridge_count ?? 0) > 0 && (
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
          mobility: {data.mobility.bridge_count} bridge chokepoint(s)
          {data.mobility.weighted_mech_speed_kmh
            ? ` · ${data.mobility.weighted_mech_speed_kmh} km/h mech`
            : ''}
        </p>
      )}
    </section>
  );
}

function Stat({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/40 px-1.5 py-1 text-center">
      <div className={`font-mono text-[11px] ${color}`}>{value}</div>
      <div className="font-mono text-[9px] tracking-[0.06em] text-white/50">{label}</div>
    </div>
  );
}

function EmptyCard({ title, hint }: { title: string; hint: string }) {
  return (
    <section className="rounded border border-white/10 bg-black/30 px-3 py-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">{title}</h3>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">{hint}</p>
    </section>
  );
}
