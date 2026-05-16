/**
 * FileManagerOverlay — top-left floating file manager with multi-tab support.
 *
 * Responsibilities:
 *   • Browse, search, create, rename, duplicate, export, delete files & folders
 *   • Open files as TABS (multiple files open simultaneously)
 *   • Switch between tabs — state preserved across switches via useOpenFilesStore
 *   • Switch phases within the active tab
 *   • Command hierarchy: toggle overlays of subordinate tabs onto the active map
 *   • Merge overlay drawn features into the active tab's current phase
 *
 * Tactile Noir: solid #131313, #393939 borders, inverted white active state.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Clock,
  Copy,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FileText,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderArchive,
  GitMerge,
  Layers,
  MoreHorizontal,
  Save,
  Search,
  Shield,
  Trash2,
  Upload,
  X,
  Users,
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
import type {
  DrawnFeature,
  FsFileMeta,
  FsFolder,
  IpbExportV2,
  LayerKey,
  Phase,
  Rank,
} from '../api/types';
import { RANK_DEFAULT, RANK_LEVELS, RANK_NAMES } from '../api/types';
import type { FeatureCollection, Feature } from 'geojson';
import {
  useDrawnStore,
  useFeatureCacheStore,
  useLayerStore,
  useMapStore,
  useOpenFilesStore,
  useTimelineStore,
  useToastStore,
  captureLiveMapState,
  type OpenFileTab,
} from '../store';
import HierarchyEditor from './file-manager/HierarchyEditor';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_LAYER_KEYS: LayerKey[] = [
  'osm', 'digiroad', 'mml', 'mml_contours', 'statfin',
  'syke', 'fmi', 'fmi_forecast', 'astronomy',
  'opencellid', 'starlink', 'exposure', 'mcoo',
];

const PHASE_COLORS = [
  '#3b82f6', '#22c55e', '#ef4444',
  '#f59e0b', '#8b5cf6', '#06b6d4',
];

// Colour matched to OverlayLayer.tsx so the tab badge agrees with the
// dimmed shapes on the map.
const OVERLAY_PALETTE = [
  '#22d3ee', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#60a5fa',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
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

// ── Live-state wiring ─────────────────────────────────────────────────────────
//
// When the active tab or its active phase changes, we mirror the phase's
// contents into the live editing stores so the user sees the map exactly
// as they left it. This is the bridge between the open-files store (which
// holds dormant tab snapshots) and the live editing stores.
//
// While `isLoadingPhase` is true, subscriptions that would otherwise mark
// the active tab dirty (e.g. useDrawnStore listener) are suppressed.
let isLoadingPhase = false;

function loadPhaseIntoLive(ph: Phase) {
  isLoadingPhase = true;
  try {
    loadPhaseIntoLiveInner(ph);
  } finally {
    // Defer the unset to next tick so any sync setAll() change events
    // triggered above propagate through subscribers first.
    Promise.resolve().then(() => { isLoadingPhase = false; });
  }
}

function loadPhaseIntoLiveInner(ph: Phase) {
  // 1. Clear and inject layer snapshots
  useFeatureCacheStore.getState().clearAll();
  if (ph.layer_snapshots && Object.keys(ph.layer_snapshots).length > 0) {
    useFeatureCacheStore.getState().injectSnapshots(
      ph.layer_snapshots as Record<string, { features: Feature[] }>,
      ph.bbox ?? undefined,
    );
  }
  // 2. Activate layers
  useLayerStore.getState().setActiveLayers((ph.active_layers ?? []) as LayerKey[]);
  // 3. Restore drawn shapes
  useDrawnStore.getState().setAll((ph.drawn_features?.features ?? []) as DrawnFeature[]);
  // 4. Restore timeline position
  if (ph.timeline_selected_ms != null) {
    useTimelineStore.getState().setSelectedMs(ph.timeline_selected_ms);
  }
  // 5. FlyTo viewport
  const map = useMapStore.getState().map;
  if (map) {
    if (ph.bbox) {
      const [w, s, e, n] = ph.bbox;
      map.fitBounds([[s, w], [n, e]], { animate: true, duration: 0.6 });
    } else if (ph.center && ph.zoom != null) {
      map.flyTo([ph.center[0], ph.center[1]], ph.zoom, { animate: true, duration: 0.6 });
    }
  }
}

// ── Inline rename ─────────────────────────────────────────────────────────────

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

// ── Context menu ──────────────────────────────────────────────────────────────

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
      className="absolute left-0 top-full z-[200] mt-0.5 min-w-[170px] rounded-sm border py-0.5 shadow-[0_8px_24px_rgba(0,0,0,0.9)]"
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

// ── File row ──────────────────────────────────────────────────────────────────

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
  const rank = (file.rank ?? RANK_DEFAULT) as Rank;
  const rankName = RANK_NAMES[rank];

  const menu: MenuItem[] = [
    { label: 'Rename',    icon: <Edit2 size={10} />,    onClick: () => setRenaming(true) },
    { label: 'Duplicate', icon: <Copy size={10} />,     onClick: () => onDuplicate(file.id) },
    { label: 'Export',    icon: <Download size={10} />, onClick: () => onExport(file.id, file.name) },
    { label: 'Delete',    icon: <Trash2 size={10} />,   danger: true, onClick: () => onDelete(file.id, file.name) },
  ];

  return (
    <div
      style={{ paddingLeft: `${indent * 14 + 8}px` }}
      title={`${fmtFull(file.updated_at)} · ${rankName}${file.unit ? ' · ' + file.unit : ''} · ${file.layer_count} layers · ${file.feature_count} features`}
      onClick={() => !renaming && onOpen(file)}
      className={`group relative flex cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-1 transition ${
        isOpen ? 'bg-white text-black' : 'text-white/80 hover:bg-white/[0.07]'
      } ${loading ? 'opacity-60' : ''}`}
    >
      {loading ? (
        <span className="ml-2 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
      ) : (
        <FileText size={11} className={`ml-2 shrink-0 ${isOpen ? 'text-black/60' : 'text-white/40'}`} />
      )}

      <div className="min-w-0 flex-1 overflow-hidden">
        {renaming ? (
          <InlineRename
            initial={file.name}
            onConfirm={(n) => { onRename(file.id, n); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className={`truncate font-mono text-[11px] ${isOpen ? 'font-semibold' : ''}`}>
              {file.name}
            </span>
            {(file.unit || file.rank) && (
              <span
                className={`shrink-0 rounded-sm border px-1 py-px font-mono text-[8px] uppercase tracking-[0.04em] ${
                  isOpen ? 'border-black/30 text-black/65' : 'border-white/20 text-white/45'
                }`}
              >
                {file.unit || rankName}
              </span>
            )}
          </div>
        )}
      </div>

      {!renaming && (
        <>
          <span className={`shrink-0 font-mono text-[9px] group-hover:hidden ${isOpen ? 'text-black/45' : 'text-white/30'}`}>
            {fmtRelative(file.updated_at)}
          </span>
          <div className="hidden shrink-0 items-center gap-1 group-hover:flex">
            {file.layer_count > 0 && (
              <span className={`flex items-center gap-0.5 font-mono text-[9px] ${isOpen ? 'text-black/45' : 'text-white/35'}`}>
                <Layers size={8} />{file.layer_count}
              </span>
            )}
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
                className={`rounded-sm p-0.5 ${isOpen ? 'text-black/50 hover:bg-black/10' : 'text-white/40 hover:bg-white/10 hover:text-white'}`}
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
      className="group relative flex cursor-pointer items-center gap-1.5 rounded-sm py-1.5 pr-1 transition hover:bg-white/[0.05]"
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
          <span className="block truncate font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-white/65">
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

// ── New folder input ──────────────────────────────────────────────────────────

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
      <button onClick={onConfirm} disabled={!value.trim()} className="rounded-sm p-0.5 text-emerald-400 disabled:opacity-30">
        <Check size={11} />
      </button>
      <button onClick={onCancel} className="rounded-sm p-0.5 text-white/40">
        <X size={11} />
      </button>
    </div>
  );
}

// ── Tab pill ──────────────────────────────────────────────────────────────────

interface TabPillProps {
  tab: OpenFileTab;
  isActive: boolean;
  isOverlay: boolean;
  canOverlay: boolean;
  overlayColor: string | null;
  onClick: () => void;
  onClose: () => void;
  onToggleOverlay: () => void;
}

function TabPill({ tab, isActive, isOverlay, canOverlay, overlayColor, onClick, onClose, onToggleOverlay }: TabPillProps) {
  const rankName = RANK_NAMES[tab.rank];
  return (
    <div
      className="group relative flex shrink-0 items-stretch rounded-sm border font-mono transition"
      style={{
        borderColor: isActive ? '#fff' : isOverlay ? (overlayColor ?? '#393939') : '#393939',
        background: isActive ? '#fff' : isOverlay ? (overlayColor ?? '#1a1a1a') + '22' : '#1a1a1a',
        color: isActive ? '#131313' : 'rgba(255,255,255,0.65)',
      }}
      title={`${tab.name} · ${rankName}${tab.unit ? ' · ' + tab.unit : ''}${tab.commanderName ? ' · ' + tab.commanderName : ''}${tab.isDirty ? ' · unsaved' : ''}`}
    >
      {/* Click body to activate */}
      <button onClick={onClick} className="flex items-center gap-1.5 px-2 py-1 text-left">
        <span
          className="rounded-sm border px-1 py-px text-[8px] uppercase tracking-[0.06em]"
          style={{
            borderColor: isActive ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.2)',
            color: isActive ? '#131313' : 'rgba(255,255,255,0.55)',
          }}
        >
          {rankName.slice(0, 3)}
        </span>
        <span className="max-w-[110px] truncate text-[11px] font-semibold">
          {tab.unit || tab.name}
        </span>
        {tab.isDirty && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: isActive ? '#131313' : '#f59e0b' }}
            title="Unsaved changes"
          />
        )}
      </button>

      {/* Overlay toggle (only for non-active tabs the active tab commands) */}
      {!isActive && canOverlay && (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleOverlay(); }}
          title={isOverlay ? 'Stop overlay' : 'Overlay on active map'}
          className="flex items-center justify-center px-1.5 transition"
          style={{
            color: isOverlay ? (overlayColor ?? '#fff') : 'rgba(255,255,255,0.4)',
            borderLeft: `1px solid ${isOverlay ? (overlayColor ?? '#393939') + '60' : '#393939'}`,
          }}
        >
          {isOverlay ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      )}

      {/* Close X */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        title="Close tab"
        className="flex items-center justify-center px-1.5 transition hover:text-red-400"
        style={{
          color: isActive ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.3)',
          borderLeft: `1px solid ${isActive ? 'rgba(0,0,0,0.15)' : '#393939'}`,
        }}
      >
        <X size={11} />
      </button>
    </div>
  );
}

