import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLayer } from '../../api/client';
import { useBboxStore, useTimelineStore } from '../../store';

interface StarlinkProps {
  source: 'starlink';
  feature_type: 'position' | 'footprint';
  satname?: string;
  norad_id?: number;
  altitude_km?: number;
  elevation_deg?: number;
  speed_kmh?: number;
  inclination_deg?: number;
  footprint_radius_km?: number;
}

const elevColor = (deg: number) =>
  deg > 45 ? '#d946ef' : deg > 20 ? '#a855f7' : '#7c3aed';

export default function SatellitesCard() {
  const bbox = useBboxStore((s) => s.bbox);
  const committedMs = useTimelineStore((s) => s.committedMs);
  const t = useMemo(() => new Date(committedMs).toISOString(), [committedMs]);

  const { data, isLoading, error } = useQuery({
    enabled: !!bbox,
    queryKey: ['starlink-card', bbox, t],
    queryFn: () => getLayer('starlink', { bbox: bbox!, t }),
    staleTime: 120_000,
  });

  if (!bbox) return null;
  if (isLoading) return <Skeleton hint="Computing positions…" />;
  if (error || !data) return <Skeleton hint="Unavailable." />;

  if (data.meta?.status !== 'ok' && data.meta?.status !== 'partial') {
    return (
      <Skeleton
        hint={data.meta?.reason ? String(data.meta.reason) : 'Unavailable.'}
      />
    );
  }

  const sats = (data.features as unknown as { properties: StarlinkProps }[])
    .filter((f) => f.properties.feature_type === 'position')
    .sort((a, b) => (b.properties.elevation_deg ?? 0) - (a.properties.elevation_deg ?? 0));

  if (!sats.length) {
    return <Skeleton hint="No satellites above horizon right now." />;
  }

  const avgAlt = sats.reduce((s, f) => s + (f.properties.altitude_km ?? 0), 0) / sats.length;
  const maxElev = sats[0]?.properties.elevation_deg ?? 0;

  return (
    <section className="rounded-lg border border-white/10 bg-black/40 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
          Starlink overhead
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">
          {sats.length} sat · celestrak
        </span>
      </header>

      <div className="mb-2 flex flex-wrap gap-1">
        <span className="rounded-lg border border-white/15 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white/75">
          best elev: {maxElev.toFixed(1)}°
        </span>
        <span className="rounded-lg border border-white/15 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white/75">
          avg alt: {avgAlt.toFixed(0)} km
        </span>
      </div>

      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {sats.slice(0, 30).map((f) => {
          const p = f.properties;
          const color = elevColor(p.elevation_deg ?? 0);
          return (
            <li
              key={p.norad_id ?? p.satname}
              className="rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] font-semibold text-white/90">
                  {p.satname ?? `NORAD ${p.norad_id}`}
                </span>
                <span
                  className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em]"
                  style={{ color }}
                >
                  {p.elevation_deg != null ? `${p.elevation_deg.toFixed(1)}°` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.06em] text-white/45">
                <span>{p.altitude_km ? `${Math.round(p.altitude_km)} km alt` : '—'}</span>
                {p.footprint_radius_km != null && (
                  <span>cov {Math.round(p.footprint_radius_km)} km</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.06em] text-white/30">
        Positions via Celestrak TLE / SGP4 · sorted by elevation
      </p>
    </section>
  );
}

function Skeleton({ hint }: { hint: string }) {
  return (
    <section className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">
        Starlink overhead
      </h3>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">{hint}</p>
    </section>
  );
}
