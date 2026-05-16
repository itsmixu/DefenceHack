import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDroneConditions } from '../../api/client';
import { useBboxStore, useTimelineStore } from '../../store';
import type { DroneForecastStep, DroneRating } from '../../api/types';

const ratingColor = (r?: DroneRating) => {
  if (r === 'go') return 'bg-emerald-400 text-black';
  if (r === 'marginal') return 'bg-amber-300 text-black';
  if (r === 'no-go') return 'bg-red-400 text-black';
  return 'bg-white/15 text-white/80';
};

const stripCellColor = (r?: DroneRating) => {
  if (r === 'go') return 'bg-emerald-400';
  if (r === 'marginal') return 'bg-amber-300';
  if (r === 'no-go') return 'bg-red-400';
  return 'bg-white/15';
};

const shortHour = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, '0')}Z`;
};

export default function DroneConditionsCard() {
  const bbox = useBboxStore((s) => s.bbox);
  const committedMs = useTimelineStore((s) => s.committedMs);
  const t = useMemo(() => new Date(committedMs).toISOString(), [committedMs]);

  const { data, isLoading, error } = useQuery({
    enabled: !!bbox,
    queryKey: ['drone-conditions', bbox, t],
    queryFn: () => getDroneConditions({ bbox: bbox!, t }),
    staleTime: 60_000,
  });

  if (!bbox) return null;
  if (isLoading) {
    return <Skeleton title="UAS / Drone Conditions" hint="Loading…" />;
  }
  if (error || !data) {
    return <Skeleton title="UAS / Drone Conditions" hint="Unavailable." />;
  }

  const next: DroneForecastStep[] = (data.forecast_timeline ?? []).slice(0, 24);
  const nextGo = data.summary.next_go_window;

  return (
    <section className="rounded border border-white/10 bg-black/40 p-3">
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
          UAS / Drone Conditions
        </h3>
        <span
          className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] ${ratingColor(data.summary.current_rating)}`}
        >
          {data.summary.current_rating}
        </span>
      </header>

      {nextGo && data.summary.current_rating !== 'go' && (
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
          next go window: {new Date(nextGo).toISOString().slice(0, 16).replace('T', ' ')}Z
        </p>
      )}

      {next.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">
            <span>next 24 h</span>
            <span>{shortHour(next[0].time)} → {shortHour(next[next.length - 1].time)}</span>
          </div>
          <div className="flex h-5 overflow-hidden rounded border border-white/10">
            {next.map((step) => (
              <div
                key={step.time}
                className={`flex-1 ${stripCellColor(step.drone_rating)}`}
                title={`${shortHour(step.time)} · ${step.drone_rating}${step.drone_summary ? ` · ${step.drone_summary}` : ''}`}
              />
            ))}
          </div>
        </div>
      )}

      <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
        {Object.entries(data.thresholds).slice(0, 6).map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="truncate">{k}</dt>
            <dd className="text-white/75">{v}</dd>
          </div>
        ))}
      </dl>
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