// ── Section header label ──────────────────────────────────────────────────────

function SectionLabel({ icon, label, accent }: { icon: React.ReactNode; label: string; accent?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pb-1">
      <span style={{ color: accent ?? 'rgba(255,255,255,0.35)' }}>{icon}</span>
      <span
        className="font-mono text-[9px] uppercase tracking-[0.14em]"
        style={{ color: accent ?? 'rgba(255,255,255,0.35)' }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────────────────────

type ViewMode = 'browser' | 'save';

export default function FileManagerOverlay() {
  const qc   = useQueryClient();
  const push = useToastStore((s) => s.push);

  // Multi-tab state ──────────────────────────────────────────────────────────
  const tabs           = useOpenFilesStore((s) => s.tabs);
  const activeTabId    = useOpenFilesStore((s) => s.activeTabId);
  const overlayTabIds  = useOpenFilesStore((s) => s.overlayTabIds);
  const activeTab      = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);
  const activePhase    = activeTab?.phases.find((p) => p.id === activeTab.activePhaseId) ?? null;

  // Local UI state ───────────────────────────────────────────────────────────
  const [open, setOpen]                       = useState(false);
  const [view, setView]                       = useState<ViewMode>('browser');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery]         = useState('');
  const [openingId, setOpeningId]             = useState<string | null>(null);
  const [saving, setSaving]                   = useState(false);
  const [showHierarchyEditor, setShowHierarchyEditor] = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName]     = useState('');

  // Save form state ──────────────────────────────────────────────────────────
  const [saveName, setSaveName]               = useState('');
  const [saveFolderId, setSaveFolderId]       = useState<string | null>(null);
  const [savePhaseCount, setSavePhaseCount]   = useState(1);
  const [saveRank, setSaveRank]               = useState<Rank>(RANK_DEFAULT);
  const [saveUnit, setSaveUnit]               = useState('');
  const [saveCommander, setSaveCommander]     = useState('');
  const [saveParentId, setSaveParentId]       = useState<string | null>(null);

  const importRef = useRef<HTMLInputElement>(null);

  // ── Dirty tracking: mark active tab dirty on user edits ───────────────────
  useEffect(() => {
    const unsubDrawn = useDrawnStore.subscribe((s, prev) => {
      if (isLoadingPhase) return;
      if (s.features === prev.features) return;
      const aid = useOpenFilesStore.getState().activeTabId;
      if (aid) useOpenFilesStore.getState().markDirty(aid);
    });
    const unsubLayer = useLayerStore.subscribe((s, prev) => {
      if (isLoadingPhase) return;
      if (s.active === prev.active) return;
      const aid = useOpenFilesStore.getState().activeTabId;
      if (aid) useOpenFilesStore.getState().markDirty(aid);
    });
    return () => { unsubDrawn(); unsubLayer(); };
  }, []);

  // ── Data queries ─────────────────────────────────────────────────────────
  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['fs-tree'], queryFn: fsGetTree, staleTime: 10_000, enabled: open,
  });
  const { data: recent } = useQuery({
    queryKey: ['fs-recent'], queryFn: () => fsGetRecent(5), staleTime: 10_000, enabled: open,
  });
  const { data: searchResults } = useQuery({
    queryKey: ['fs-search', searchQuery], queryFn: () => fsSearch(searchQuery),
    enabled: searchQuery.length >= 2, staleTime: 5_000,
  });

  const refetchAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['fs-tree'] });
    qc.invalidateQueries({ queryKey: ['fs-recent'] });
    qc.invalidateQueries({ queryKey: ['fs-search'] });
  }, [qc]);

  // ── Open file → push as new tab ──────────────────────────────────────────
  const handleOpen = useCallback(async (file: FsFileMeta) => {
    setOpeningId(file.id);
    try {
      const content = await fsOpenFile(file.id);
      const map = useMapStore.getState().map;
      const live = activeTabId ? captureLiveMapState(map) : undefined;
      const tab = useOpenFilesStore.getState().openTab(content, live);
      // Load the new tab's active phase into the live editing stores
      const newPhase = tab.phases.find((p) => p.id === tab.activePhaseId);
      if (newPhase) loadPhaseIntoLive(newPhase);
      push('success', `Opened: ${content.name}`);
    } catch (e) {
      push('error', `Failed to open: ${String(e)}`);
    } finally {
      setOpeningId(null);
    }
  }, [activeTabId, push]);

  // ── Switch tab ─────────────────────────────────────────────────────────────
  const handleSwitchTab = useCallback((id: string) => {
    if (id === activeTabId) return;
    const map = useMapStore.getState().map;
    const live = activeTabId ? captureLiveMapState(map) : undefined;
    const incoming = useOpenFilesStore.getState().setActiveTab(id, live);
    if (!incoming) return;
    const phase = incoming.phases.find((p) => p.id === incoming.activePhaseId);
    if (phase) loadPhaseIntoLive(phase);
  }, [activeTabId]);

  // ── Close tab ──────────────────────────────────────────────────────────────
  const handleCloseTab = useCallback((id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab?.isDirty) {
      const ok = window.confirm(`"${tab.name}" has unsaved changes. Close anyway?`);
      if (!ok) return;
    }
    const nextActive = useOpenFilesStore.getState().closeTab(id);
    if (nextActive && nextActive !== activeTabId) {
      const ph = useOpenFilesStore.getState().getTab(nextActive)?.phases.find(
        (p) => p.id === useOpenFilesStore.getState().getTab(nextActive)?.activePhaseId,
      );
      if (ph) loadPhaseIntoLive(ph);
    } else if (!nextActive) {
      // No tabs left — clear live state
      useDrawnStore.getState().setAll([]);
      useLayerStore.getState().setActiveLayers([]);
      useFeatureCacheStore.getState().clearAll();
    }
  }, [tabs, activeTabId]);

  // ── Switch phase within the active tab ───────────────────────────────────
  const handleSwitchPhase = useCallback((newPhaseId: number) => {
    if (!activeTab || newPhaseId === activeTab.activePhaseId) return;
    const map = useMapStore.getState().map;
    const live = captureLiveMapState(map);
    const newPhase = useOpenFilesStore.getState().setTabPhase(activeTab.id, newPhaseId, live);
    if (newPhase) loadPhaseIntoLive(newPhase);
  }, [activeTab]);

  // ── Snapshot ─────────────────────────────────────────────────────────────
  const handleSnapshot = useCallback(() => {
    if (!activeTab) return;
    const map = useMapStore.getState().map;
    const live = captureLiveMapState(map);
    useOpenFilesStore.getState().snapshotIntoTab(activeTab.id, live);
    push('info', `Phase ${activeTab.activePhaseId} snapshot captured`);
  }, [activeTab, push]);

  // ── Save active tab to disk ───────────────────────────────────────────────
  const handleSaveActiveTab = useCallback(async () => {
    if (!activeTab) return;
    setSaving(true);
    try {
      // Capture current state into the active phase first
      const map = useMapStore.getState().map;
      const live = captureLiveMapState(map);
      useOpenFilesStore.getState().snapshotIntoTab(activeTab.id, live);
      const updatedTab = useOpenFilesStore.getState().getTab(activeTab.id);
      if (!updatedTab) return;

      const activePh = updatedTab.phases.find((p) => p.id === updatedTab.activePhaseId);
      const snapshots: Record<string, FeatureCollection> = {};
      if (activePh?.layer_snapshots) {
        for (const [k, v] of Object.entries(activePh.layer_snapshots)) snapshots[k] = v;
      }
      await fsSaveFile({
        id: updatedTab.id,
        name: updatedTab.name,
        folder_id: updatedTab.folderId,
        rank: updatedTab.rank,
        unit: updatedTab.unit,
        commander_name: updatedTab.commanderName,
        parent_file_id: updatedTab.parentFileId,
        bbox: activePh?.bbox ?? null,
        center: activePh?.center ?? null,
        zoom: activePh?.zoom ?? null,
        timeline_selected_ms: activePh?.timeline_selected_ms ?? null,
        active_layers: activePh?.active_layers ?? [],
        drawn_features: activePh?.drawn_features ?? { type: 'FeatureCollection', features: [] },
        layer_snapshots: snapshots,
        phases: updatedTab.phases,
        current_phase: updatedTab.activePhaseId,
      });
      useOpenFilesStore.getState().markClean(updatedTab.id);
      push('success', `Saved: ${updatedTab.name}`);
      refetchAll();
    } catch (e) {
      push('error', `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [activeTab, push, refetchAll]);

  // ── Save new file ────────────────────────────────────────────────────────
  const handleSaveNew = useCallback(async () => {
    const name = saveName.trim() || `Mission ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    setSaving(true);
    try {
      const map = useMapStore.getState().map;
      const live = captureLiveMapState(map);
      const phase1: Phase = {
        id: 1, name: 'Phase 1', color: PHASE_COLORS[0], notes: '',
        bbox: live.bbox, center: live.center, zoom: live.zoom,
        timeline_selected_ms: live.timelineSelectedMs,
        active_layers: live.activeLayers,
        drawn_features: { type: 'FeatureCollection', features: live.drawnFeatures },
        layer_snapshots: live.layerSnapshots,
        conditions: {},
      };
      const phases: Phase[] = [
        phase1,
        ...Array.from({ length: savePhaseCount - 1 }, (_, i) => makeEmptyPhase(i + 2)),
      ];
      const meta = await fsSaveFile({
        name,
        folder_id: saveFolderId,
        rank: saveRank,
        unit: saveUnit.trim(),
        commander_name: saveCommander.trim(),
        parent_file_id: saveParentId,
        bbox: phase1.bbox ?? null,
        center: phase1.center ?? null,
        zoom: phase1.zoom ?? null,
        timeline_selected_ms: phase1.timeline_selected_ms ?? null,
        active_layers: phase1.active_layers,
        drawn_features: phase1.drawn_features,
        layer_snapshots: phase1.layer_snapshots ?? {},
        phases,
        current_phase: 1,
      });

      // Open the newly-saved file as a tab — we already have all the state,
      // so synthesise a FsFileContent shape that openTab can consume.
      // Pass `live` so the previously-active tab (if any) has its current
      // state captured before the new file takes focus.
      const content = {
        ...meta,
        notes: '',
        center: phase1.center ?? null,
        zoom: phase1.zoom ?? null,
        drawn_features: phase1.drawn_features,
        phases,
        current_phase: 1,
        layer_snapshots: phase1.layer_snapshots ?? {},
        conditions: {},
      };
      const prevActive = useOpenFilesStore.getState().activeTabId;
      useOpenFilesStore.getState().openTab(content, prevActive ? live : undefined);

      // Reset save form
      setView('browser');
      setSaveName(''); setSaveFolderId(null); setSavePhaseCount(1);
      setSaveRank(RANK_DEFAULT); setSaveUnit(''); setSaveCommander(''); setSaveParentId(null);
      push('success', `Saved: ${name}`);
      refetchAll();
    } catch (e) {
      push('error', `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [saveName, saveFolderId, savePhaseCount, saveRank, saveUnit, saveCommander, saveParentId, push, refetchAll]);

  // ── Export ───────────────────────────────────────────────────────────────
  const handleExport = useCallback(async (id: string, name: string) => {
    try { await fsExportDownload(id, name); push('success', `Exported: ${name}.ipb.json`); }
    catch (e) { push('error', `Export failed: ${String(e)}`); }
  }, [push]);

  // ── Import ────────────────────────────────────────────────────────────────
  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text) as IpbExportV2;
      if (data.format !== 'ipb-operation') { push('error', 'Not a valid .ipb.json file.'); return; }
      const meta = await fsImportFile(data);
      push('success', `Imported: ${meta.name}`);
      refetchAll();
    } catch (err) {
      push('error', `Import failed: ${String(err)}`);
    }
  }, [push, refetchAll]);

  // ── Mutations ─────────────────────────────────────────────────────────────
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
      setNewFolderParent(undefined); setNewFolderName('');
      push('success', `Created: ${f.name}`);
    },
    onError: () => push('error', 'Create folder failed'),
  });

  const handleDeleteFile   = useCallback((id: string, name: string) => { if (window.confirm(`Delete "${name}"?`)) deleteFileMut.mutate(id); }, [deleteFileMut]);
  const handleDeleteFolder = useCallback((id: string, name: string) => { if (window.confirm(`Delete folder "${name}" and all its contents?`)) deleteFolderMut.mutate({ id, recursive: true }); }, [deleteFolderMut]);

  // ── Overlay handling ─────────────────────────────────────────────────────
  const handleToggleOverlay = useCallback((tabId: string) => {
    useOpenFilesStore.getState().toggleOverlay(tabId);
  }, []);

  const handleMergeOverlay = useCallback((overlayTabId: string) => {
    const sub = tabs.find((t) => t.id === overlayTabId);
    const subFeatureCount = sub?.phases.find((p) => p.id === sub.activePhaseId)?.drawn_features?.features?.length ?? 0;
    if (!sub || subFeatureCount === 0) {
      push('info', `${sub?.name ?? 'Overlay'} has no shapes to merge.`);
      return;
    }
    const ok = window.confirm(
      `Merge ${subFeatureCount} shape${subFeatureCount === 1 ? '' : 's'} from "${sub.unit || sub.name}" into the current phase?\n\nMerged shapes will be tagged with their source unit.`,
    );
    if (!ok) return;
    const merged = useOpenFilesStore.getState().mergeOverlayIntoActivePhase(overlayTabId);
    if (merged) {
      // Push merged features into live drawn store so the user sees them immediately
      useDrawnStore.getState().setAll(merged);
      push('success', `Merged ${subFeatureCount} feature${subFeatureCount === 1 ? '' : 's'} from ${sub.unit || sub.name}`);
    } else {
      push('error', 'Merge not permitted by rank');
    }
  }, [tabs, push]);

  // ── Tree rendering ───────────────────────────────────────────────────────
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
              folder={folder} indent={depth}
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
                    indent={depth + 1} value={newFolderName} onChange={setNewFolderName}
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
            key={file.id} file={file} indent={depth}
            isOpen={tabs.some((t) => t.id === file.id)} openingId={openingId}
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

  // ── Derived: overlay info for the bar below the tabs ──────────────────────
  const overlayInfos = useMemo(() => {
    return overlayTabIds
      .map((id, idx) => {
        const t = tabs.find((x) => x.id === id);
        if (!t) return null;
        const phase = t.phases.find((p) => p.id === t.activePhaseId);
        return {
          tab: t,
          color: OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length],
          featureCount: (phase?.drawn_features?.features ?? []).length,
        };
      })
      .filter((x): x is { tab: OpenFileTab; color: string; featureCount: number } => x !== null);
  }, [overlayTabIds, tabs]);

  // Other open tabs that the active tab can command (eligible for overlay)
  const commandable = useMemo(() => {
    if (!activeTab) return new Set<string>();
    const out = new Set<string>();
    for (const t of tabs) {
      if (t.id === activeTab.id) continue;
      if (useOpenFilesStore.getState().canCommand(activeTab.id, t.id)) out.add(t.id);
    }
    return out;
  }, [tabs, activeTab]);

  return (
    <div className="pointer-events-auto absolute left-3 top-[76px] z-[900] flex flex-col gap-1" style={{ width: 360 }}>
      <input ref={importRef} type="file" accept=".json,.ipb.json" className="hidden" onChange={handleImportFile} />

      {/* ── Header bar with tabs ───────────────────────────────────────────── */}
      <div
        className="flex items-stretch gap-0 rounded-sm border shadow-[0_4px_16px_rgba(0,0,0,0.7)]"
        style={{ background: '#131313', borderColor: open ? '#fff' : '#393939' }}
      >
        {/* Files toggle */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-2 transition hover:bg-white/[0.06]"
          style={{ borderRight: '1px solid #393939' }}
          title={open ? 'Close file manager' : 'Open file manager'}
        >
          <FolderArchive size={13} className={open ? 'text-white' : 'text-white/55'} />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-white/55 sm:inline">
            Files
          </span>
        </button>

        {/* Tab strip — horizontally scrollable */}
        <div className="min-w-0 flex-1 overflow-x-auto">
          {tabs.length === 0 ? (
            <button
              onClick={() => setOpen(true)}
              className="flex h-full w-full items-center px-2.5 font-mono text-[10px] text-white/25 hover:text-white/45"
            >
              No file open · click Files to browse
            </button>
          ) : (
            <div className="flex h-full items-center gap-1 px-1.5 py-1">
              {tabs.map((t) => {
                const isActive = t.id === activeTabId;
                const overlayIdx = overlayTabIds.indexOf(t.id);
                const isOverlay = overlayIdx !== -1;
                const overlayColor = isOverlay
                  ? OVERLAY_PALETTE[overlayIdx % OVERLAY_PALETTE.length]
                  : null;
                return (
                  <TabPill
                    key={t.id}
                    tab={t}
                    isActive={isActive}
                    isOverlay={isOverlay}
                    canOverlay={commandable.has(t.id)}
                    overlayColor={overlayColor}
                    onClick={() => handleSwitchTab(t.id)}
                    onClose={() => handleCloseTab(t.id)}
                    onToggleOverlay={() => handleToggleOverlay(t.id)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center px-2 text-white/30 hover:text-white"
          style={{ borderLeft: '1px solid #393939' }}
        >
          {open ? <ChevronLeft size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {/* ── Active file actions row ────────────────────────────────────────── */}
      {activeTab && (
        <div
          className="flex items-stretch gap-px rounded-sm border shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
          style={{ background: '#131313', borderColor: '#393939' }}
        >
          {/* Hierarchy info */}
          <button
            onClick={() => setShowHierarchyEditor(true)}
            title="Edit rank · unit · commander · parent"
            className="flex flex-1 items-center gap-2 px-2.5 py-1.5 text-left transition hover:bg-white/[0.06]"
            style={{ borderRight: '1px solid #393939' }}
          >
            <Shield size={11} className="shrink-0 text-white/45" />
            <div className="min-w-0">
              <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.04em] text-white/85">
                {RANK_NAMES[activeTab.rank]}{activeTab.unit && ` · ${activeTab.unit}`}
              </p>
              {activeTab.commanderName && (
                <p className="truncate font-mono text-[9px] text-white/35">{activeTab.commanderName}</p>
              )}
            </div>
            <Edit2 size={9} className="ml-auto shrink-0 text-white/30" />
          </button>

          {/* Quick actions */}
          <button
            onClick={handleSnapshot}
            title="Snapshot current phase"
            className="flex items-center justify-center px-2 text-white/45 transition hover:bg-white/[0.06] hover:text-white"
            style={{ borderRight: '1px solid #393939' }}
          >
            <Camera size={12} />
          </button>
          <button
            onClick={handleSaveActiveTab}
            disabled={saving}
            title="Save file"
            className="flex items-center justify-center px-2 transition disabled:opacity-30"
            style={{
              background: activeTab.isDirty ? '#fff' : 'transparent',
              color: activeTab.isDirty ? '#131313' : 'rgba(255,255,255,0.45)',
              borderRight: '1px solid #393939',
            }}
          >
            {saving
              ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
              : <Save size={12} />}
          </button>
          <button
            onClick={() => handleExport(activeTab.id, activeTab.name)}
            title="Export .ipb.json"
            className="flex items-center justify-center px-2 text-white/45 transition hover:bg-white/[0.06] hover:text-white"
          >
            <Download size={12} />
          </button>
        </div>
      )}

      {/* ── Phase switcher (when active tab has more than one phase) ──────── */}
      {activeTab && activeTab.phases.length > 1 && (
        <div
          className="rounded-sm border px-2 py-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
          style={{ background: '#0e0e0e', borderColor: '#393939' }}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <Layers size={9} className="text-white/30" />
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">Phases</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {activeTab.phases.map((ph) => {
              const isActive = ph.id === activeTab.activePhaseId;
              return (
                <button
                  key={ph.id}
                  onClick={() => handleSwitchPhase(ph.id)}
                  className="rounded-sm border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] transition"
                  style={{
                    borderColor: isActive ? ph.color ?? '#3b82f6' : '#393939',
                    background: isActive ? (ph.color ?? '#3b82f6') + '20' : 'transparent',
                    color: isActive ? ph.color ?? '#3b82f6' : 'rgba(255,255,255,0.40)',
                    fontWeight: isActive ? 700 : 400,
                  }}
                >
                  {ph.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Combine bar (when overlays are active) ─────────────────────────── */}
      {activeTab && overlayInfos.length > 0 && (
        <div
          className="rounded-sm border shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
          style={{ background: '#131313', borderColor: '#393939' }}
        >
          <div className="flex items-center justify-between border-b px-2 py-1" style={{ borderColor: '#2a2a2a' }}>
            <div className="flex items-center gap-1.5">
              <Users size={9} className="text-white/40" />
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/40">
                Subordinate Overlays ({overlayInfos.length})
              </span>
            </div>
            <button
              onClick={() => useOpenFilesStore.getState().clearOverlays()}
              className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/30 hover:text-white/70"
            >
              Clear all
            </button>
          </div>
          <div className="divide-y" style={{ borderColor: '#2a2a2a' }}>
            {overlayInfos.map(({ tab: t, color, featureCount }) => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-mono text-[10px] font-semibold text-white/90">
                      {t.unit || t.name}
                    </span>
                    <span
                      className="shrink-0 rounded-sm border px-1 py-px font-mono text-[8px] uppercase tracking-[0.06em] text-white/50"
                      style={{ borderColor: color + '60' }}
                    >
                      {RANK_NAMES[t.rank].slice(0, 3)}
                    </span>
                  </div>
                  <p className="font-mono text-[9px] text-white/30">
                    {featureCount} shape{featureCount === 1 ? '' : 's'}
                    {t.commanderName && ` · ${t.commanderName}`}
                  </p>
                </div>
                <button
                  onClick={() => handleMergeOverlay(t.id)}
                  title={`Merge ${featureCount} shape${featureCount === 1 ? '' : 's'} into active phase`}
                  className="flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] transition hover:border-white hover:bg-white hover:text-black"
                  style={{ borderColor: color + '60', color }}
                >
                  <GitMerge size={9} />
                  Merge
                </button>
                <button
                  onClick={() => handleToggleOverlay(t.id)}
                  title="Stop overlay"
                  className="shrink-0 rounded-sm p-1 text-white/35 hover:text-white"
                >
                  <EyeOff size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Expanded panel ──────────────────────────────────────────────────── */}
      {open && (
        <div
          className="flex flex-col overflow-hidden rounded-sm border shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
          style={{ background: '#131313', borderColor: '#393939', maxHeight: '60vh' }}
        >
          {/* Sub-toolbar */}
          <div className="flex items-center gap-1.5 border-b p-2" style={{ borderColor: '#393939' }}>
            {view === 'save' ? (
              <button
                onClick={() => setView('browser')}
                className="flex items-center gap-1 font-mono text-[10px] text-white/50 hover:text-white"
              >
                <ChevronLeft size={11} /> Back
              </button>
            ) : (
              <>
                <div className="relative flex-1">
                  <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search files…"
                    className="w-full rounded-sm border py-1.5 pl-6 pr-6 font-mono text-[10px] text-white placeholder-white/25 outline-none"
                    style={{ background: '#1a1a1a', borderColor: '#393939' }}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white">
                      <X size={9} />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    setView('save');
                    // Pre-fill from active tab's hierarchy info so a new file
                    // under the same chain of command is one click away.
                    if (activeTab) {
                      setSaveRank(activeTab.rank);
                      setSaveUnit('');
                      setSaveCommander(activeTab.commanderName);
                      setSaveParentId(activeTab.id);
                    }
                  }}
                  title="Save current map as new file"
                  className="flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/60 transition hover:border-white hover:bg-white hover:text-black"
                  style={{ borderColor: '#393939', background: '#1a1a1a' }}
                >
                  <FilePlus size={11} />
                  New
                </button>
              </>
            )}
          </div>

          {/* ── Save view ─────────────────────────────────────────────────── */}
          {view === 'save' && (
            <div className="flex flex-col gap-3 overflow-y-auto p-3">
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">File name</label>
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder={`Mission ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
                  className="w-full rounded-sm border px-2 py-1.5 font-mono text-[12px] text-white placeholder-white/25 outline-none focus:border-white/60"
                  style={{ background: '#1a1a1a', borderColor: '#393939' }}
                />
              </div>

              {folders.length > 0 && (
                <div>
                  <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">Folder</label>
                  <select
                    value={saveFolderId ?? ''}
                    onChange={(e) => setSaveFolderId(e.target.value || null)}
                    className="w-full rounded-sm border px-2 py-1.5 font-mono text-[11px] text-white outline-none"
                    style={{ background: '#1a1a1a', borderColor: '#393939' }}
                  >
                    <option value="">Root — no folder</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              )}

              {/* Rank picker */}
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
                  Echelon — {RANK_NAMES[saveRank]}
                </label>
                <div className="grid grid-cols-7 gap-1">
                  {RANK_LEVELS.map(({ rank: r }) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setSaveRank(r);
                        // Drop parent if it no longer outranks
                        if (saveParentId) {
                          const p = files.find((f) => f.id === saveParentId);
                          if (p && ((p.rank ?? 3) as number) <= r) setSaveParentId(null);
                        }
                      }}
                      className="rounded-sm border py-1 font-mono text-[10px] transition"
                      style={{
                        borderColor: saveRank === r ? '#fff' : '#393939',
                        background: saveRank === r ? '#fff' : '#1a1a1a',
                        color: saveRank === r ? '#131313' : 'rgba(255,255,255,0.45)',
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Unit + commander */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">Unit</label>
                  <input
                    value={saveUnit}
                    onChange={(e) => setSaveUnit(e.target.value)}
                    placeholder="e.g. 1 Plt"
                    className="w-full rounded-sm border px-2 py-1.5 font-mono text-[11px] text-white placeholder-white/25 outline-none focus:border-white/60"
                    style={{ background: '#1a1a1a', borderColor: '#393939' }}
                  />
                </div>
                <div>
                  <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">Commander</label>
                  <input
                    value={saveCommander}
                    onChange={(e) => setSaveCommander(e.target.value)}
                    placeholder="e.g. LT Park"
                    className="w-full rounded-sm border px-2 py-1.5 font-mono text-[11px] text-white placeholder-white/25 outline-none focus:border-white/60"
                    style={{ background: '#1a1a1a', borderColor: '#393939' }}
                  />
                </div>
              </div>

              {/* Parent file */}
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
                  Reports to (higher commander)
                </label>
                <select
                  value={saveParentId ?? ''}
                  onChange={(e) => setSaveParentId(e.target.value || null)}
                  className="w-full rounded-sm border px-2 py-1.5 font-mono text-[11px] text-white outline-none"
                  style={{ background: '#1a1a1a', borderColor: '#393939' }}
                >
                  <option value="">— No parent —</option>
                  {files
                    .filter((f) => ((f.rank ?? 3) as number) > saveRank)
                    .sort((a, b) => ((b.rank ?? 3) - (a.rank ?? 3)))
                    .map((f) => {
                      const rn = RANK_NAMES[(f.rank ?? 3) as Rank];
                      return <option key={f.id} value={f.id}>{f.name} [{rn}{f.unit ? ' · ' + f.unit : ''}]</option>;
                    })}
                </select>
              </div>

              {/* Phase count */}
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
                  Phases — current state saves to Phase 1
                </label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSavePhaseCount(n)}
                      className="h-8 flex-1 rounded-sm border font-mono text-[11px] font-semibold transition"
                      style={{
                        borderColor: savePhaseCount === n ? '#fff' : '#393939',
                        background: savePhaseCount === n ? '#fff' : '#1a1a1a',
                        color: savePhaseCount === n ? '#131313' : 'rgba(255,255,255,0.50)',
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleSaveNew}
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-sm py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition disabled:opacity-40"
                style={{ background: '#fff', color: '#131313' }}
              >
                {saving
                  ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/20 border-t-black" />
                  : <Save size={13} />}
                Save File
              </button>
            </div>
          )}

          {/* ── Browser view ─────────────────────────────────────────────── */}
          {view === 'browser' && (
            <div className="flex flex-1 flex-col overflow-y-auto">
              {isSearching ? (
                <div className="p-2">
                  <SectionLabel icon={<Search size={9} />} label={searchResults ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}` : 'Searching…'} />
                  <div className="space-y-0.5">
                    {(searchResults ?? []).map((file) => (
                      <FileRow key={file.id} file={file} indent={0}
                        isOpen={tabs.some((t) => t.id === file.id)} openingId={openingId}
                        onOpen={handleOpen}
                        onRename={(id, name) => renameMut.mutate({ id, name })}
                        onDuplicate={(id) => duplicateMut.mutate(id)}
                        onDelete={handleDeleteFile}
                        onExport={handleExport}
                      />
                    ))}
                    {searchResults?.length === 0 && (
                      <p className="px-2 font-mono text-[11px] text-white/30">No results</p>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {recent && recent.length > 0 && (
                    <div className="border-b p-2" style={{ borderColor: '#2a2a2a' }}>
                      <SectionLabel icon={<Clock size={9} />} label="Recent" />
                      <div className="space-y-0.5">
                        {recent.map((file) => (
                          <FileRow key={file.id} file={file} indent={0}
                            isOpen={tabs.some((t) => t.id === file.id)} openingId={openingId}
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

                  <div className="flex-1 overflow-y-auto p-2">
                    <div className="mb-1 flex items-center justify-between px-1">
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">All Files</span>
                      <button
                        onClick={() => { setNewFolderParent(null); setNewFolderName(''); }}
                        title="New folder"
                        className="rounded-sm p-0.5 text-white/30 hover:text-white"
                      >
                        <FolderPlus size={11} />
                      </button>
                    </div>

                    {treeLoading ? (
                      <div className="flex items-center gap-2 px-2 py-3">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/50" />
                        <span className="font-mono text-[10px] text-white/35">Loading…</span>
                      </div>
                    ) : (
                      <div className="space-y-0.5">
                        {newFolderParent === null && (
                          <NewFolderInput
                            indent={0} value={newFolderName} onChange={setNewFolderName}
                            onConfirm={() => newFolderName.trim() && createFolderMut.mutate({ name: newFolderName.trim(), parentId: null })}
                            onCancel={() => { setNewFolderParent(undefined); setNewFolderName(''); }}
                          />
                        )}
                        {renderTree(null, 0)}
                        {files.length === 0 && folders.length === 0 && (
                          <div className="py-6 text-center">
                            <p className="font-mono text-[10px] text-white/25">No files yet</p>
                            <p className="mt-1 font-mono text-[9px] text-white/15">Click New to save the current map</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border-t p-2" style={{ borderColor: '#2a2a2a' }}>
                    <button
                      onClick={() => importRef.current?.click()}
                      className="flex w-full items-center justify-center gap-1.5 rounded-sm border py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35 transition hover:text-white/60"
                      style={{ borderColor: '#393939', background: '#0e0e0e' }}
                    >
                      <Upload size={10} />
                      Import .ipb.json
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Hierarchy editor modal ─────────────────────────────────────────── */}
      {showHierarchyEditor && activeTab && (
        <HierarchyEditor tab={activeTab} onClose={() => setShowHierarchyEditor(false)} />
      )}
    </div>
  );
}
