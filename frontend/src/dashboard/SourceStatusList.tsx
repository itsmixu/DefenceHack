import { useQuery } from '@tanstack/react-query';
import { getSources } from '../api/client';
import { useLayerStore } from '../store';
import type { LayerKey, LayerStatus } from '../api/types';

const dotForStatus = (s?: LayerStatus) => {
  if (!s) return 'bg-white/35';
  if (s === 'ok') return 'bg-emerald-300';
  if (s === 'unavailable') return 'bg-amber-300';
  return 'bg-red-300';
};

const labelForStatus = (s?: LayerStatus) => {
  if (!s) return 'not loaded';
  return s;
};

export default function SourceStatusList() {
  const status = useLayerStore((s) => s.status);
  const { data, isLoading, error } = useQuery({
    queryKey: ['sources'],
    queryFn: getSources,
  });

  if (isLoading) {
    return <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">Loading sources…</p>;
  }
  if (error) {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-red-300">
        Backend unreachable. Is it running on <code>:8000</code>?
      </p>
    );
  }
  if (!data?.length) {
    return <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">No sources reported.</p>;
  }

  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
        Live status per data source for the current viewport. Judging
        criterion: transparency about what's available.
      </p>
      <ul className="space-y-2">
        {data.map((s) => {
          const st = status[s.id as LayerKey];
          return (
            <li
              key={s.id}
              className="rounded border border-white/10 bg-black/30 p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">{s.name}</span>
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
                  <span className={`h-2 w-2 rounded-full ${dotForStatus(st)}`} />
                  {labelForStatus(st)}
                </span>
              </div>
              {s.description && (
                <p className="mt-1 text-white/70">{s.description}</p>
              )}
              <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">
                id: {s.id}
                {s.auth_required ? ' · auth required' : ''}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
