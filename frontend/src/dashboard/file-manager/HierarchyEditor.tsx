/**
 * HierarchyEditor — modal form for setting rank / unit / commander / parent
 * on the active file. Persists via fsUpdateMetadata and reflects back into
 * the open-tab state.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Save, Shield } from 'lucide-react';
import { fsGetTree, fsUpdateMetadata } from '../../api/client';
import {
  type Rank,
  type FsFileMeta,
  RANK_LEVELS,
  RANK_NAMES,
} from '../../api/types';
import { useOpenFilesStore, useToastStore, type OpenFileTab } from '../../store';

export interface HierarchyEditorProps {
  tab: OpenFileTab;
  onClose: () => void;
}

export default function HierarchyEditor({ tab, onClose }: HierarchyEditorProps) {
  const push = useToastStore((s) => s.push);
  const patchTab = useOpenFilesStore((s) => s.patchTab);

  const [rank, setRank] = useState<Rank>(tab.rank);
  const [unit, setUnit] = useState<string>(tab.unit);
  const [commanderName, setCommanderName] = useState<string>(tab.commanderName);
  const [parentFileId, setParentFileId] = useState<string | null>(tab.parentFileId);
  const [saving, setSaving] = useState(false);

  // ESC closes the modal
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Tree query gives us candidate parents — only files outranking the chosen
  // rank may be set as parent.
  const { data: tree } = useQuery({ queryKey: ['fs-tree'], queryFn: fsGetTree, staleTime: 10_000 });
  const allFiles: FsFileMeta[] = tree?.files ?? [];

  const eligibleParents = allFiles
    .filter((f) => f.id !== tab.id)
    .filter((f) => {
      const fRank = (f.rank ?? 3) as number;
      return fRank > rank;
    })
    .sort((a, b) => ((b.rank ?? 3) - (a.rank ?? 3)));

  // Clear parent if rank change made it ineligible
  useEffect(() => {
    if (!parentFileId) return;
    const p = allFiles.find((f) => f.id === parentFileId);
    if (!p) return;
    if (((p.rank ?? 3) as number) <= rank) {
      setParentFileId(null);
    }
  }, [rank, parentFileId, allFiles]);

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await fsUpdateMetadata(tab.id, {
        rank,
        unit: unit.trim(),
        commander_name: commanderName.trim(),
        parent_file_id: parentFileId,
      });
      patchTab(tab.id, {
        rank,
        unit: unit.trim(),
        commanderName: commanderName.trim(),
        parentFileId,
      });
      push('success', `Hierarchy updated: ${updated.name}`);
      onClose();
    } catch (e) {
      push('error', `Update failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-[420px] rounded-sm border shadow-[0_16px_48px_rgba(0,0,0,0.9)]"
        style={{ background: '#131313', borderColor: '#393939' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: '#393939' }}>
          <div className="flex items-center gap-2">
            <Shield size={12} className="text-white/60" />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/65">Command Hierarchy</span>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white"><X size={12} /></button>
        </div>

        <div className="p-3 space-y-3">
          {/* File context */}
          <div className="rounded-sm border px-2.5 py-1.5" style={{ borderColor: '#393939', background: '#1a1a1a' }}>
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-white/35">Editing</p>
            <p className="truncate font-mono text-[11px] font-semibold text-white">{tab.name}</p>
          </div>

          {/* Rank */}
          <div>
            <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">
              Echelon (rank)
            </label>
            <div className="grid grid-cols-7 gap-1">
              {RANK_LEVELS.map(({ rank: r, name }) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRank(r)}
                  title={name}
                  className="rounded-sm border py-1 font-mono text-[10px] uppercase transition"
                  style={{
                    borderColor: rank === r ? '#fff' : '#393939',
                    background: rank === r ? '#fff' : '#1a1a1a',
                    color: rank === r ? '#131313' : 'rgba(255,255,255,0.45)',
                    fontWeight: rank === r ? 700 : 400,
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <p className="mt-1 font-mono text-[9px] text-white/35">
              {RANK_NAMES[rank]} ({rank} of 7)
            </p>
          </div>

          {/* Unit name */}
          <div>
            <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">
              Unit designation
            </label>
            <input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. 1 Platoon, Alpha Co, 2 BTN"
              className="w-full rounded-sm border px-2 py-1.5 font-mono text-[11px] text-white placeholder-white/25 outline-none focus:border-white/60"
              style={{ background: '#1a1a1a', borderColor: '#393939' }}
            />
          </div>

          {/* Commander name */}
          <div>
            <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">
              Commander
            </label>
            <input
              type="text"
              value={commanderName}
              onChange={(e) => setCommanderName(e.target.value)}
              placeholder="e.g. LT Park, CPT Jones"
              className="w-full rounded-sm border px-2 py-1.5 font-mono text-[11px] text-white placeholder-white/25 outline-none focus:border-white/60"
              style={{ background: '#1a1a1a', borderColor: '#393939' }}
            />
          </div>

          {/* Parent file */}
          <div>
            <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">
              Reports to (higher commander's file)
            </label>
            <select
              value={parentFileId ?? ''}
              onChange={(e) => setParentFileId(e.target.value || null)}
              className="w-full rounded-sm border px-2 py-1.5 font-mono text-[11px] text-white outline-none focus:border-white/60"
              style={{ background: '#1a1a1a', borderColor: '#393939' }}
            >
              <option value="">— No parent (top of chain) —</option>
              {eligibleParents.map((f) => {
                const rName = RANK_NAMES[(f.rank ?? 3) as Rank] ?? 'Platoon';
                const tag = f.unit ? ` · ${f.unit}` : '';
                return (
                  <option key={f.id} value={f.id}>
                    {f.name} [{rName}{tag}]
                  </option>
                );
              })}
            </select>
            <p className="mt-1 font-mono text-[9px] text-white/30">
              Only files outranking <strong>{RANK_NAMES[rank]}</strong> can be a parent
              {eligibleParents.length === 0 && ' — none available'}
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-sm py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition disabled:opacity-40"
              style={{ background: '#fff', color: '#131313' }}
            >
              {saving
                ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                : <Save size={11} />}
              Save
            </button>
            <button
              onClick={onClose}
              className="rounded-sm border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/50 hover:text-white"
              style={{ borderColor: '#393939' }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
