import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Folder,
  FolderOpen,
  FileText,
  Plus,
  Save,
  Search,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  Edit2,
  Copy,
  FolderPlus,
  Clock,
  Layers,
  MapPin,
  X,
  Check,
} from 'lucide-react';
import {
  fsGetTree,
  fsGetRecent,
  fsSearch,
  fsOpenFile,
  fsSaveFile,
  fsRenameFile,
  fsDuplicateFile,
  fsDeleteFile,
  fsCreateFolder,
  fsRenameFolder,
  fsDeleteFolder,
} from '../api/client';
import type { FsFolder, FsFileMeta, LayerKey } from '../api/types';
import type { FeatureCollection } from 'geojson';
import {
  useBboxStore,
  useDrawnStore,
  useFeatureCacheStore,
  useLayerStore,
  useMapStore,
  useTimelineStore,
  useToastStore,
  parseBbox,
} from '../store';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const ALL_LAYER_KEYS: LayerKey[] = [
  'osm', 'digiroad', 'mml', 'mml_contours', 'statfin',
  'syke', 'fmi', 'fmi_forecast', 'astronomy',
  'opencellid', 'n2yo', 'exposure', 'mcoo',
];

// ── Save dialog ───────────────────────────────────────────────────────────────

interface SaveDialogProps {
  defaultName: string;
  folders: FsFolder[];
  onSave: (name: string, folderId: string | null) => void;
  onCancel: () => void;
  saving: boolean;
}

