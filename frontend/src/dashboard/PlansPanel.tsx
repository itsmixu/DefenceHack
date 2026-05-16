import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Save,
  Tag,
  Trash2,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  FolderOpen,
  Clock,
} from 'lucide-react';
import {
  listPlans,
  getPlan,
  createPlan,
  deletePlan,
  listPlanVersions,
  getPlanVersion,
  createPlanVersion,
} from '../api/client';
import {
  parseBbox,
  useBboxStore,
  useDrawnStore,
  useLayerStore,
  useMapStore,
  useToastStore,
} from '../store';
import type { DrawnFeature, LayerKey, PlanSummary, PlanVersionSummary } from '../api/types';

const VERSION_PRESETS = [
  'Initial planning',
  'After recon',
  'Commander review',
  'Final approved',
];

const ALL_LAYER_KEYS: LayerKey[] = [
  'osm', 'digiroad', 'mml', 'mml_contours', 'statfin',
  'fmi', 'opencellid', 'n2yo', 'exposure', 'mcoo',
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

// ── History-mode overlay banner (rendered inside the Plans panel) ──────────────
interface HistoryBanner {
  planName: string;
  versionLabel: string;
  version: number;
}

export default function PlansPanel() {
  const qc = useQueryClient();

  // form state
  const [planName, setPlanName] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyBanner, setHistoryBanner] = useState<HistoryBanner | null>(null);

  // snapshot of live state saved before entering history mode
  const [liveSnapshot, setLiveSnapshot] = useState<{
    drawn: DrawnFeature[];
    layers: LayerKey[];
  } | null>(null);

  // stores
  const drawn = useDrawnStore((s) => s.features);
  const setAllDrawn = useDrawnStore((s) => s.setAll);
  const bbox = useBboxStore((s) => s.bbox);
  const activeLayers = useLayerStore((s) => s.active);
  const setActiveLayers = useLayerStore((s) => s.setActiveLayers);
  const map = useMapStore((s) => s.map);
  const push = useToastStore((s) => s.push);

  const currentActiveLayers = ALL_LAYER_KEYS.filter((k) => activeLayers[k]);

  const bboxAsArray = useCallback((): [number, number, number, number] | undefined => {
    if (!bbox) return undefined;
    return parseBbox(bbox);
  }, [bbox]);

  // ── fetch all plans ──────────────────────────────────────────────────────────
  const { data: plans = [], isFetching: plansLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: listPlans,
  });

  // ── save plan ────────────────────────────────────────────────────────────────
  const savePlan = useMutation({
    mutationFn: () =>
      createPlan({
        name: planName.trim() || 'Untitled plan',
        bbox: bboxAsArray(),
        drawn_features: { type: 'FeatureCollection', features: drawn },
        active_layers: currentActiveLayers,
      }),
    onSuccess: (plan) => {
      setCurrentPlanId(plan.id);
      setPlanName('');
      qc.invalidateQueries({ queryKey: ['plans'] });
      push('success', `Plan "${plan.name}" saved`);
    },
    onError: () => push('error', 'Failed to save plan'),
  });

  // ── save version ─────────────────────────────────────────────────────────────
  const saveVersion = useMutation({
    mutationFn: () =>
      createPlanVersion(currentPlanId!, {
        label: versionLabel.trim() || 'Snapshot',
        role: 'commander',
        bbox: bboxAsArray(),
        drawn_features: { type: 'FeatureCollection', features: drawn },
        active_layers: currentActiveLayers,
        notes: '',
      }),
    onSuccess: (v) => {
      setVersionLabel('');
      qc.invalidateQueries({ queryKey: ['plan-versions', currentPlanId] });
      push('success', `Version "${v.label}" saved`);
    },
    onError: () => push('error', 'Failed to save version'),
  });

  // ── load plan ────────────────────────────────────────────────────────────────
  const loadPlan = useCallback(
    async (id: string, name: string) => {
      try {
        const plan = await getPlan(id);
        setAllDrawn(plan.drawn_features.features as DrawnFeature[]);
        setActiveLayers(plan.active_layers as LayerKey[]);
        setCurrentPlanId(id);
        if (plan.bbox && map) {
          const [w, s, e, n] = plan.bbox;
          map.flyToBounds([[s, w], [n, e]], { padding: [20, 20], maxZoom: 14 });
        }
        push('success', `Loaded plan "${name}"`);
      } catch {
        push('error', 'Failed to load plan');
      }
    },
    [setAllDrawn, setActiveLayers, map, push],
  );

  // ── delete plan ──────────────────────────────────────────────────────────────
  const delPlan = useMutation({
    mutationFn: (id: string) => deletePlan(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['plans'] });
      if (currentPlanId === id) setCurrentPlanId(null);
      push('success', 'Plan deleted');
    },
    onError: () => push('error', 'Failed to delete plan'),
  });

  // ── load version (enter history mode) ────────────────────────────────────────
  const loadVersion = useCallback(
    async (planId: string, version: number, label: string, planName: string) => {
      try {
        const v = await getPlanVersion(planId, version);
        // Save current live state so we can restore it later
        if (!historyBanner) {
          setLiveSnapshot({ drawn: drawn.slice(), layers: currentActiveLayers });
        }
        setAllDrawn(v.drawn_features.features as DrawnFeature[]);
        setActiveLayers(v.active_layers as LayerKey[]);
        setHistoryBanner({ planName, versionLabel: label, version });
        if (v.bbox && map) {
          const [w, s, e, n] = v.bbox;
          map.flyToBounds([[s, w], [n, e]], { padding: [20, 20], maxZoom: 14 });
        }
        push('info', `Viewing v${version}: "${label}"`);
      } catch {
        push('error', 'Failed to load version');
      }
    },
    [historyBanner, drawn, currentActiveLayers, setAllDrawn, setActiveLayers, map, push],
  );

  // ── exit history mode ────────────────────────────────────────────────────────
  const exitHistory = useCallback(() => {
    if (liveSnapshot) {
      setAllDrawn(liveSnapshot.drawn);
      setActiveLayers(liveSnapshot.layers);
    }
    setHistoryBanner(null);
    setLiveSnapshot(null);
    push('info', 'Returned to live state');
  }, [liveSnapshot, setAllDrawn, setActiveLayers, push]);

  return (
    <div className="space-y-3">

      {/* ── History mode banner ─────────────────────────────────────────────── */}
      {historyBanner && (
        <div className="rounded border border-amber-300/40 bg-amber-500/10 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5">
            <Clock size={11} className="text-amber-300" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-200">
              History mode
            </span>
          </div>
          <p className="mb-2 text-[11px] text-amber-100/80">
            {historyBanner.planName} &middot; v{historyBanner.version} &mdash; {historyBanner.versionLabel}
          </p>
          <button
            onClick={exitHistory}
            className="flex items-center gap-1.5 rounded border border-amber-300/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-200 hover:bg-amber-400/20"
          >
            <RotateCcw size={10} />
            Exit history — return to live
          </button>
        </div>
      )}

      {/* ── Save plan ───────────────────────────────────────────────────────── */}
      <section>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
          Save current state
        </p>
        <div className="flex gap-2">
          <input
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && savePlan.mutate()}
            placeholder="Plan name…"
            className="flex-1 rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none"
          />
          <button
            onClick={() => savePlan.mutate()}
            disabled={savePlan.isPending}
            className="flex items-center gap-1 rounded border border-white/20 bg-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.06em] text-white/80 hover:bg-white/[0.15] disabled:opacity-40"
          >
            {savePlan.isPending ? (
              <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
            ) : (
              <Save size={11} />
            )}
            Save
          </button>
        </div>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.04em] text-white/35">
          Saves drawn shapes · active layers · current view
        </p>
      </section>

      {/* ── Save version (only when a plan is active) ───────────────────────── */}
      {currentPlanId && (
        <section className="rounded border border-white/10 bg-black/25 p-2.5">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
            <Tag size={10} className="mr-1 inline" />
            Tag version snapshot
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            {VERSION_PRESETS.map((l) => (
              <button
                key={l}
                onClick={() => setVersionLabel(l)}
                className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.04em] transition ${
                  versionLabel === l
                    ? 'border-white/55 bg-white/15 text-white'
                    : 'border-white/15 text-white/55 hover:border-white/35 hover:text-white/80'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && versionLabel.trim() && saveVersion.mutate()}
              placeholder="Custom label…"
              className="flex-1 rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none"
            />
            <button
              onClick={() => saveVersion.mutate()}
              disabled={saveVersion.isPending || !versionLabel.trim()}
              className="flex items-center gap-1 rounded border border-white/20 bg-white/[0.08] px-2.5 py-1 text-[10px] uppercase tracking-[0.06em] text-white/80 hover:bg-white/[0.15] disabled:opacity-40"
            >
              {saveVersion.isPending ? (
                <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
              ) : (
                <Tag size={11} />
              )}
              Tag
            </button>
          </div>
        </section>
      )}

      {/* ── Plan list ───────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-1.5 flex items-center gap-1.5">
          <BookOpen size={11} className="text-white/45" />
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
            Saved plans
            {plansLoading && (
              <span className="ml-2 h-2 w-2 animate-spin rounded-full border border-white/25 border-t-white/70 inline-block" />
            )}
          </p>
        </div>

        {plans.length === 0 && !plansLoading && (
          <p className="text-[11px] text-white/40">No plans saved yet.</p>
        )}

        <ul className="space-y-2">
          {plans.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              isActive={plan.id === currentPlanId}
              isExpanded={expandedId === plan.id}
              onLoad={() => loadPlan(plan.id, plan.name)}
              onDelete={() => delPlan.mutate(plan.id)}
              onToggleExpand={() =>
                setExpandedId((prev) => (prev === plan.id ? null : plan.id))
              }
              onLoadVersion={(v, label) => loadVersion(plan.id, v, label, plan.name)}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── PlanRow ────────────────────────────────────────────────────────────────────

interface PlanRowProps {
  plan: PlanSummary;
  isActive: boolean;
  isExpanded: boolean;
  onLoad: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
  onLoadVersion: (version: number, label: string) => void;
}

function PlanRow({
  plan,
  isActive,
  isExpanded,
  onLoad,
  onDelete,
  onToggleExpand,
  onLoadVersion,
}: PlanRowProps) {
  const { data: versions, isFetching } = useQuery({
    queryKey: ['plan-versions', plan.id],
    queryFn: () => listPlanVersions(plan.id),
    enabled: isExpanded,
  });

  return (
    <li
      className={`rounded border ${
        isActive ? 'border-white/35 bg-white/[0.04]' : 'border-white/10 bg-black/30'
      }`}
    >
      {/* Plan header row */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <FolderOpen size={12} className={isActive ? 'text-white/70' : 'text-white/30'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-white/90">{plan.name}</p>
          <p className="font-mono text-[9px] uppercase tracking-[0.04em] text-white/40">
            {fmtDate(plan.updated_at)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onLoad}
            title="Load this plan"
            className="rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/65 hover:bg-white/[0.1] hover:text-white"
          >
            Load
          </button>
          <button
            onClick={onDelete}
            title="Delete plan"
            className="rounded border border-white/10 p-1 text-red-300/50 hover:border-red-300/35 hover:bg-red-500/10 hover:text-red-200"
          >
            <Trash2 size={10} />
          </button>
          <button
            onClick={onToggleExpand}
            title="Show version history"
            className="rounded border border-white/10 p-1 text-white/45 hover:bg-white/[0.06] hover:text-white"
          >
            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Version list (shown when expanded) */}
      {isExpanded && (
        <div className="border-t border-white/10 px-2.5 pb-2.5 pt-2">
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/40">
            Version history
          </p>

          {isFetching && (
            <div className="flex items-center gap-1.5 text-[10px] text-white/40">
              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white/20 border-t-white/60" />
              Loading…
            </div>
          )}

          {!isFetching && versions?.length === 0 && (
            <p className="text-[10px] text-white/35">
              No versions yet — use "Tag version snapshot" after loading this plan.
            </p>
          )}

          {versions && versions.length > 0 && (
            <ul className="space-y-1.5">
              {versions.map((v, i) => (
                <VersionRow
                  key={v.version}
                  version={v}
                  prev={versions[i - 1] ?? null}
                  onView={() => onLoadVersion(v.version, v.label)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

// ── VersionRow ─────────────────────────────────────────────────────────────────

interface VersionRowProps {
  version: PlanVersionSummary;
  prev: PlanVersionSummary | null;
  onView: () => void;
}

function VersionRow({ version: v, prev, onView }: VersionRowProps) {
  return (
    <li className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* Version badge + label */}
          <div className="flex items-center gap-1.5">
            <span className="flex-shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/55">
              v{v.version}
            </span>
            <span className="truncate text-[11px] text-white/85">{v.label}</span>
          </div>

          {/* Metadata row */}
          <div className="mt-0.5 flex items-center gap-2.5">
            {v.role && (
              <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-white/40">
                {v.role}
              </span>
            )}
            <span className="font-mono text-[9px] text-white/30">{fmtDate(v.saved_at)}</span>
          </div>

          {/* Layer count */}
          {v.active_layers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {v.active_layers.slice(0, 5).map((l) => (
                <span
                  key={l}
                  className="rounded bg-white/[0.07] px-1 py-px font-mono text-[8px] uppercase tracking-[0.04em] text-white/45"
                >
                  {l}
                </span>
              ))}
              {v.active_layers.length > 5 && (
                <span className="font-mono text-[8px] text-white/30">
                  +{v.active_layers.length - 5} more
                </span>
              )}
            </div>
          )}

          {/* Diff from previous version */}
          {prev !== null && (() => {
            // notes length change as a rough proxy for content change
            const notesDelta = (v.notes?.length ?? 0) - (prev.notes?.length ?? 0);
            const layersDelta = v.active_layers.length - prev.active_layers.length;
            if (layersDelta === 0 && notesDelta === 0) return null;
            return (
              <p className="mt-0.5 font-mono text-[9px] text-white/30">
                {layersDelta > 0 && `+${layersDelta} layer${layersDelta === 1 ? '' : 's'} `}
                {layersDelta < 0 && `${layersDelta} layer${layersDelta === -1 ? '' : 's'} `}
                {notesDelta !== 0 && `notes ${notesDelta > 0 ? '+' : ''}${notesDelta} chars`}
              </p>
            );
          })()}
        </div>

        {/* View button */}
        <button
          onClick={onView}
          title={`Load v${v.version}: ${v.label}`}
          className="flex-shrink-0 self-start rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/55 hover:bg-white/[0.08] hover:text-white"
        >
          View
        </button>
      </div>
    </li>
  );
}
