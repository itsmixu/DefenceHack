import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLayer } from '../../api/client';
import { useBboxStore, useTimelineStore } from '../../store';

interface FmiMeasurement {
  parameter: string;
  value: number | null;
  unit?: string;
}

interface FmiStationProps {
  source: 'fmi';
  time: string;
  measurements: FmiMeasurement[];
  station_name?: string | null;
}

const fmtNum = (n: number | null | undefined, digits = 1, suffix = '') => {
  if (n == null || !Number.isFinite(n)) return null;
  return `${n.toFixed(digits)}${suffix}`;
};

export default function WeatherCard() {
  const bbox = useBboxStore((s) => s.bbox);
  const committedMs = useTimelineStore((s) => s.committedMs);
  const t = useMemo(() => new Date(committedMs).toISOString(), [committedMs]);

  const { data, isLoading, error } = useQuery({
    enabled: !!bbox,
    queryKey: ['fmi-card', bbox, t],
    queryFn: () => getLayer('fmi', { bbox: bbox!, t }),
    staleTime: 60_000,
  });

  if (!bbox) return null;
  if (isLoading) return <Skeleton title="Weather (FMI)" hint="Loading…" />;
  if (error || !data) return <Skeleton title="Weather (FMI)" hint="Unavailable." />;

  if (data.meta?.status !== 'ok' || !data.features.length) {
    return (
      <Skeleton
        title="Weather (FMI)"
        hint={data.meta?.reason ? String(data.meta.reason) : 'No observations in window.'}
      />
    );
  }

  // Aggregate the latest values across all stations in the viewport.
  const agg = aggregate(data.features as unknown as { properties: FmiStationProps }[]);

  return (
    <section className="rounded border border-white/10 bg-black/40 p-3">
      <header className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
          Weather · FMI observations
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">
          {agg.stationCount} stn
        </span>
      </header>

      <div className="grid grid-cols-3 gap-1.5 text-center">
        <Big label="temp" value={fmtNum(agg.temperature, 1, '°C')} />
        <Big label="wind" value={fmtNum(agg.windspeed, 1, ' m/s')} />
        <Big label="gust" value={fmtNum(agg.gust, 1, ' m/s')} />
        <Big label="rh" value={fmtNum(agg.humidity, 0, '%')} />
        <Big label="press" value={fmtNum(agg.pressure, 0, ' hPa')} />
        <Big label="vis" value={fmtNum(agg.visibility, 0, ' m')} />
      </div>

      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">
        latest obs: {agg.latestTime ? agg.latestTime.slice(0, 16).replace('T', ' ') + 'Z' : '—'}
      </p>
    </section>
  );
}

function aggregate(features: { properties: FmiStationProps }[]) {
  // Use only the most recent observation per station.
  const latestPerStation = new Map<string, FmiStationProps>();
  for (const f of features) {
    const p = f.properties;
    const key = p.station_name ?? `${p.time}`;
    const cur = latestPerStation.get(key);
    if (!cur || (p.time && p.time > cur.time)) {
      latestPerStation.set(key, p);
    }
  }

  const collect = (param: string): number[] =>
    [...latestPerStation.values()]
      .flatMap((p) => p.measurements.filter((m) => m.parameter === param))
      .map((m) => m.value)
      .filter((v): v is number => v != null && Number.isFinite(v));

  const avg = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  const times = [...latestPerStation.values()].map((p) => p.time).filter(Boolean).sort();

  return {
    stationCount: latestPerStation.size,
    latestTime: times[times.length - 1] ?? null,
    temperature: avg(collect('temperature')),
    windspeed: avg(collect('windspeedms')),
    gust: avg(collect('windgust')),
    humidity: avg(collect('humidity')),
    pressure: avg(collect('pressure')),
    visibility: avg(collect('visibility')),
  };
}

function Big({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded border border-white/10 bg-black/40 px-1.5 py-1">
      <div className="font-mono text-[12px] text-white/90">{value ?? '—'}</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/45">{label}</div>
    </div>
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
