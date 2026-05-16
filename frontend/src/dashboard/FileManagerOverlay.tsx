/**
 * FileManagerOverlay — floating top-left file manager panel.
 *
 * Always-visible compact strip shows the active file + toggle button.
 * When expanded: full file browser panel (300px wide, up to 70vh tall).
 *
 * Tactile Noir: solid #131313, #393939 borders, inverted white active state.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
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
  MoreHorizontal,
  Save,
  Search,
  Trash2,
  Upload,
  X,
  FilePlus,
  FolderArchive,
  ChevronLeft,
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
import type { DrawnFeature, FsFileMeta, FsFolder, IpbExportV2, LayerKey } from '../api/types';
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

// ── Helpers ────────────────────────────────────────────────────────────────────

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

interface ActiveFile {
  id: string;
  name: string;
}

interface MapState {
  bbox: [number, number, number, number] | null;
  center: [number, number] | null;
  zoom: number | null;
  timeline_selected_ms: number | null;
  active_layers: LayerKey[];
  drawn_features: FeatureCollection;
  layer_snapshots: Record<string, FeatureCollection>;
}

// ── Small shared components ────────────────────────────────────────────────────

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
    { label: 'Rename',    icon: <Edit2 size={10} />,    onClick: () => setRenaming(true) },
    { label: 'Duplicate', icon: <Copy size={10} />,     onClick: () => onDuplicate(file.id) },
    { label: 'Export',    icon: <Download size={10} />, onClick: () => onExport(file.id, file.name) },
    { label: 'Delete',    icon: <Trash2 size={10} />,   danger: true, onClick: () => onDelete(file.id, file.name) },
  ];

  return (
    <div
      style={{ paddingLeft: `${indent * 14 + 8}px` }}
      title={`${fmtFull(file.updated_at)} · ${file.layer_count} layers · ${file.feature_count} features`}
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
          <span className={`block truncate font-mono text-[11px] ${isOpen ? 'font-semibold' : ''}`}>
            {file.name}
          </span>
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
      <button onClick={onConfirm} disabled={!value.trim()} className="rounded-sm p-0.5 text-emerald-400 disabled:opacity-30">
        <Check size={11} />
      </button>
      <button onClick={onCancel} className="rounded-sm p-0.5 text-white/40">
        <X size={11} />
      </button>
    </div>
  );
}

// ── Main overlay ───────────────────────────────────────────────────────────────

export default function FileManagerOverlay() {
  const qc   = useQueryClient();
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

  const [open, setOpen]                       = useState(false);
  const [view, setView]                       = useState<'browser' | 'save'>('browser');
  const [activeFile, setActiveFile]           = useState<ActiveFile | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery]         = useState('');
  const [openingId, setOpeningId]             = useState<string | null>(null);
  const [saving, setSaving]                   = useState(false);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName]     = useState('');

  // Save form state
  const [saveName, setSaveName]     = useState('');
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null);

  const importRef = useRef<HTMLInputElement>(null);

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['fs-tree'],
    queryFn: fsGetTree,
    staleTime: 10_000,
    enabled: open,
  });

  const { data: recent } = useQuery({
    queryKey: ['fs-recent'],
    queryFn: () => fsGetRecent(5),
    staleTime: 10_000,
    enabled: open,
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

  const captureCurrentState = useCallback((): MapState => {
    const snapshots: Record<string, FeatureCollection> = {};
    for (const k of ALL_LAYER_KEYS) {
      const feats = featureCache[k];
      if (feats && feats.length > 0) snapshots[k] = { type: 'FeatureCollection', features: feats };
    }
    const activeIds = ALL_LAYER_KEYS.filter((k) => activeLayers[k]);
    let center: [number, number] | null = null;
    let zoom: number | null = null;
    if (map) { const c = map.getCenter(); center = [c.lat, c.lng]; zoom = map.getZoom(); }
    const bboxArr = bbox ? (parseBbox(bbox) as [number, number, number, number]) : null;
    return {
      bbox: bboxArr, center, zoom,
      timeline_selected_ms: selectedMs,
      active_layers: activeIds,
      drawn_features: drawnFeatures,
      layer_snapshots: snapshots,
    };
  }, [featureCache, activeLayers, bbox, drawnFeatures, map, selectedMs]);

  const loadStateIntoMap = useCallback((state: {
    bbox?: [number, number, number, number] | null;
    center?: [number, number] | null;
    zoom?: number | null;
    timeline_selected_ms?: number | null;
    active_layers?: string[];
    drawn_features?: FeatureCollection;
    layer_snapshots?: Record<string, FeatureCollection>;
  }) => {
    clearAllCache();
    if (state.layer_snapshots && Object.keys(state.layer_snapshots).length > 0) {
      injectSnapshots(state.layer_snapshots as Record<string, { features: Feature[] }>, state.bbox ?? undefined);
    }
    setActiveLayers((state.active_layers ?? []) as LayerKey[]);
    setAllDrawn((state.drawn_features?.features ?? []) as DrawnFeature[]);
    if (state.timeline_selected_ms != null) setSelectedMs(state.timeline_selected_ms);
    if (map) {
      if (state.bbox) { const [w, s, e, n] = state.bbox; map.fitBounds([[s, w], [n, e]], { animate: true, duration: 0.6 }); }
      else if (state.center && state.zoom != null) { map.flyTo([state.center[0], state.center[1]], state.zoom, { animate: true, duration: 0.6 }); }
    }
  }, [clearAllCache, injectSnapshots, setActiveLayers, setAllDrawn, setSelectedMs, map]);

  const handleOpen = useCallback(async (file: FsFileMeta) => {
    setOpeningId(file.id);
    try {
      const content = await fsOpenFile(file.id);
      loadStateIntoMap({
        bbox: content.bbox ?? null,
        center: content.center ?? null,
        zoom: content.zoom ?? null,
        timeline_selected_ms: content.timeline_selected_ms ?? null,
        active_layers: content.active_layers ?? [],
        drawn_features: content.drawn_features ?? { type: 'FeatureCollection', features: [] },
        layer_snapshots: (content.layer_snapshots as Record<string, FeatureCollection>) ?? {},
      });
      setActiveFile({ id: content.id, name: content.name });
      push('success', `Opened: ${content.name}`);
    } catch (e) {
      push('error', `Failed to open: ${String(e)}`);
    } finally {
      setOpeningId(null);
    }
  }, [loadStateIntoMap, push]);

  const handleSaveActiveFile = useCallback(async () => {
    if (!activeFile) return;
    setSaving(true);
    try {
      const s = captureCurrentState();
      await fsSaveFile({
        id: activeFile.id, name: activeFile.name,
        bbox: s.bbox, center: s.center, zoom: s.zoom,
        timeline_selected_ms: s.timeline_selected_ms,
        active_layers: s.active_layers,
        drawn_features: s.drawn_features,
        layer_snapshots: s.layer_snapshots,
      });
      push('success', `Saved: ${activeFile.name}`);
      refetchAll();
    } catch (e) {
      push('error', `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [activeFile, captureCurrentState, push, refetchAll]);

  const handleSaveNew = useCallback(async () => {
    const name = saveName.trim() || `Mission ${new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    setSaving(true);
    try {
      const s = captureCurrentState();
      const meta = await fsSaveFile({
        name, folder_id: saveFolderId,
        bbox: s.bbox, center: s.center, zoom: s.zoom,
        timeline_selected_ms: s.timeline_selected_ms,
        active_layers: s.active_layers,
        drawn_features: s.drawn_features,
        layer_snapshots: s.layer_snapshots,
      });
      setView('browser');
      setSaveName('');
      setActiveFile({ id: meta.id, name: meta.name });
      push('success', `Saved: ${name}`);
      refetchAll();
    } catch (e) {
      push('error', `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [saveName, saveFolderId, captureCurrentState, push, refetchAll]);

  const handleExport = useCallback(async (id: string, name: string) => {
    try { await fsExportDownload(id, name); push('success', `Exported: ${name}.ipb.json`); }
    catch (e) { push('error', `Export failed: ${String(e)}`); }
  }, [push]);

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

  // Mutations
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

  const handleDeleteFile   = useCallback((id: string, name: string) => { if (window.confirm(`Delete "${name}"?`)) deleteFileMut.mutate(id); }, [deleteFileMut]);
  const handleDeleteFolder = useCallback((id: string, name: string) => { if (window.confirm(`Delete folder "${name}" and all its contents?`)) deleteFolderMut.mutate({ id, recursive: true }); }, [deleteFolderMut]);

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
            isOpen={activeFile?.id === file.id} openingId={openingId}
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
    <div className="pointer-events-auto absolute left-3 top-[76px] z-[900] flex flex-col gap-0" style={{ width: 300 }}>
      <input ref={importRef} type="file" accept=".json,.ipb.json" className="hidden" onChange={handleImportFile} />

      {/* ── Header strip — always visible ─────────────────────────────── */}
      <div
        className="flex items-center gap-0 rounded-sm border shadow-[0_4px_16px_rgba(0,0,0,0.7)]"
        style={{ background: '#131313', borderColor: open ? '#fff' : '#393939' }}
      >
        {/* Toggle button + icon */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 px-2.5 py-2 transition hover:bg-white/[0.06]"
          title={open ? 'Close file manager' : 'Open file manager'}
        >
          <FolderArchive size={13} className={open ? 'text-white' : 'text-white/55'} />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">Files</span>
        </button>

        {/* Active file name — fills remaining space */}
        <div className="min-w-0 flex-1 overflow-hidden px-1">
          {activeFile ? (
            <div className="flex items-center gap-1.5 overflow-hidden">
              <span className="truncate font-mono text-[11px] font-semibold text-white" title={activeFile.name}>
                {activeFile.name}
              </span>
            </div>
          ) : (
            <span className="font-mono text-[10px] text-white/25">No file open</span>
          )}
        </div>

        {/* Quick actions when a file is open */}
        {activeFile && (
          <div className="flex items-center pr-1">
            <button
              onClick={handleSaveActiveFile}
              disabled={saving}
              title="Save file"
              className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
            >
              {saving
                ? <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
                : <Save size={12} />}
            </button>
            <button
              onClick={() => handleExport(activeFile.id, activeFile.name)}
              title="Export .ipb.json"
              className="rounded-sm p-1 text-white/35 hover:bg-white/[0.06] hover:text-white"
            >
              <Download size={12} />
            </button>
            <button
              onClick={() => setActiveFile(null)}
              title="Close file"
              className="rounded-sm p-1 text-white/25 hover:text-red-400"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {/* Expand/collapse chevron */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-sm p-2 text-white/30 hover:text-white"
        >
          {open ? <ChevronLeft size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {/* ── Expanded panel ──────────────────────────────────────────────── */}
      {open && (
        <div
          className="flex flex-col gap-0 overflow-hidden rounded-b-sm border-x border-b shadow-[0_8px_32px_rgba(0,0,0,0.8)]"
          style={{ background: '#131313', borderColor: '#393939', maxHeight: '68vh' }}
        >
          {/* Sub-toolbar: search + new + back */}
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
                  onClick={() => { setView('save'); setSaveName(''); }}
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

          {/* ── Save view ─────────────────────────────────────────────── */}
          {view === 'save' && (
            <div className="flex flex-col gap-3 overflow-y-auto p-3">
              <div>
                <label className="mb-1 block font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">File name</label>
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNew(); }}
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

          {/* ── Browser view ──────────────────────────────────────────── */}
          {view === 'browser' && (
            <div className="flex flex-1 flex-col overflow-y-auto">
              {isSearching ? (
                <div className="p-2">
                  <p className="mb-1 px-1 font-mono text-[9px] uppercase tracking-[0.1em] text-white/35">
                    {searchResults ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}` : 'Searching…'}
                  </p>
                  <div className="space-y-0.5">
                    {(searchResults ?? []).map((file) => (
                      <FileRow key={file.id} file={file} indent={0}
                        isOpen={activeFile?.id === file.id} openingId={openingId}
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
                  {/* Recent */}
                  {recent && recent.length > 0 && (
                    <div className="border-b p-2" style={{ borderColor: '#2a2a2a' }}>
                      <div className="mb-1 flex items-center gap-1.5 px-1">
                        <Clock size={9} className="text-white/30" />
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/30">Recent</span>
                      </div>
                      <div className="space-y-0.5">
                        {recent.map((file) => (
                          <FileRow key={file.id} file={file} indent={0}
                            isOpen={activeFile?.id === file.id} openingId={openingId}
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

                  {/* All files */}
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

                  {/* Import */}
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
    </div>
  );
}
