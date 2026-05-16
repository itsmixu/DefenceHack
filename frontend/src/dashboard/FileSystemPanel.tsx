/**
 * FileSystemPanel — Tactile Noir file manager for IPB operation files.
 *
 * Surface: #131313   Borders: #393939   Active: bg-white text-black
 * Monospace, uppercase, all-caps labels — no glassmorphism.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Edit2,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Layers,
  MapPin,
  MoreHorizontal,
  Save,
  Search,
  Trash2,
  Upload,
  X,
  FilePlus,
} from 'lucide-react';
import {
  fsDuplicateFile,
  fsDeleteFile,
  fsCreateFolder,
  fsRenameFolder,
  fsDeleteFolder,
  fsExportDownload,
  fsGetRecent,
  fsGetTree,
  fsImportFile,
  fsOpenFile,
  fsRenameFile,
  fsSaveFile,
  fsSearch,
} from '../api/client';
import type { DrawnFeature, FsFileMeta, FsFolder, IpbExportV2, LayerKey, Phase } from '../api/types';
import type { FeatureCollection, Feature } from 'geojson';
import {
  parseBbox,
  useBboxStore,
  useDrawnStore,
  useFeatureCacheStore,
  useLayerStore,
  useMapStore,
  useTimelineStore,
  useToastStore,
} from '../store';

// ── Constants ──────────────────────────────────────────────────────────────────

const ALL_LAYER_KEYS: LayerKey[] = [
  'osm', 'digiroad', 'mml', 'mml_contours', 'statfin',
  'syke', 'fmi', 'fmi_forecast', 'astronomy',
  'opencellid', 'starlink', 'exposure', 'mcoo',
];

const PHASE_COLORS = [
  '#3b82f6', '#22c55e', '#ef4444',
  '#f59e0b', '#8b5cf6', '#06b6d4',
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function makeEmptyPhase(id: number): Phase {
  return {
    id,
    name: `Phase ${id}`,
    color: PHASE_COLORS[(id - 1) % PHASE_COLORS.length],
    notes: '',
    active_layers: [],
    drawn_features: { type: 'FeatureCollection', features: [] },
    layer_snapshots: {},
    conditions: {},
  };
}

interface ActiveFile {
  id: string;
  name: string;
  activePhaseId: number;
  phases: Phase[];
}

// ── Inline rename input ────────────────────────────────────────────────────────

function InlineRename({ initial, onConfirm, onCancel }: {
  initial: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => (val.trim() ? onConfirm(val.trim()) : onCancel())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && val.trim()) onConfirm(val.trim());
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] text-white outline-none"
      style={{ background: '#1a1a1a', borderColor: '#fff' }}
    />
  );
}

// ── Context menu ───────────────────────────────────────────────────────────────

interface MenuItem { label: string; icon: React.ReactNode; danger?: boolean; onClick: () => void; }

function CtxMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-0.5 min-w-[170px] rounded-sm border py-0.5 shadow-[0_8px_24px_rgba(0,0,0,0.8)]"
      style={{ background: '#1a1a1a', borderColor: '#393939' }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-[0.08em] transition hover:bg-white/[0.07] ${
            item.danger ? 'text-red-400' : 'text-white/75'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── File row ───────────────────────────────────────────────────────────────────

function FileRow({ file, indent, isOpen, openingId, onOpen, onRename, onDuplicate, onDelete, onExport }: {
  file: FsFileMeta;
  indent: number;
  isOpen: boolean;
  openingId: string | null;
  onOpen: (f: FsFileMeta) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  onExport: (id: string, name: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const loading = openingId === file.id;

  const menu: MenuItem[] = [
    { label: 'Rename',    icon: <Edit2 size={10} />,  onClick: () => setRenaming(true) },
    { label: 'Duplicate', icon: <Copy size={10} />,   onClick: () => onDuplicate(file.id) },
    { label: 'Export',    icon: <Download size={10} />, onClick: () => onExport(file.id, file.name) },
    { label: 'Delete',    icon: <Trash2 size={10} />, danger: true, onClick: () => onDelete(file.id, file.name) },
  ];

  return (
    <div
      style={{ paddingLeft: `${indent * 14 + 8}px` }}
      title={`${fmtFull(file.updated_at)} · ${file.layer_count} layers · ${file.feature_count} features`}
      onClick={() => !renaming && onOpen(file)}
      className={`group relative flex cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-1 text-[11px] transition ${
        isOpen
          ? 'bg-white text-black'
          : 'text-white/80 hover:bg-white/[0.06]'
      } ${loading ? 'opacity-60' : ''}`}
    >
      {loading ? (
        <span className="ml-2 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
      ) : (
        <FileText
          size={11}
          className={`ml-2 shrink-0 ${isOpen ? 'text-black/70' : 'text-white/40'}`}
        />
      )}

      <div className="min-w-0 flex-1 overflow-hidden">
        {renaming ? (
          <InlineRename
            initial={file.name}
            onConfirm={(n) => { onRename(file.id, n); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className={`block truncate font-mono text-[11px] ${isOpen ? 'font-semibold' : ''}`}>
            {file.name}
          </span>
        )}
      </div>

      {!renaming && (
        <>
          <span className={`shrink-0 font-mono text-[9px] group-hover:hidden ${isOpen ? 'text-black/50' : 'text-white/30'}`}>
            {fmtRelative(file.updated_at)}
          </span>
          <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
            {file.layer_count > 0 && (
              <span className={`flex items-center gap-0.5 font-mono text-[9px] ${isOpen ? 'text-black/50' : 'text-white/35'}`}>
                <Layers size={8} />{file.layer_count}
              </span>
            )}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                className={`rounded-sm p-0.5 transition ${isOpen ? 'text-black/60 hover:bg-black/10' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
              >
                <MoreHorizontal size={12} />
              </button>
              {menuOpen && <CtxMenu items={menu} onClose={() => setMenuOpen(false)} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Folder row ─────────────────────────────────────────────────────────────────

function FolderRow({ folder, indent, expanded, onToggle, onRename, onDelete, onNewSub }: {
  folder: FsFolder;
  indent: number;
  expanded: boolean;
  onToggle: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
  onNewSub: (parentId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const menu: MenuItem[] = [
    { label: 'New subfolder', icon: <FolderPlus size={10} />, onClick: () => onNewSub(folder.id) },
    { label: 'Rename',        icon: <Edit2 size={10} />,      onClick: () => setRenaming(true) },
    { label: 'Delete folder', icon: <Trash2 size={10} />,     danger: true, onClick: () => onDelete(folder.id, folder.name) },
  ];

  return (
    <div
      style={{ paddingLeft: `${indent * 14 + 4}px` }}
      onClick={() => !renaming && onToggle()}
      className="group relative flex cursor-pointer items-center gap-1.5 rounded-sm py-1.5 pr-1 text-[11px] transition hover:bg-white/[0.05]"
    >
      <span className="shrink-0 text-white/40">
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </span>
      {expanded
        ? <FolderOpen size={11} className="shrink-0 text-amber-400/80" />
        : <Folder size={11} className="shrink-0 text-amber-400/60" />}

      <div className="min-w-0 flex-1 overflow-hidden">
        {renaming ? (
          <InlineRename
            initial={folder.name}
            onConfirm={(n) => { onRename(folder.id, n); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="block truncate font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-white/70">
            {folder.name}
          </span>
        )}
      </div>

      {!renaming && (
        <div className="relative opacity-0 transition group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="rounded-sm p-0.5 text-white/40 hover:bg-white/10 hover:text-white"
          >
            <MoreHorizontal size={12} />
          </button>
          {menuOpen && <CtxMenu items={menu} onClose={() => setMenuOpen(false)} />}
        </div>
      )}
    </div>
  );
}

// ── New folder input ───────────────────────────────────────────────────────────

function NewFolderInput({ indent, value, onChange, onConfirm, onCancel }: {
  indent: number;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div style={{ paddingLeft: `${indent * 14 + 4}px` }} className="flex items-center gap-1.5 py-1 pr-1">
      <Folder size={11} className="shrink-0 text-amber-400/70" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) onConfirm();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Folder name…"
        className="min-w-0 flex-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] text-white placeholder-white/30 outline-none"
        style={{ background: '#1a1a1a', borderColor: '#393939' }}
      />
      <button onClick={onConfirm} disabled={!value.trim()}
        className="rounded-sm p-0.5 text-emerald-400 disabled:opacity-30 hover:bg-white/[0.06]">
        <Check size={11} />
      </button>
      <button onClick={onCancel} className="rounded-sm p-0.5 text-white/40 hover:bg-white/[0.06]">
        <X size={11} />
      </button>
    </div>
  );
}

// ── Save dialog ────────────────────────────────────────────────────────────────

function SaveDialog({ defaultName, folders, onSave, onCancel, saving }: {
  defaultName: string;
  folders: FsFolder[];
  onSave: (name: string, folderId: string | null, phaseCount: number) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(defaultName);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [phaseCount, setPhaseCount] = useState(1);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <div className="rounded-sm border shadow-[0_8px_32px_rgba(0,0,0,0.8)]" style={{ background: '#131313', borderColor: '#393939' }}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: '#393939' }}>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">New Project File</span>
        <button onClick={onCancel} className="text-white/30 hover:text-white/70"><X size={12} /></button>
      </div>

      <div className="p-3 space-y-3">
        {/* File name */}
        <div>
          <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">File name</label>
          <input
            ref={ref}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onSave(name.trim(), folderId, phaseCount);
              if (e.key === 'Escape') onCancel();
            }}
            placeholder="Mission name…"
            className="w-full rounded-sm border px-2 py-1.5 font-mono text-[12px] text-white placeholder-white/25 outline-none focus:border-white/60"
            style={{ background: '#1a1a1a', borderColor: '#393939' }}
          />
        </div>

        {/* Folder selector */}
        {folders.length > 0 && (
          <div>
            <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">Folder</label>
            <select
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="w-full rounded-sm border px-2 py-1.5 font-mono text-[11px] text-white outline-none"
              style={{ background: '#1a1a1a', borderColor: '#393939' }}
            >
              <option value="">Root — no folder</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}

        {/* Phase count */}
        <div>
          <label className="mb-1.5 block font-mono text-[9px] uppercase tracking-[0.1em] text-white/40">
            Phases — current state saves to Phase 1
          </label>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setPhaseCount(n)}
                className="h-8 flex-1 rounded-sm border font-mono text-[11px] font-semibold transition"
                style={{
                  borderColor: phaseCount === n ? '#fff' : '#393939',
                  background: phaseCount === n ? '#fff' : '#1a1a1a',
                  color: phaseCount === n ? '#131313' : 'rgba(255,255,255,0.55)',
                }}
              >
                {n}
              </button>
            ))}
          </div>
          {phaseCount > 1 && (
            <p className="mt-1 font-mono text-[9px] text-white/30">
              +{phaseCount - 1} empty phase{phaseCount > 2 ? 's' : ''} — snapshot them later
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => name.trim() && onSave(name.trim(), folderId, phaseCount)}
            disabled={saving || !name.trim()}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-sm py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition disabled:opacity-40"
            style={{ background: '#fff', color: '#131313' }}
          >
            {saving
              ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/20 border-t-black" />
              : <Save size={11} />}
            Save
          </button>
          <button
            onClick={onCancel}
            className="rounded-sm border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-white/50 transition hover:text-white/80"
            style={{ borderColor: '#393939' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Active file panel ──────────────────────────────────────────────────────────

function ActiveFilePanel({ activeFile, onSwitchPhase, onSnapshot, onSaveFile, onExport, onClose, saving }: {
  activeFile: ActiveFile;
  onSwitchPhase: (phaseId: number) => void;
  onSnapshot: () => void;
  onSaveFile: () => void;
  onExport: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const activePhase = activeFile.phases.find((p) => p.id === activeFile.activePhaseId);
  const phaseColor = activePhase?.color ?? '#3b82f6';

  return (
    <div className="rounded-sm border" style={{ background: '#131313', borderColor: '#393939' }}>
      {/* File name header */}
      <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: '#393939' }}>
        <FileText size={11} className="shrink-0 text-white/50" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-white">
          {activeFile.name}
        </span>
        <button
          onClick={onClose}
          title="Close file"
          className="shrink-0 text-white/30 hover:text-white/70"
        >
          <X size={11} />
        </button>
      </div>

      {/* Phase selector */}
      <div className="border-b px-2 py-2" style={{ borderColor: '#393939' }}>
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/35">Phases</p>
        <div className="flex flex-wrap gap-1">
          {activeFile.phases.map((ph) => {
            const isActive = ph.id === activeFile.activePhaseId;
            return (
              <button
                key={ph.id}
                onClick={() => onSwitchPhase(ph.id)}
                className="rounded-sm border px-2.5 py-1 font-mono text-[10px] transition"
                style={{
                  borderColor: isActive ? ph.color ?? '#3b82f6' : '#393939',
                  background: isActive ? (ph.color ?? '#3b82f6') + '22' : '#1a1a1a',
                  color: isActive ? ph.color ?? '#3b82f6' : 'rgba(255,255,255,0.45)',
                  fontWeight: isActive ? 700 : 400,
                }}
              >
                {ph.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 px-2 py-2">
        <button
          onClick={onSnapshot}
          title="Capture current map state into the active phase"
          className="flex flex-1 items-center justify-center gap-1 rounded-sm border py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/55 transition hover:text-white"
          style={{ borderColor: '#393939', background: '#1a1a1a' }}
        >
          <Camera size={10} />
          Snapshot
        </button>

        <button
          onClick={onSaveFile}
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-1 rounded-sm border py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] transition disabled:opacity-40"
          style={{ borderColor: '#fff', background: '#fff', color: '#131313' }}
        >
          {saving
            ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
            : <Save size={10} />}
          Save
        </button>

        <button
          onClick={onExport}
          title="Download as .ipb.json"
          className="flex items-center gap-1 rounded-sm border px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/50 transition hover:text-white"
          style={{ borderColor: '#393939', background: '#1a1a1a' }}
        >
          <Download size={10} />
          Export
        </button>
      </div>
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────────────────────

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pb-1">
      <span className="text-white/35">{icon}</span>
      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">{label}</span>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export default function FileSystemPanel() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);

  const bbox            = useBboxStore((s) => s.bbox);
  const drawnFeatures   = useDrawnStore((s) => s.toCollection());
  const setAllDrawn     = useDrawnStore((s) => s.setAll);
  const activeLayers    = useLayerStore((s) => s.active);
  const setActiveLayers = useLayerStore((s) => s.setActiveLayers);
  const featureCache    = useFeatureCacheStore((s) => s.features);
  const injectSnapshots = useFeatureCacheStore((s) => s.injectSnapshots);
  const clearAllCache   = useFeatureCacheStore((s) => s.clearAll);
  const selectedMs      = useTimelineStore((s) => s.selectedMs);
  const setSelectedMs   = useTimelineStore((s) => s.setSelectedMs);
  const map             = useMapStore((s) => s.map);

  const [activeFile, setActiveFile]           = useState<ActiveFile | null>(null);
  const [showSaveDialog, setShowSaveDialog]   = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery]         = useState('');
  const [openingId, setOpeningId]             = useState<string | null>(null);
  const [saving, setSaving]                   = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName]     = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['fs-tree'],
    queryFn: fsGetTree,
    staleTime: 10_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['fs-recent'],
    queryFn: () => fsGetRecent(6),
    staleTime: 10_000,
  });

  const { data: searchResults } = useQuery({
    queryKey: ['fs-search', searchQuery],
    queryFn: () => fsSearch(searchQuery),
    enabled: searchQuery.length >= 2,
    staleTime: 5_000,
  });

  const refetchAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['fs-tree'] });
    qc.invalidateQueries({ queryKey: ['fs-recent'] });
    qc.invalidateQueries({ queryKey: ['fs-search'] });
  }, [qc]);

  // ── Capture current map state ────────────────────────────────────────────────

  const captureCurrentState = useCallback((): Partial<Phase> => {
    const snapshots: Record<string, FeatureCollection> = {};
    for (const k of ALL_LAYER_KEYS) {
      const feats = featureCache[k];
      if (feats && feats.length > 0) {
        snapshots[k] = { type: 'FeatureCollection', features: feats };
      }
    }
    const activeIds = ALL_LAYER_KEYS.filter((k) => activeLayers[k]);
    let center: [number, number] | null = null;
    let zoom: number | null = null;
    if (map) {
      const c = map.getCenter();
      center = [c.lat, c.lng];
      zoom = map.getZoom();
    }
    const bboxArr = bbox ? (parseBbox(bbox) as [number, number, number, number]) : null;
    return {
      bbox: bboxArr,
      center,
      zoom,
      timeline_selected_ms: selectedMs,
      active_layers: activeIds,
      drawn_features: drawnFeatures,
      layer_snapshots: snapshots,
    };
  }, [featureCache, activeLayers, bbox, drawnFeatures, map, selectedMs]);

  // ── Load a phase into the map ────────────────────────────────────────────────

  const loadPhaseIntoMap = useCallback((ph: Phase) => {
    clearAllCache();
    if (ph.layer_snapshots && Object.keys(ph.layer_snapshots).length > 0) {
      injectSnapshots(
        ph.layer_snapshots as Record<string, { features: Feature[] }>,
        ph.bbox ?? undefined,
      );
    }
    setActiveLayers((ph.active_layers ?? []) as LayerKey[]);
    setAllDrawn((ph.drawn_features?.features ?? []) as DrawnFeature[]);
    if (ph.timeline_selected_ms != null) setSelectedMs(ph.timeline_selected_ms);
    if (map) {
      if (ph.bbox) {
        const [w, s, e, n] = ph.bbox;
        map.fitBounds([[s, w], [n, e]], { animate: true, duration: 0.6 });
      } else if (ph.center && ph.zoom != null) {
        map.flyTo([ph.center[0], ph.center[1]], ph.zoom, { animate: true, duration: 0.6 });
      }
    }
  }, [clearAllCache, injectSnapshots, setActiveLayers, setAllDrawn, setSelectedMs, map]);

  // ── Open file ────────────────────────────────────────────────────────────────

  const handleOpen = useCallback(async (file: FsFileMeta) => {
    setOpeningId(file.id);
    try {
      const content = await fsOpenFile(file.id);
      let phases: Phase[] = (content.phases ?? []) as Phase[];
      if (phases.length === 0) {
        phases = [{
          id: 1,
          name: 'Phase 1',
          color: PHASE_COLORS[0],
          notes: content.notes ?? '',
          bbox: content.bbox ?? null,
          center: content.center ?? null,
          zoom: content.zoom ?? null,
          timeline_selected_ms: content.timeline_selected_ms ?? null,
          active_layers: content.active_layers ?? [],
          drawn_features: content.drawn_features ?? { type: 'FeatureCollection', features: [] },
          layer_snapshots: (content.layer_snapshots as Record<string, FeatureCollection>) ?? {},
          conditions: content.conditions ?? {},
        }];
      }
      const activePhaseId = content.current_phase ?? phases[0]?.id ?? 1;
      const activePhase = phases.find((p) => p.id === activePhaseId) ?? phases[0];
      if (activePhase) loadPhaseIntoMap(activePhase);
      setActiveFile({ id: content.id, name: content.name, activePhaseId: activePhase?.id ?? 1, phases });
      push('success', `Opened: ${content.name}`);
    } catch (e) {
      push('error', `Failed to open: ${String(e)}`);
    } finally {
      setOpeningId(null);
    }
  }, [loadPhaseIntoMap, push]);

  // ── Switch phase ─────────────────────────────────────────────────────────────

  const handleSwitchPhase = useCallback((newPhaseId: number) => {
    if (!activeFile || newPhaseId === activeFile.activePhaseId) return;
    const currentState = captureCurrentState();
    const updatedPhases = activeFile.phases.map((p) =>
      p.id === activeFile.activePhaseId ? { ...p, ...currentState } : p
    );
    const newPhase = updatedPhases.find((p) => p.id === newPhaseId);
    if (newPhase) loadPhaseIntoMap(newPhase);
    setActiveFile({ ...activeFile, phases: updatedPhases, activePhaseId: newPhaseId });
  }, [activeFile, captureCurrentState, loadPhaseIntoMap]);

  // ── Snapshot ─────────────────────────────────────────────────────────────────

  const handleSnapshot = useCallback(() => {
    if (!activeFile) return;
    const currentState = captureCurrentState();
    const updatedPhases = activeFile.phases.map((p) =>
      p.id === activeFile.activePhaseId ? { ...p, ...currentState } : p
    );
    setActiveFile({ ...activeFile, phases: updatedPhases });
    push('info', `Phase ${activeFile.activePhaseId} snapshot captured — click Save to persist.`);
  }, [activeFile, captureCurrentState, push]);

  // ── Save active file ─────────────────────────────────────────────────────────

  const handleSaveActiveFile = useCallback(async () => {
    if (!activeFile) return;
    setSaving(true);
    try {
      const currentState = captureCurrentState();
      const phases = activeFile.phases.map((p) =>
        p.id === activeFile.activePhaseId ? { ...p, ...currentState } : p
      );
      const activePh = phases.find((p) => p.id === activeFile.activePhaseId) ?? phases[0];
      const snapshots: Record<string, FeatureCollection> = {};
      if (activePh?.layer_snapshots) {
        for (const [k, v] of Object.entries(activePh.layer_snapshots)) {
          snapshots[k] = v;
        }
      }
      await fsSaveFile({
        id: activeFile.id,
        name: activeFile.name,
        bbox: activePh?.bbox ?? null,
        center: activePh?.center ?? null,
        zoom: activePh?.zoom ?? null,
        timeline_selected_ms: activePh?.timeline_selected_ms ?? null,
        active_layers: activePh?.active_layers ?? [],
        drawn_features: activePh?.drawn_features ?? { type: 'FeatureCollection', features: [] },
        layer_snapshots: snapshots,
        phases: phases as Phase[],
        current_phase: activeFile.activePhaseId,
      });
      setActiveFile({ ...activeFile, phases });
      push('success', `Saved: ${activeFile.name}`);
      refetchAll();
    } catch (e) {
      push('error', `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [activeFile, captureCurrentState, push, refetchAll]);

  // ── Save new file ─────────────────────────────────────────────────────────────

  const handleSaveNew = useCallback(async (name: string, folderId: string | null, phaseCount: number) => {
    setSaving(true);
    try {
      const currentState = captureCurrentState();
      const phase1: Phase = {
        id: 1, name: 'Phase 1',
        color: PHASE_COLORS[0], notes: '',
        ...currentState,
        drawn_features: (currentState.drawn_features as FeatureCollection) ?? { type: 'FeatureCollection', features: [] },
        active_layers: (currentState.active_layers as string[]) ?? [],
      };
      const phases: Phase[] = [
        phase1,
        ...Array.from({ length: phaseCount - 1 }, (_, i) => makeEmptyPhase(i + 2)),
      ];
      const snapshots: Record<string, FeatureCollection> = (phase1.layer_snapshots as Record<string, FeatureCollection>) ?? {};
      const meta = await fsSaveFile({
        name, folder_id: folderId,
        bbox: phase1.bbox ?? null,
        center: phase1.center ?? null,
        zoom: phase1.zoom ?? null,
        timeline_selected_ms: phase1.timeline_selected_ms ?? null,
        active_layers: phase1.active_layers,
        drawn_features: phase1.drawn_features,
        layer_snapshots: snapshots,
        phases, current_phase: 1,
      });
      setShowSaveDialog(false);
      setActiveFile({ id: meta.id, name: meta.name, activePhaseId: 1, phases });
      push('success', `Saved: ${name}${phaseCount > 1 ? ` (${phaseCount} phases)` : ''}`);
      refetchAll();
    } catch (e) {
      push('error', `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [captureCurrentState, push, refetchAll]);

  // ── Export ───────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async (id: string, name: string) => {
    try {
      await fsExportDownload(id, name);
      push('success', `Exported: ${name}.ipb.json`);
    } catch (e) {
      push('error', `Export failed: ${String(e)}`);
    }
  }, [push]);

  // ── Import ───────────────────────────────────────────────────────────────────

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text) as IpbExportV2;
      if (data.format !== 'ipb-operation') {
        push('error', 'Not a valid .ipb.json file.');
        return;
      }
      const meta = await fsImportFile(data);
      push('success', `Imported: ${meta.name}`);
      refetchAll();
    } catch (err) {
      push('error', `Import failed: ${String(err)}`);
    }
  }, [push, refetchAll]);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const renameMut       = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => fsRenameFile(id, name), onSuccess: refetchAll, onError: () => push('error', 'Rename failed') });
  const duplicateMut    = useMutation({ mutationFn: (id: string) => fsDuplicateFile(id), onSuccess: (f) => { refetchAll(); push('success', `Duplicated: ${f.name}`); }, onError: () => push('error', 'Duplicate failed') });
  const deleteFileMut   = useMutation({ mutationFn: (id: string) => fsDeleteFile(id), onSuccess: () => { refetchAll(); push('info', 'File deleted'); }, onError: () => push('error', 'Delete failed') });
  const renameFolderMut = useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => fsRenameFolder(id, name), onSuccess: refetchAll, onError: () => push('error', 'Rename failed') });
  const deleteFolderMut = useMutation({ mutationFn: ({ id, recursive }: { id: string; recursive: boolean }) => fsDeleteFolder(id, recursive), onSuccess: () => { refetchAll(); push('info', 'Folder deleted'); }, onError: (e) => push('error', String(e)) });
  const createFolderMut = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: string | null }) => fsCreateFolder(name, parentId),
    onSuccess: (f) => {
      refetchAll();
      if (f.parent_id) setExpandedFolders((s) => new Set([...s, f.parent_id!]));
      setNewFolderParent(undefined);
      setNewFolderName('');
      push('success', `Created: ${f.name}`);
    },
    onError: () => push('error', 'Create folder failed'),
  });

  const handleDeleteFile   = useCallback((id: string, name: string) => { if (window.confirm(`Delete "${name}"? This cannot be undone.`)) deleteFileMut.mutate(id); }, [deleteFileMut]);
  const handleDeleteFolder = useCallback((id: string, name: string) => { if (window.confirm(`Delete folder "${name}" and all its contents?`)) deleteFolderMut.mutate({ id, recursive: true }); }, [deleteFolderMut]);

  // ── Tree rendering ────────────────────────────────────────────────────────────

  const folders = tree?.folders ?? [];
  const files   = tree?.files ?? [];

  const toggleFolder = (id: string) =>
    setExpandedFolders((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function renderTree(parentId: string | null, depth: number): React.ReactNode {
    const childFolders = folders.filter((f) => f.parent_id === parentId);
    const childFiles   = files.filter((f) => f.folder_id === parentId);
    return (
      <>
        {childFolders.map((folder) => (
          <div key={folder.id}>
            <FolderRow
              folder={folder}
              indent={depth}
              expanded={expandedFolders.has(folder.id)}
              onToggle={() => toggleFolder(folder.id)}
              onRename={(id, name) => renameFolderMut.mutate({ id, name })}
              onDelete={handleDeleteFolder}
              onNewSub={(pid) => { setNewFolderParent(pid); setExpandedFolders((s) => new Set([...s, pid])); }}
            />
            {expandedFolders.has(folder.id) && (
              <div>
                {renderTree(folder.id, depth + 1)}
                {newFolderParent === folder.id && (
                  <NewFolderInput
                    indent={depth + 1}
                    value={newFolderName}
                    onChange={setNewFolderName}
                    onConfirm={() => newFolderName.trim() && createFolderMut.mutate({ name: newFolderName.trim(), parentId: folder.id })}
                    onCancel={() => { setNewFolderParent(undefined); setNewFolderName(''); }}
                  />
                )}
              </div>
            )}
          </div>
        ))}
        {childFiles.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            indent={depth}
            isOpen={activeFile?.id === file.id}
            openingId={openingId}
            onOpen={handleOpen}
            onRename={(id, name) => renameMut.mutate({ id, name })}
            onDuplicate={(id) => duplicateMut.mutate(id)}
            onDelete={handleDeleteFile}
            onExport={handleExport}
          />
        ))}
      </>
    );
  }

  const isSearching = searchQuery.length >= 2;

  return (
    <div className="flex h-full flex-col gap-2.5">
      {/* Hidden import input */}
      <input ref={importRef} type="file" accept=".json,.ipb.json" className="hidden" onChange={handleImportFile} />

      {/* ── Active file ──────────────────────────────────────────────────── */}
      {activeFile && (
        <ActiveFilePanel
          activeFile={activeFile}
          onSwitchPhase={handleSwitchPhase}
          onSnapshot={handleSnapshot}
          onSaveFile={handleSaveActiveFile}
          onExport={() => handleExport(activeFile.id, activeFile.name)}
          onClose={() => setActiveFile(null)}
          saving={saving}
        />
      )}

      {/* ── Search + New ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files…"
            className="w-full rounded-sm border py-1.5 pl-7 pr-7 font-mono text-[11px] text-white placeholder-white/25 outline-none"
            style={{ background: '#1a1a1a', borderColor: '#393939' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/35 hover:text-white">
              <X size={10} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowSaveDialog((v) => !v)}
          title="Save current map as new file"
          className="flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] transition"
          style={{
            background: showSaveDialog ? '#fff' : '#1a1a1a',
            color: showSaveDialog ? '#131313' : 'rgba(255,255,255,0.8)',
            border: `1px solid ${showSaveDialog ? '#fff' : '#393939'}`,
          }}
        >
          <FilePlus size={12} />
          New
        </button>
      </div>

      {/* ── Save dialog ──────────────────────────────────────────────────── */}
      {showSaveDialog && (
        <SaveDialog
          defaultName={`Mission ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
          folders={folders}
          onSave={handleSaveNew}
          onCancel={() => setShowSaveDialog(false)}
          saving={saving}
        />
      )}

      {/* ── Search results ───────────────────────────────────────────────── */}
      {isSearching && (
        <div className="flex-1 overflow-y-auto">
          <SectionLabel icon={<Search size={9} />} label={searchResults ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}` : 'Searching…'} />
          <div className="space-y-0.5">
            {(searchResults ?? []).map((file) => (
              <FileRow
                key={file.id}
                file={file}
                indent={0}
                isOpen={activeFile?.id === file.id}
                openingId={openingId}
                onOpen={handleOpen}
                onRename={(id, name) => renameMut.mutate({ id, name })}
                onDuplicate={(id) => duplicateMut.mutate(id)}
                onDelete={handleDeleteFile}
                onExport={handleExport}
              />
            ))}
            {searchResults?.length === 0 && (
              <p className="px-2 font-mono text-[11px] text-white/30">No files match "{searchQuery}"</p>
            )}
          </div>
        </div>
      )}

      {!isSearching && (
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
          {/* ── Recent ──────────────────────────────────────────────────── */}
          {recent && recent.length > 0 && (
            <div>
              <SectionLabel icon={<Clock size={9} />} label="Recent" />
              <div className="space-y-0.5">
                {recent.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    indent={0}
                    isOpen={activeFile?.id === file.id}
                    openingId={openingId}
                    onOpen={handleOpen}
                    onRename={(id, name) => renameMut.mutate({ id, name })}
                    onDuplicate={(id) => duplicateMut.mutate(id)}
                    onDelete={handleDeleteFile}
                    onExport={handleExport}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── All files ────────────────────────────────────────────────── */}
          <div className="flex-1">
            <div className="mb-0.5 flex items-center justify-between px-1 pb-1">
              <div className="flex items-center gap-1.5">
                <Folder size={9} className="text-white/35" />
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/35">All Files</span>
              </div>
              <button
                onClick={() => { setNewFolderParent(null); setNewFolderName(''); }}
                title="New folder"
                className="rounded-sm p-0.5 text-white/35 hover:bg-white/[0.06] hover:text-white"
              >
                <FolderPlus size={11} />
              </button>
            </div>

            {treeLoading && (
              <div className="flex items-center gap-2 px-2 py-3">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                <span className="font-mono text-[11px] text-white/40">Loading…</span>
              </div>
            )}

            {!treeLoading && (
              <div className="space-y-0.5">
                {newFolderParent === null && (
                  <NewFolderInput
                    indent={0}
                    value={newFolderName}
                    onChange={setNewFolderName}
                    onConfirm={() => newFolderName.trim() && createFolderMut.mutate({ name: newFolderName.trim(), parentId: null })}
                    onCancel={() => { setNewFolderParent(undefined); setNewFolderName(''); }}
                  />
                )}
                {renderTree(null, 0)}

                {files.length === 0 && folders.length === 0 && (
                  <div className="py-8 text-center">
                    <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-sm border" style={{ borderColor: '#393939', background: '#1a1a1a' }}>
                      <MapPin size={18} className="text-white/20" />
                    </div>
                    <p className="font-mono text-[11px] text-white/35">No saved files yet</p>
                    <p className="mt-1 font-mono text-[10px] text-white/20">
                      Click <strong className="text-white/40">New</strong> to save the current map state
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Import ───────────────────────────────────────────────────── */}
          <div className="border-t pt-2" style={{ borderColor: '#393939' }}>
            <button
              onClick={() => importRef.current?.click()}
              className="flex w-full items-center justify-center gap-1.5 rounded-sm border py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/40 transition hover:text-white/70"
              style={{ borderColor: '#393939', background: '#1a1a1a' }}
            >
              <Upload size={11} />
              Import .ipb.json
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
