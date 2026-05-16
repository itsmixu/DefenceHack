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

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_LAYER_KEYS: LayerKey[] = [
  'osm', 'digiroad', 'mml', 'mml_contours', 'statfin',
  'syke', 'fmi', 'fmi_forecast', 'astronomy',
  'opencellid', 'n2yo', 'exposure', 'mcoo',
];

const PHASE_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#ef4444', // red
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#06b6d4', // cyan
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
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

// ── Active file state ─────────────────────────────────────────────────────────

interface ActiveFile {
  id: string;
  name: string;
  activePhaseId: number;
  phases: Phase[];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InlineRename({
  initial,
  onConfirm,
  onCancel,
}: {
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
      className="min-w-0 flex-1 rounded border border-white/30 bg-black/60 px-1.5 py-0.5 text-[11px] text-white outline-none"
    />
  );
}

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}

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
      className="absolute right-0 top-full z-50 mt-0.5 min-w-[160px] rounded border border-white/15 bg-[#1c1c1c] py-1 shadow-xl"
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-white/[0.07] ${
            item.danger ? 'text-red-400 hover:text-red-300' : 'text-white/85'
          }`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  file,
  indent,
  isOpen,
  openingId,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
}: {
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
    { label: 'Rename',    icon: <Edit2 size={11} />, onClick: () => setRenaming(true) },
    { label: 'Duplicate', icon: <Copy size={11} />,  onClick: () => onDuplicate(file.id) },
    { label: 'Export .ipb.json', icon: <Download size={11} />, onClick: () => onExport(file.id, file.name) },
    { label: 'Delete',    icon: <Trash2 size={11}/>, danger: true, onClick: () => onDelete(file.id, file.name) },
  ];

  return (
    <div
      style={{ paddingLeft: `${indent * 12 + 8}px` }}
      title={`${fmtFull(file.updated_at)} · ${file.layer_count} layers · ${file.feature_count} features`}
      onClick={() => !renaming && onOpen(file)}
      className={`group relative flex cursor-pointer items-center gap-1.5 rounded py-1 pr-1 text-[11px] transition hover:bg-white/[0.05] ${
        isOpen ? 'bg-white/[0.06] text-white' : ''
      } ${loading ? 'opacity-60' : ''}`}
    >
      {loading ? (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
      ) : (
        <FileText size={12} className={`shrink-0 ${isOpen ? 'text-white/80' : 'text-white/45'}`} />
      )}

      <div className="min-w-0 flex-1 overflow-hidden">
        {renaming ? (
          <InlineRename
            initial={file.name}
            onConfirm={(n) => { onRename(file.id, n); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="block truncate text-white/90">{file.name}</span>
        )}
      </div>

      {!renaming && (
        <>
          <span className="shrink-0 text-[10px] text-white/30 group-hover:hidden">
            {fmtRelative(file.updated_at)}
          </span>
          <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
            {file.layer_count > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-white/40">
                <Layers size={9} />{file.layer_count}
              </span>
            )}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                className="rounded p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
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

// ── Folder row ────────────────────────────────────────────────────────────────

function FolderRow({
  folder, indent, expanded, onToggle, onRename, onDelete, onNewSub,
}: {
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
    { label: 'New subfolder', icon: <FolderPlus size={11} />, onClick: () => onNewSub(folder.id) },
    { label: 'Rename',        icon: <Edit2 size={11} />,      onClick: () => setRenaming(true) },
    { label: 'Delete',        icon: <Trash2 size={11} />,     danger: true, onClick: () => onDelete(folder.id, folder.name) },
  ];

  return (
    <div
      style={{ paddingLeft: `${indent * 12 + 4}px` }}
      onClick={() => !renaming && onToggle()}
      className="group relative flex cursor-pointer items-center gap-1.5 rounded py-1 pr-1 text-[11px] transition hover:bg-white/[0.05]"
    >
      <span className="shrink-0 text-white/50">
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </span>
      {expanded
        ? <FolderOpen size={12} className="shrink-0 text-amber-400/80" />
        : <Folder size={12} className="shrink-0 text-amber-400/80" />}

      <div className="min-w-0 flex-1 overflow-hidden">
        {renaming ? (
          <InlineRename
            initial={folder.name}
            onConfirm={(n) => { onRename(folder.id, n); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className="block truncate font-medium text-white/85">{folder.name}</span>
        )}
      </div>

      {!renaming && (
        <div className="relative opacity-0 transition group-hover:opacity-100">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="rounded p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <MoreHorizontal size={12} />
          </button>
          {menuOpen && <CtxMenu items={menu} onClose={() => setMenuOpen(false)} />}
        </div>
      )}
    </div>
  );
}

// ── New-folder input ──────────────────────────────────────────────────────────

function NewFolderInput({
  indent, value, onChange, onConfirm, onCancel,
}: {
  indent: number;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div style={{ paddingLeft: `${indent * 12 + 4}px` }} className="flex items-center gap-1.5 py-0.5 pr-1">
      <Folder size={12} className="shrink-0 text-amber-400/80" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) onConfirm();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Folder name…"
        className="min-w-0 flex-1 rounded border border-white/25 bg-black/60 px-1.5 py-0.5 text-[11px] text-white placeholder-white/30 outline-none focus:border-white/45"
      />
      <button onClick={onConfirm} disabled={!value.trim()} className="rounded p-0.5 text-emerald-400 hover:bg-white/[0.06] disabled:opacity-30">
        <Check size={11} />
      </button>
      <button onClick={onCancel} className="rounded p-0.5 text-white/50 hover:bg-white/[0.06]">
        <X size={11} />
      </button>
    </div>
  );
}

// ── Save dialog ───────────────────────────────────────────────────────────────

function SaveDialog({
  defaultName,
  folders,
  onSave,
  onCancel,
  saving,
}: {
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
    <div className="rounded border border-white/20 bg-[#1a1a1a] p-3 shadow-xl">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70">
        Save Project File
      </p>

      <input
        ref={ref}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onSave(name.trim(), folderId, phaseCount);
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="File name…"
        className="mb-2 w-full rounded border border-white/20 bg-black/60 px-2 py-1.5 text-[12px] text-white placeholder-white/35 outline-none focus:border-white/50"
      />

      {folders.length > 0 && (
        <select
          value={folderId ?? ''}
          onChange={(e) => setFolderId(e.target.value || null)}
          className="mb-2 w-full rounded border border-white/20 bg-black/60 px-2 py-1.5 text-[12px] text-white/90 outline-none"
        >
          <option value="">Root (no folder)</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}

      {/* Phase count selector */}
      <div className="mb-3">
        <p className="mb-1.5 text-[10px] uppercase tracking-[0.1em] text-white/50">
          Phases — current map state saved to Phase 1
        </p>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPhaseCount(n)}
              className={`h-7 w-7 rounded border text-[11px] font-semibold transition ${
                phaseCount === n
                  ? 'border-white bg-white text-black'
                  : 'border-white/20 text-white/60 hover:border-white/40 hover:text-white'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {phaseCount > 1 && (
          <p className="mt-1 text-[10px] text-white/35">
            {phaseCount - 1} empty phase{phaseCount > 2 ? 's' : ''} added — snapshot them later from the active file panel.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => name.trim() && onSave(name.trim(), folderId, phaseCount)}
          disabled={saving || !name.trim()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-black hover:bg-white/90 disabled:opacity-40"
        >
          {saving ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/30 border-t-black" /> : <Save size={11} />}
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded border border-white/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.1em] text-white/60 hover:bg-white/[0.06]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Active file panel ─────────────────────────────────────────────────────────

function ActiveFilePanel({
  activeFile,
  onSwitchPhase,
  onSnapshot,
  onSaveFile,
  onExport,
  onClose,
  saving,
}: {
  activeFile: ActiveFile;
  onSwitchPhase: (phaseId: number) => void;
  onSnapshot: () => void;
  onSaveFile: () => void;
  onExport: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <div className="rounded border border-white/20 bg-white/[0.04] p-2.5">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <FileText size={11} className="shrink-0 text-white/60" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-white">
          {activeFile.name}
        </span>
        <button
          onClick={onClose}
          title="Close file"
          className="shrink-0 text-white/40 hover:text-white"
        >
          <X size={11} />
        </button>
      </div>

      {/* Phase tabs */}
      <div className="mb-2.5 flex flex-wrap gap-1">
        {activeFile.phases.map((ph) => {
          const isActive = ph.id === activeFile.activePhaseId;
          return (
            <button
              key={ph.id}
              onClick={() => onSwitchPhase(ph.id)}
              style={{
                borderColor: isActive ? (ph.color ?? '#3b82f6') : 'transparent',
                color: isActive ? (ph.color ?? '#3b82f6') : undefined,
              }}
              className={`rounded border px-2.5 py-0.5 text-[10px] font-medium transition ${
                isActive
                  ? 'bg-white/[0.08]'
                  : 'border-white/15 text-white/45 hover:border-white/30 hover:text-white/75'
              }`}
            >
              {ph.name}
            </button>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={onSnapshot}
          title="Capture current map state (layers, drawings, timeline) into the active phase"
          className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[10px] text-white/65 transition hover:border-white/30 hover:text-white"
        >
          <Camera size={10} />
          Snapshot Phase
        </button>

        <button
          onClick={onSaveFile}
          disabled={saving}
          className="flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[10px] text-white/65 transition hover:border-white/30 hover:text-white disabled:opacity-40"
        >
          {saving
            ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            : <Save size={10} />}
          Save File
        </button>

        <button
          onClick={onExport}
          title="Download as .ipb.json"
          className="ml-auto flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[10px] text-white/65 transition hover:border-white/30 hover:text-white"
        >
          <Download size={10} />
          Export
        </button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FileSystemPanel() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);

  // Map state stores
  const bbox         = useBboxStore((s) => s.bbox);
  const drawnFeatures = useDrawnStore((s) => s.toCollection());
  const setAllDrawn  = useDrawnStore((s) => s.setAll);
  const activeLayers = useLayerStore((s) => s.active);
  const setActiveLayers = useLayerStore((s) => s.setActiveLayers);
  const featureCache = useFeatureCacheStore((s) => s.features);
  const injectSnapshots = useFeatureCacheStore((s) => s.injectSnapshots);
  const clearAllCache = useFeatureCacheStore((s) => s.clearAll);
  const selectedMs   = useTimelineStore((s) => s.selectedMs);
  const setSelectedMs = useTimelineStore((s) => s.setSelectedMs);
  const map          = useMapStore((s) => s.map);

  // UI state
  const [activeFile, setActiveFile]   = useState<ActiveFile | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [openingId, setOpeningId]     = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName]     = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  // Data queries
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

  // ── Capture current map state ──────────────────────────────────────────────

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

  // ── Load a phase into the map ──────────────────────────────────────────────

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

    if (ph.timeline_selected_ms != null) {
      setSelectedMs(ph.timeline_selected_ms);
    }

    if (map) {
      if (ph.bbox) {
        const [w, s, e, n] = ph.bbox;
        map.fitBounds([[s, w], [n, e]], { animate: true, duration: 0.6 });
      } else if (ph.center && ph.zoom != null) {
        map.flyTo([ph.center[0], ph.center[1]], ph.zoom, { animate: true, duration: 0.6 });
      }
    }
  }, [clearAllCache, injectSnapshots, setActiveLayers, setAllDrawn, setSelectedMs, map]);

  // ── Open file ──────────────────────────────────────────────────────────────

  const handleOpen = useCallback(async (file: FsFileMeta) => {
    setOpeningId(file.id);
    try {
      const content = await fsOpenFile(file.id);

      // Build phases array — upgrade legacy files on the fly
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

  // ── Switch phase ───────────────────────────────────────────────────────────

  const handleSwitchPhase = useCallback((newPhaseId: number) => {
    if (!activeFile || newPhaseId === activeFile.activePhaseId) return;

    // Save current map state to the current phase (local only)
    const currentState = captureCurrentState();
    const updatedPhases = activeFile.phases.map((p) =>
      p.id === activeFile.activePhaseId ? { ...p, ...currentState } : p
    );

    const newPhase = updatedPhases.find((p) => p.id === newPhaseId);
    if (newPhase) loadPhaseIntoMap(newPhase);

    setActiveFile({ ...activeFile, phases: updatedPhases, activePhaseId: newPhaseId });
  }, [activeFile, captureCurrentState, loadPhaseIntoMap]);

  // ── Snapshot current phase ─────────────────────────────────────────────────

  const handleSnapshot = useCallback(() => {
    if (!activeFile) return;
    const currentState = captureCurrentState();
    const updatedPhases = activeFile.phases.map((p) =>
      p.id === activeFile.activePhaseId ? { ...p, ...currentState } : p
    );
    setActiveFile({ ...activeFile, phases: updatedPhases });
    push('info', `Phase ${activeFile.activePhaseId} snapshot captured — click Save File to persist.`);
  }, [activeFile, captureCurrentState, push]);

  // ── Save active file ───────────────────────────────────────────────────────

  const handleSaveActiveFile = useCallback(async () => {
    if (!activeFile) return;
    setSaving(true);
    try {
      // Snapshot active phase before saving
      const currentState = captureCurrentState();
      const phases = activeFile.phases.map((p) =>
        p.id === activeFile.activePhaseId ? { ...p, ...currentState } : p
      );

      // Use active phase for top-level state (backward compat)
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

  // ── Save new file ──────────────────────────────────────────────────────────

  const handleSaveNew = useCallback(async (name: string, folderId: string | null, phaseCount: number) => {
    setSaving(true);
    try {
      const currentState = captureCurrentState();
      const phase1: Phase = {
        id: 1,
        name: 'Phase 1',
        color: PHASE_COLORS[0],
        notes: '',
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
        name,
        folder_id: folderId,
        bbox: phase1.bbox ?? null,
        center: phase1.center ?? null,
        zoom: phase1.zoom ?? null,
        timeline_selected_ms: phase1.timeline_selected_ms ?? null,
        active_layers: phase1.active_layers,
        drawn_features: phase1.drawn_features,
        layer_snapshots: snapshots,
        phases,
        current_phase: 1,
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

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async (id: string, name: string) => {
    try {
      await fsExportDownload(id, name);
      push('success', `Exported: ${name}.ipb.json`);
    } catch (e) {
      push('error', `Export failed: ${String(e)}`);
    }
  }, [push]);

  // ── Import ─────────────────────────────────────────────────────────────────

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

  // ── Mutations ──────────────────────────────────────────────────────────────

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

  // ── Tree rendering ─────────────────────────────────────────────────────────

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
              onNewSub={(pid) => {
                setNewFolderParent(pid);
                setExpandedFolders((s) => new Set([...s, pid]));
              }}
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
    <div className="flex h-full flex-col gap-3">
      {/* Hidden import input */}
      <input
        ref={importRef}
        type="file"
        accept=".json,.ipb.json"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* ── Active file panel ──────────────────────────────────────────── */}
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

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files…"
            className="w-full rounded border border-white/15 bg-black/40 py-1.5 pl-6 pr-2 text-[11px] text-white placeholder-white/30 outline-none focus:border-white/35"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white">
              <X size={10} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowSaveDialog((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded bg-white px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-black hover:bg-white/90"
        >
          <Save size={11} />
          Save
        </button>
      </div>

      {/* ── Save dialog ─────────────────────────────────────────────────── */}
      {showSaveDialog && (
        <SaveDialog
          defaultName={`Mission ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
          folders={folders}
          onSave={handleSaveNew}
          onCancel={() => setShowSaveDialog(false)}
          saving={saving}
        />
      )}

      {/* ── Search results ───────────────────────────────────────────────── */}
      {isSearching && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.1em] text-white/40">
            {searchResults ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}` : 'Searching…'}
          </p>
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
            <p className="text-[11px] text-white/35">No files match "{searchQuery}"</p>
          )}
        </div>
      )}

      {!isSearching && (
        <>
          {/* ── Recent ────────────────────────────────────────────────── */}
          {recent && recent.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <Clock size={10} className="text-white/40" />
                <span className="text-[10px] uppercase tracking-[0.1em] text-white/40">Recent</span>
              </div>
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
          )}

          {/* ── File tree ─────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.1em] text-white/40">All Files</span>
              <button
                onClick={() => { setNewFolderParent(null); setNewFolderName(''); }}
                title="New folder"
                className="rounded p-0.5 text-white/40 hover:bg-white/[0.06] hover:text-white"
              >
                <FolderPlus size={12} />
              </button>
            </div>

            {treeLoading && <p className="text-[11px] text-white/35">Loading…</p>}

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
                  <div className="py-6 text-center">
                    <MapPin size={20} className="mx-auto mb-2 text-white/20" />
                    <p className="text-[11px] text-white/35">No saved files yet.</p>
                    <p className="text-[10px] text-white/25">Click Save to record the current map state.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Import button ──────────────────────────────────────────── */}
          <div className="border-t border-white/10 pt-2">
            <button
              onClick={() => importRef.current?.click()}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-white/15 py-1.5 text-[10px] uppercase tracking-[0.1em] text-white/45 transition hover:border-white/30 hover:text-white/75"
            >
              <Upload size={11} />
              Import .ipb.json
            </button>
          </div>
        </>
      )}
    </div>
  );
}
