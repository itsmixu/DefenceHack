import { useMemo, useState } from 'react';
import { Terminal, Trash2, X } from 'lucide-react';
import { useDebugStore, type DebugEntry } from '../lib/debugStore';

type Filter = 'all' | 'errors' | 'slow';

/** Compact trigger button — mounted inline in TopBar's right utility cluster. */
export function DebugTriggerButton() {
  const entries = useDebugStore((s) => s.entries);
  const toggleOpen = useDebugStore((s) => s.toggleOpen);
  const stats = useMemo(() => {
    const failed = entries.filter((e) => e.error || (e.status != null && e.status >= 400)).length;
    const unavailable = entries.filter((e) => e.metaStatus === 'unavailable').length;
    return { total: entries.length, failed, unavailable };
  }, [entries]);
  return (
    <button
      type="button"
      onClick={toggleOpen}
      className="flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/70 transition hover:border-white hover:text-white"
      style={{ borderColor: '#393939', background: '#1a1a1a' }}
      title="Network debug — request log"
    >
      <Terminal size={11} />
      <span>net</span>
      <span className="text-white/45">{stats.total}</span>
      {stats.failed > 0 && (
        <span className="rounded bg-red-500/80 px-1 text-[9px] font-bold text-black">{stats.failed}</span>
      )}
      {stats.unavailable > 0 && (
        <span className="rounded bg-amber-300/80 px-1 text-[9px] font-bold text-black">{stats.unavailable}</span>
      )}
    </button>
  );
}

export default function DebugPanel() {
  const entries = useDebugStore((s) => s.entries);
  const open = useDebugStore((s) => s.open);
  const toggleOpen = useDebugStore((s) => s.toggleOpen);
  const clear = useDebugStore((s) => s.clear);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const pending = entries.filter((e) => e.status === undefined && !e.error).length;
    const failed = entries.filter((e) => e.error || (e.status != null && e.status >= 400)).length;
    const unavailable = entries.filter((e) => e.metaStatus === 'unavailable').length;
    return { total: entries.length, pending, failed, unavailable };
  }, [entries]);

  const filtered = useMemo(() => {
    if (filter === 'errors') {
      return entries.filter(
        (e) =>
          e.error ||
          (e.status != null && e.status >= 400) ||
          e.metaStatus === 'unavailable' ||
          e.metaStatus === 'error',
      );
    }
    if (filter === 'slow') {
      return entries.filter((e) => (e.durationMs ?? 0) > 1000);
    }
    return entries;
  }, [entries, filter]);

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );

  if (!open) return null;

  return (
    <div className="pointer-events-auto fixed top-[72px] right-3 z-[1100] flex h-[calc(100vh-5rem)] w-[344px] flex-col rounded border border-white/15 bg-[#0b0b0b]/95 text-white shadow-[0_18px_40px_rgba(0,0,0,0.6)] backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-white/10 px-2 py-1.5">
        <div className="flex items-center gap-2">
          <Terminal size={12} />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/85">
            Network · /api
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/45">
            {stats.total} req · {stats.pending} pending · {stats.failed} failed ·{' '}
            {stats.unavailable} unavail
          </span>
        </div>
        <div className="flex items-center gap-1">
          <FilterBtn label="all" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterBtn
            label="errors"
            active={filter === 'errors'}
            onClick={() => setFilter('errors')}
          />
          <FilterBtn label="slow" active={filter === 'slow'} onClick={() => setFilter('slow')} />
          <button
            type="button"
            onClick={clear}
            className="rounded border border-white/15 p-1 text-white/70 hover:bg-white/[0.1] hover:text-white"
            title="Clear log"
          >
            <Trash2 size={11} />
          </button>
          <button
            type="button"
            onClick={toggleOpen}
            className="rounded border border-white/15 p-1 text-white/70 hover:bg-white/[0.1] hover:text-white"
            title="Close debug panel"
          >
            <X size={11} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        <ul className="flex-1 overflow-y-auto divide-y divide-white/[0.06]">
          {filtered.length === 0 && (
            <li className="px-2 py-4 text-center font-mono text-[10px] uppercase tracking-[0.08em] text-white/40">
              No requests yet.
            </li>
          )}
          {filtered.map((e) => (
            <Row
              key={e.id}
              entry={e}
              selected={selectedId === e.id}
              onClick={() => setSelectedId(selectedId === e.id ? null : e.id)}
            />
          ))}
        </ul>

        {selected && (
          <DetailPane entry={selected} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </div>
  );
}

function statusBadge(e: DebugEntry): { color: string; label: string } {
  if (e.error) return { color: 'bg-red-500 text-black', label: 'ERR' };
  if (e.status == null) return { color: 'bg-white/20 text-white/80', label: '…' };
  if (e.status >= 500) return { color: 'bg-red-500 text-black', label: String(e.status) };
  if (e.status >= 400) return { color: 'bg-orange-400 text-black', label: String(e.status) };
  if (e.metaStatus === 'unavailable')
    return { color: 'bg-amber-300 text-black', label: 'UNAVAIL' };
  if (e.metaStatus === 'partial') return { color: 'bg-amber-300 text-black', label: 'PARTIAL' };
  if (e.metaStatus === 'error') return { color: 'bg-orange-400 text-black', label: 'M:ERR' };
  if (e.status >= 200 && e.status < 300) return { color: 'bg-emerald-400 text-black', label: String(e.status) };
  return { color: 'bg-white/30 text-white', label: String(e.status) };
}

function Row({
  entry,
  selected,
  onClick,
}: {
  entry: DebugEntry;
  selected: boolean;
  onClick: () => void;
}) {
  const b = statusBadge(entry);
  const ts = new Date(entry.startedAt);
  const time = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}:${String(ts.getSeconds()).padStart(2, '0')}`;
  const dur =
    entry.durationMs == null ? '…' : entry.durationMs >= 1000 ? `${(entry.durationMs / 1000).toFixed(2)}s` : `${entry.durationMs}ms`;
  const slow = (entry.durationMs ?? 0) > 1000;

  return (
    <li
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 px-2 py-1 font-mono text-[10px] hover:bg-white/[0.05] ${
        selected ? 'bg-white/[0.08]' : ''
      }`}
    >
      <span className="w-14 shrink-0 text-white/45">{time}</span>
      <span
        className={`shrink-0 rounded px-1 py-[1px] text-[9px] font-bold uppercase tracking-[0.04em] ${b.color}`}
      >
        {b.label}
      </span>
      <span className="w-10 shrink-0 text-white/70">{entry.method}</span>
      <span className="flex-1 truncate text-white/90" title={entry.path + entry.query}>
        {entry.path}
        <span className="text-white/40">{entry.query}</span>
      </span>
      <span className={`shrink-0 ${slow ? 'text-amber-300' : 'text-white/55'}`}>{dur}</span>
    </li>
  );
}

