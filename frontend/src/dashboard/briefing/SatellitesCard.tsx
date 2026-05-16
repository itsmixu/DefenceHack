import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLayer } from '../../api/client';
import { useBboxStore, useTimelineStore } from '../../store';

interface N2yoProps {
  source: 'n2yo';
  feature_type: 'position' | 'footprint';
  category: string;
  satid?: number;
  satname?: string;
  altitude_km?: number;
  footprint_radius_km?: number;
  launch_date?: string;
}

export default function SatellitesCard() {
  const bbox = useBboxStore((s) => s.bbox);
  const selectedMs = useTimelineStore((s) => s.selectedMs);
  const t = useMemo(() => new Date(selectedMs).toISOString(), [selectedMs]);

  const { data, isLoading, error } = useQuery({
    enabled: !!bbox,
    queryKey: ['n2yo-card', bbox, t],
    queryFn: () => getLayer('n2yo', { bbox: bbox!, t }),
    staleTime: 60_000,
  });

  if (!bbox) return null;
  if (isLoading) return <Skeleton title="Satellites overhead" hint="Loading…" />;
  if (error || !data) return <Skeleton title="Satellites overhead" hint="Unavailable." />;

  if (data.meta?.status !== 'ok') {
    return (
      <Skeleton
        title="Satellites overhead"
        hint={data.meta?.reason ? String(data.meta.reason) : 'Unavailable.'}
      />
    );
  }

  const sats = (data.features as unknown as { properties: N2yoProps }[])
    .filter((f) => f.properties.feature_type === 'position')
    .sort((a, b) => (a.properties.altitude_km ?? 0) - (b.properties.altitude_km ?? 0));

  if (!sats.length) {
    return <Skeleton title="Satellites overhead" hint="None in current window." />;
  }

  const byCategory = sats.reduce<Record<string, number>>((acc, f) => {
    const c = f.properties.category ?? 'other';
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <section className="rounded border border-white/10 bg-black/40 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
          Satellites overhead
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">
          {sats.length} sat · n2yo
        </span>
      </header>

      <div className="mb-2 flex flex-wrap gap-1">
        {Object.entries(byCategory).map(([cat, n]) => (
          <span
            key={cat}
            className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white/75"
          >
            {cat}: {n}
          </span>
        ))}
      </div>

      <ul className="max-h-56 space-y-1 overflow-y-auto">
        {sats.slice(0, 30).map((f) => {
          const p = f.properties;
          return (
            <li
              key={`${p.satid}-${p.satname}`}
              className="rounded border border-white/10 bg-white/[0.02] px-2 py-1"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] font-semibold text-white/90">
                  {p.satname ?? `NORAD ${p.satid}`}
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
                  {p.altitude_km ? `${Math.round(p.altitude_km)} km` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.06em] text-white/45">
                <span>{p.category}</span>
                {p.footprint_radius_km != null && (
                  <span>footprint {Math.round(p.footprint_radius_km)} km</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Skeleton({ title, hint }: { title: string; hint: string }) {
  return (
    <section className="rounded border border-white/10 bg-black/30 px-3 py-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70">{title}</h3>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">{hint}</p>
    </section>
  );
}