function SaveDialog({ defaultName, folders, onSave, onCancel, saving }: SaveDialogProps) {
  const [name, setName] = useState(defaultName);
  const [folderId, setFolderId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="rounded border border-white/20 bg-[#1a1a1a] p-3 shadow-xl">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70">
        Save Project File
      </p>
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onSave(name.trim(), folderId);
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="File name…"
        className="mb-2 w-full rounded border border-white/20 bg-black/60 px-2 py-1.5 text-[12px] text-white placeholder-white/35 outline-none focus:border-white/50"
      />
      {folders.length > 0 && (
        <select
          value={folderId ?? ''}
          onChange={(e) => setFolderId(e.target.value || null)}
          className="mb-3 w-full rounded border border-white/20 bg-black/60 px-2 py-1.5 text-[12px] text-white/90 outline-none"
        >
          <option value="">Root (no folder)</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => name.trim() && onSave(name.trim(), folderId)}
          disabled={saving || !name.trim()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-black hover:bg-white/90 disabled:opacity-40"
        >
          {saving ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-black/30 border-t-black" />
          ) : (
            <Save size={11} />
          )}
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

// ── Inline rename input ───────────────────────────────────────────────────────

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
      onBlur={() => val.trim() ? onConfirm(val.trim()) : onCancel()}
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

// ── Context menu ──────────────────────────────────────────────────────────────

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
}

function ContextMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-0.5 min-w-[150px] rounded border border-white/15 bg-[#1c1c1c] py-1 shadow-xl"
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

interface FileRowProps {
  file: FsFileMeta;
  indent: number;
  openingId: string | null;
  onOpen: (file: FsFileMeta) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string, name: string) => void;
}

function FileRow({ file, indent, openingId, onOpen, onRename, onDuplicate, onDelete }: FileRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const isOpening = openingId === file.id;

  const menuItems: MenuItem[] = [
    { label: 'Rename', icon: <Edit2 size={11} />, onClick: () => setRenaming(true) },
    { label: 'Duplicate', icon: <Copy size={11} />, onClick: () => onDuplicate(file.id) },
    { label: 'Delete', icon: <Trash2 size={11} />, danger: true, onClick: () => onDelete(file.id, file.name) },
  ];

  return (
    <div
      style={{ paddingLeft: `${indent * 12 + 8}px` }}
      className={`group relative flex cursor-pointer items-center gap-1.5 rounded py-1 pr-1 text-[11px] transition hover:bg-white/[0.05] ${
        isOpening ? 'opacity-60' : ''
      }`}
      onClick={() => !renaming && onOpen(file)}
      title={`${fmtFull(file.updated_at)}\n${file.layer_count} layers · ${file.feature_count} features`}
    >
      {isOpening ? (
        <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
      ) : (
        <FileText size={12} className="shrink-0 text-white/50" />
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
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {file.layer_count > 0 && (
            <span className="flex items-center gap-0.5 text-[10px] text-white/40">
              <Layers size={9} />
              {file.layer_count}
            </span>
          )}
          <span className="text-[10px] text-white/35">{fmtRelative(file.updated_at)}</span>
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              className="rounded p-0.5 text-white/50 hover:bg-white/10 hover:text-white"
            >
              <MoreHorizontal size={12} />
            </button>
            {menuOpen && <ContextMenu items={menuItems} onClose={() => setMenuOpen(false)} />}
          </div>
        </div>
      )}

      {!renaming && (
        <span className="ml-1 shrink-0 text-[10px] text-white/30 group-hover:hidden">
          {fmtRelative(file.updated_at)}
        </span>
      )}
    </div>
  );
}

// ── Folder row ────────────────────────────────────────────────────────────────

interface FolderRowProps {
  folder: FsFolder;
  indent: number;
  expanded: boolean;
  onToggle: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, name: string) => void;
  onCreateSubfolder: (parentId: string) => void;
}

function FolderRow({
  folder, indent, expanded, onToggle, onRename, onDelete, onCreateSubfolder,
}: FolderRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const menuItems: MenuItem[] = [
    { label: 'New subfolder', icon: <FolderPlus size={11} />, onClick: () => onCreateSubfolder(folder.id) },
    { label: 'Rename', icon: <Edit2 size={11} />, onClick: () => setRenaming(true) },
    { label: 'Delete', icon: <Trash2 size={11} />, danger: true, onClick: () => onDelete(folder.id, folder.name) },
  ];

  return (
    <div
      style={{ paddingLeft: `${indent * 12 + 4}px` }}
      className="group relative flex cursor-pointer items-center gap-1.5 rounded py-1 pr-1 text-[11px] transition hover:bg-white/[0.05]"
      onClick={() => !renaming && onToggle()}
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
          {menuOpen && <ContextMenu items={menuItems} onClose={() => setMenuOpen(false)} />}
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FileSystemPanel() {
  const qc = useQueryClient();
  const push = useToastStore((s) => s.push);

  // State from other stores — for save and open
  const bbox = useBboxStore((s) => s.bbox);
  const drawnFeatures = useDrawnStore((s) => s.toCollection());
  const setAllDrawn = useDrawnStore((s) => s.setAll);
  const activeLayers = useLayerStore((s) => s.active);
  const setActiveLayers = useLayerStore((s) => s.setActiveLayers);
  const featureCache = useFeatureCacheStore((s) => s.features);
  const injectSnapshots = useFeatureCacheStore((s) => s.injectSnapshots);
  const clearAllCache = useFeatureCacheStore((s) => s.clearAll);
  const selectedMs = useTimelineStore((s) => s.selectedMs);
  const setSelectedMs = useTimelineStore((s) => s.setSelectedMs);
  const map = useMapStore((s) => s.map);

  // UI state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined); // undefined = not creating
  const [newFolderName, setNewFolderName] = useState('');

  // Data queries
  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['fs-tree'],
    queryFn: fsGetTree,
    staleTime: 10_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['fs-recent'],
    queryFn: () => fsGetRecent(5),
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

  // ── Save current state ───────────────────────────────────────────────────────

  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async (name: string, folderId: string | null) => {
    setSaving(true);
    try {
      // Build layer snapshots from feature cache
      const snapshots: Record<string, FeatureCollection> = {};
      for (const layerKey of ALL_LAYER_KEYS) {
        const feats = featureCache[layerKey];
        if (feats && feats.length > 0) {
          snapshots[layerKey] = { type: 'FeatureCollection', features: feats };
        }
      }

      // Get active layer IDs
      const activeIds = ALL_LAYER_KEYS.filter((k) => activeLayers[k]);

      // Get map center and zoom
      let center: [number, number] | null = null;
      let zoom: number | null = null;
      if (map) {
        const c = map.getCenter();
        center = [c.lat, c.lng];
        zoom = map.getZoom();
      }

      // Parse bbox
      const bboxArr = bbox ? (parseBbox(bbox) as [number, number, number, number]) : null;

      await fsSaveFile({
        name,
        folder_id: folderId,
        bbox: bboxArr,
        center,
        zoom,
        timeline_selected_ms: selectedMs,
        active_layers: activeIds,
        drawn_features: drawnFeatures,
        layer_snapshots: snapshots,
      });

      push('success', `Saved: ${name}`);
      setShowSaveDialog(false);
      refetchAll();
    } catch (e) {
      push('error', `Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [featureCache, activeLayers, bbox, drawnFeatures, map, selectedMs, push, refetchAll]);

  // ── Open file ────────────────────────────────────────────────────────────────

  const handleOpen = useCallback(async (file: FsFileMeta) => {
    setOpeningId(file.id);
    try {
      const content = await fsOpenFile(file.id);

      // 1. Clear existing feature cache, then inject saved snapshots
      clearAllCache();
      if (content.layer_snapshots && Object.keys(content.layer_snapshots).length > 0) {
        injectSnapshots(
          content.layer_snapshots as Record<string, { features: import('geojson').Feature[] }>,
          content.bbox ?? undefined,
        );
      }

      // 2. Restore active layers
      if (Array.isArray(content.active_layers)) {
        setActiveLayers(content.active_layers as LayerKey[]);
      }

      // 3. Restore drawn features
      if (content.drawn_features?.features) {
        setAllDrawn(content.drawn_features.features as import('../api/types').DrawnFeature[]);
      }

      // 4. Restore timeline position
      if (content.timeline_selected_ms != null) {
        setSelectedMs(content.timeline_selected_ms);
      }

      // 5. Fly to saved viewport
      if (map) {
        if (content.bbox) {
          const [w, s, e, n] = content.bbox;
          map.fitBounds([[s, w], [n, e]], { animate: true, duration: 0.6 });
        } else if (content.center && content.zoom != null) {
          map.flyTo([content.center[0], content.center[1]], content.zoom, { animate: true, duration: 0.6 });
        }
      }

      push('success', `Opened: ${content.name}`);
    } catch (e) {
      push('error', `Failed to open: ${String(e)}`);
    } finally {
      setOpeningId(null);
    }
  }, [clearAllCache, injectSnapshots, setActiveLayers, setAllDrawn, setSelectedMs, map, push]);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => fsRenameFile(id, name),
    onSuccess: () => refetchAll(),
    onError: () => push('error', 'Rename failed'),
  });

  const duplicateMut = useMutation({
    mutationFn: (id: string) => fsDuplicateFile(id),
    onSuccess: (f) => { refetchAll(); push('success', `Duplicated: ${f.name}`); },
    onError: () => push('error', 'Duplicate failed'),
  });

  const deleteFileMut = useMutation({
    mutationFn: (id: string) => fsDeleteFile(id),
    onSuccess: () => { refetchAll(); push('info', 'File deleted'); },
    onError: () => push('error', 'Delete failed'),
  });

  const renameFolderMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => fsRenameFolder(id, name),
    onSuccess: () => refetchAll(),
    onError: () => push('error', 'Rename failed'),
  });

  const deleteFolderMut = useMutation({
    mutationFn: ({ id, recursive }: { id: string; recursive: boolean }) => fsDeleteFolder(id, recursive),
    onSuccess: () => { refetchAll(); push('info', 'Folder deleted'); },
    onError: (e) => push('error', String(e)),
  });

  const createFolderMut = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: string | null }) =>
      fsCreateFolder(name, parentId),
    onSuccess: (f) => {
      refetchAll();
      setExpandedFolders((s) => new Set([...s, ...(f.parent_id ? [f.parent_id] : [])]));
      setNewFolderParent(undefined);
      setNewFolderName('');
      push('success', `Created folder: ${f.name}`);
    },
    onError: () => push('error', 'Create folder failed'),
  });

  // ── Delete confirmation ──────────────────────────────────────────────────────

  const handleDeleteFile = useCallback((id: string, name: string) => {
    if (window.confirm(`Delete "${name}"? This cannot be undone.`)) {
      deleteFileMut.mutate(id);
    }
  }, [deleteFileMut]);

  const handleDeleteFolder = useCallback((id: string, name: string) => {
    if (window.confirm(`Delete folder "${name}" and all its contents?`)) {
      deleteFolderMut.mutate({ id, recursive: true });
    }
  }, [deleteFolderMut]);

  // ── Tree rendering ───────────────────────────────────────────────────────────

  const folders = tree?.folders ?? [];
  const files = tree?.files ?? [];

  const toggleFolder = (id: string) =>
    setExpandedFolders((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  function renderTree(parentId: string | null, depth: number): React.ReactNode {
    const childFolders = folders.filter((f) => f.parent_id === parentId);
    const childFiles = files.filter((f) => f.folder_id === parentId);

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
              onCreateSubfolder={(pid) => {
                setNewFolderParent(pid);
                setExpandedFolders((s) => new Set([...s, pid]));
              }}
            />
            {expandedFolders.has(folder.id) && (
              <div>{renderTree(folder.id, depth + 1)}</div>
            )}
            {newFolderParent === folder.id && expandedFolders.has(folder.id) && (
              <NewFolderInput
                indent={depth + 1}
                value={newFolderName}
                onChange={setNewFolderName}
                onConfirm={() => {
                  if (newFolderName.trim()) {
                    createFolderMut.mutate({ name: newFolderName.trim(), parentId: folder.id });
                  }
                }}
                onCancel={() => { setNewFolderParent(undefined); setNewFolderName(''); }}
              />
            )}
          </div>
        ))}

        {childFiles.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            indent={depth}
            openingId={openingId}
            onOpen={handleOpen}
            onRename={(id, name) => renameMut.mutate({ id, name })}
            onDuplicate={(id) => duplicateMut.mutate(id)}
            onDelete={handleDeleteFile}
          />
        ))}
      </>
    );
  }

  const isSearching = searchQuery.length >= 2;
  const displayFiles = isSearching ? (searchResults ?? []) : [];

  const allFolders = tree?.folders ?? [];

  return (
    <div className="flex h-full flex-col gap-3">
      {/* ── Top toolbar ─────────────────────────────────────────────────── */}
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
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
            >
              <X size={10} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowSaveDialog((v) => !v)}
          title="Save current state"
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
          folders={allFolders}
          onSave={handleSave}
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
          {displayFiles.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              indent={0}
              openingId={openingId}
              onOpen={handleOpen}
              onRename={(id, name) => renameMut.mutate({ id, name })}
              onDuplicate={(id) => duplicateMut.mutate(id)}
              onDelete={handleDeleteFile}
            />
          ))}
          {searchResults?.length === 0 && (
            <p className="text-[11px] text-white/35">No files match "{searchQuery}"</p>
          )}
        </div>
      )}

      {!isSearching && (
        <>
          {/* ── Recent files ──────────────────────────────────────────────── */}
          {recent && recent.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <Clock size={10} className="text-white/40" />
                <span className="text-[10px] uppercase tracking-[0.1em] text-white/40">Recent</span>
              </div>
              <div className="space-y-0.5">
                {recent.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    indent={0}
                    openingId={openingId}
                    onOpen={handleOpen}
                    onRename={(id, name) => renameMut.mutate({ id, name })}
                    onDuplicate={(id) => duplicateMut.mutate(id)}
                    onDelete={handleDeleteFile}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── File tree ────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.1em] text-white/40">All Files</span>
              <button
                onClick={() => {
                  setNewFolderParent(null);
                  setNewFolderName('');
                }}
                title="New folder at root"
                className="rounded p-0.5 text-white/40 hover:bg-white/[0.06] hover:text-white"
              >
                <FolderPlus size={12} />
              </button>
            </div>

            {treeLoading && (
              <p className="text-[11px] text-white/35">Loading…</p>
            )}

            {!treeLoading && (
              <div className="space-y-0.5">
                {newFolderParent === null && (
                  <NewFolderInput
                    indent={0}
                    value={newFolderName}
                    onChange={setNewFolderName}
                    onConfirm={() => {
                      if (newFolderName.trim()) {
                        createFolderMut.mutate({ name: newFolderName.trim(), parentId: null });
                      }
                    }}
                    onCancel={() => { setNewFolderParent(undefined); setNewFolderName(''); }}
                  />
                )}
                {renderTree(null, 0)}
                {!treeLoading && files.length === 0 && folders.length === 0 && (
                  <div className="py-4 text-center">
                    <MapPin size={20} className="mx-auto mb-2 text-white/20" />
                    <p className="text-[11px] text-white/35">No saved files yet.</p>
                    <p className="text-[10px] text-white/25">Click Save to record current map state.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── New folder input ───────────────────────────────────────────────────────────

function NewFolderInput({
  indent,
  value,
  onChange,
  onConfirm,
  onCancel,
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
    <div
      style={{ paddingLeft: `${indent * 12 + 4}px` }}
      className="flex items-center gap-1.5 py-0.5 pr-1"
    >
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
      <button
        onClick={onConfirm}
        disabled={!value.trim()}
        className="rounded p-0.5 text-emerald-400 hover:bg-white/[0.06] disabled:opacity-30"
      >
        <Check size={11} />
      </button>
      <button
        onClick={onCancel}
        className="rounded p-0.5 text-white/50 hover:bg-white/[0.06]"
      >
        <X size={11} />
      </button>
    </div>
  );
}