function DetailPane({ entry, onClose }: { entry: DebugEntry; onClose: () => void }) {
  return (
    <aside className="max-h-[40%] shrink-0 overflow-y-auto border-t border-white/10 bg-black/60 p-2 font-mono text-[10px] text-white/85">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-[0.1em] text-white/65">Detail</span>
        <button
          onClick={onClose}
          className="rounded border border-white/15 p-0.5 text-white/55 hover:bg-white/[0.1] hover:text-white"
        >
          <X size={10} />
        </button>
      </div>
      <Field label="method" value={entry.method} />
      <Field label="path" value={entry.path} />
      {entry.query && <Field label="query" value={entry.query.slice(1)} />}
      <Field label="status" value={entry.status != null ? String(entry.status) : 'pending'} />
      {entry.metaStatus && <Field label="meta.status" value={entry.metaStatus} />}
      {entry.metaReason && <Field label="meta.reason" value={entry.metaReason} wrap />}
      <Field
        label="duration"
        value={entry.durationMs != null ? `${entry.durationMs} ms` : '—'}
      />
      {entry.responseBytes != null && (
        <Field label="bytes" value={String(entry.responseBytes)} />
      )}
      {entry.error && <Field label="error" value={entry.error} wrap />}
      <Field
        label="started"
        value={new Date(entry.startedAt).toISOString().replace('T', ' ').slice(0, 19) + 'Z'}
      />
    </aside>
  );
}

function Field({ label, value, wrap }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="mb-1.5 leading-tight">
      <div className="text-[9px] uppercase tracking-[0.06em] text-white/45">{label}</div>
      <div className={wrap ? 'break-words text-white/90' : 'truncate text-white/90'} title={value}>
        {value}
      </div>
    </div>
  );
}

function FilterBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${
        active
          ? 'border-white bg-white text-black'
          : 'border-white/15 text-white/65 hover:bg-white/[0.08] hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

