import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listOperations, listPlans } from '../api/client';
import type { Operation, PlanSummary } from '../api/types';

export default function PlansList() {
  const [tab, setTab] = useState<'plans' | 'ops'>('plans');

  return (
    <div>
      <div className="mb-3 inline-flex rounded border border-white/10 bg-black/40 p-0.5 text-[10px] uppercase tracking-[0.08em]">
        <SubTab active={tab === 'plans'} onClick={() => setTab('plans')} label="Plans" />
        <SubTab active={tab === 'ops'} onClick={() => setTab('ops')} label="Operations" />
      </div>
      {tab === 'plans' ? <Plans /> : <Operations />}
    </div>
  );
}

function SubTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1 transition ${
        active ? 'bg-white text-black' : 'text-white/65 hover:bg-white/[0.08]'
      }`}
    >
      {label}
    </button>
  );
}

function Plans() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['plans'],
    queryFn: listPlans,
    staleTime: 30_000,
  });

  if (isLoading) return <Empty hint="Loading…" />;
  if (error) return <Empty hint="Backend unreachable." />;
  if (!data?.length) {
    return (
      <Empty hint="No plans saved yet. Draw something on the map and POST to /api/plans." />
    );
  }

  return (
    <ul className="space-y-1.5">
      {data.map((p) => (
        <PlanRow key={p.id} plan={p} />
      ))}
    </ul>
  );
}

function PlanRow({ plan }: { plan: PlanSummary }) {
  return (
    <li className="rounded border border-white/10 bg-black/30 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">
          {plan.name || `plan ${plan.id.slice(0, 8)}`}
        </span>
        {plan.role && (
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/45">
            {plan.role}
          </span>
        )}
      </div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
        {(plan.active_layers ?? []).length} layer(s) ·{' '}
        {plan.created_at?.slice(0, 16).replace('T', ' ') ?? '—'}
      </div>
      {plan.notes && (
        <p className="mt-1 text-[11px] leading-snug text-white/75 line-clamp-3">{plan.notes}</p>
      )}
    </li>
  );
}

function Operations() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['operations'],
    queryFn: () => listOperations(),
    staleTime: 30_000,
  });

  if (isLoading) return <Empty hint="Loading…" />;
  if (error) return <Empty hint="Backend unreachable." />;
  if (!data?.length) {
    return (
      <Empty hint="No operations logged. POST to /api/operations to record a prediction, PATCH /actual to record what really happened." />
    );
  }

  return (
    <ul className="space-y-1.5">
      {data.map((op) => (
        <OperationRow key={op.id} op={op} />
      ))}
    </ul>
  );
}

function OperationRow({ op }: { op: Operation }) {
  const hasActual = !!op.actual && (op.actual.outcome || op.actual.notes);
  return (
    <li className="rounded border border-white/10 bg-black/30 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/90">
          {op.name || `op ${op.id.slice(0, 8)}`}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${
            hasActual
              ? 'border border-emerald-300/40 text-emerald-300'
              : 'border border-amber-300/40 text-amber-300'
          }`}
        >
          {hasActual ? 'closed' : 'open'}
        </span>
      </div>
      {op.prediction?.expected_outcome && (
        <p className="mt-1 text-[11px] leading-snug text-white/80">
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/45">
            predicted ·{' '}
          </span>
          {op.prediction.expected_outcome}
        </p>
      )}
      {op.prediction?.threat_assessment && (
        <p className="mt-0.5 text-[10px] leading-snug text-white/60">
          threat: {op.prediction.threat_assessment}
        </p>
      )}
      {hasActual && (
        <p className="mt-1 border-t border-white/10 pt-1 text-[11px] leading-snug text-white/80">
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-emerald-300/80">
            actual ·{' '}
          </span>
          {op.actual?.outcome ?? op.actual?.notes}
        </p>
      )}
      {(op.tags?.length ?? 0) > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {op.tags!.map((tg) => (
            <span
              key={tg}
              className="rounded border border-white/15 bg-white/[0.04] px-1 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-white/70"
            >
              {tg}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

function Empty({ hint }: { hint: string }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/45">{hint}</p>
  );
}
