import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAstronomical } from '../../api/client';
import { useBboxStore, useTimelineStore } from '../../store';
import type { AstronomicalDayProps } from '../../api/types';

const nightRatingDot = (r?: string) => {
  if (r === 'dark') return 'bg-indigo-400';
  if (r === 'partial') return 'bg-amber-300';
  if (r === 'bright') return 'bg-yellow-200';
  return 'bg-white/25';
};

const moonGlyph = (illum: number | null | undefined) => {
  if (illum == null) return '◐';
  if (illum < 5) return '●';
  if (illum < 30) return '◗';
  if (illum < 70) return '◐';
  if (illum < 95) return '◖';
  return '○';
};

const timeOnly = (iso?: string) => {
  if (!iso) return '—';
  return iso.slice(11, 16);
};

const dateLabel = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: '2-digit' });
};

export default function AstronomyCard() {
  const bbox = useBboxStore((s) => s.bbox);
  const committedMs = useTimelineStore((s) => s.committedMs);
  const t = useMemo(() => new Date(committedMs).toISOString(), [committedMs]);

  const { data, isLoading, error } = useQuery({
    enabled: !!bbox,
    queryKey: ['astronomical', bbox, t],
    queryFn: () => getAstronomical({ bbox: bbox!, t }),
    staleTime: 5 * 60_000,
  });

  if (!bbox) return null;
  if (isLoading) {
    return <Skeleton title="Astronomy" hint="Loading…" />;
  }
  if (error || !data || !data.features.length) {
    return <Skeleton title="Astronomy" hint="Unavailable." />;
  }

  return (
    <section className="rounded border border-white/10 bg-black/40 p-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
        Astronomy · sun / moon / twilight
      </h3>

      <ul className="space-y-1.5">
        {data.features.map((f) => {
          const p: AstronomicalDayProps = f.properties;
          return (
            <li key={p.date} className="rounded border border-white/10 bg-white/[0.02] px-2 py-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85">
                  {dateLabel(p.date)}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em]">
                  <span className={`h-2 w-2 rounded-full ${nightRatingDot(p.night_ops_rating)}`} />
                  <span className="text-white/75">{p.night_ops_rating}</span>
                </span>
              </div>
              <div className="mt-0.5 grid grid-cols-2 gap-x-2 font-mono text-[10px] text-white/65">
                <div>☀ rise {timeOnly(p.sunrise)}</div>
                <div>☀ set {timeOnly(p.sunset)}</div>
                <div>🌑 dawn {timeOnly(p.civil_dawn)}</div>
                <div>🌑 dusk {timeOnly(p.civil_dusk)}</div>
              </div>
              <div className="mt-0.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
                <span>
                  {moonGlyph(p.moon_illumination_pct)}{' '}
                  {p.moon_illumination_pct != null ? `${p.moon_illumination_pct}%` : '—'}
                </span>
                {p.darkness_hours != null && (
                  <span>{p.darkness_hours.toFixed(1)} h dark</span>
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
