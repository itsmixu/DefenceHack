import { useState, useCallback, useMemo } from 'react';
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
  Users,
  Layers,
  ChevronRight,
  Plus,
  Wind,
  Thermometer,
  Cloud,
} from 'lucide-react';
import {
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  deletePlan,
  listPlanVersions,
  getPlanVersion,
  createPlanVersion,
  fetchConditionsSnapshot,
} from '../api/client';
import {
  parseBbox,
  useBboxStore,
  useDrawnStore,
  useLayerStore,
  useMapStore,
  useToastStore,
} from '../store';
import type { DrawnFeature, LayerKey, Phase, Plan, PlanSummary, PlanVersionSummary } from '../api/types';

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

const MAX_PHASES = 5;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function makePhase(id: number): Phase {
  return {
    id,
    name: `Phase ${id}`,
    drawn_features: { type: 'FeatureCollection', features: [] },
    active_layers: [],
    notes: '',
  };
}

interface HistoryBanner {
  planName: string;
  versionLabel: string;
  version: number;
  conditions?: Record<string, unknown>;
}

// ── ConditionsCard ─────────────────────────────────────────────────────────────
function ConditionsCard({ snap }: { snap: Record<string, unknown> }) {
  const temp = snap.temperature_c != null ? `${Number(snap.temperature_c).toFixed(1)}°C` : null;
  const wind = snap.wind_speed_ms != null ? `${Number(snap.wind_speed_ms).toFixed(1)} m/s` : null;
  const cloud = snap.cloudiness != null ? `${snap.cloudiness}/8` : null;
  const station = snap.station as string | undefined;
  const fetchedAt = snap.fetched_at as string | undefined;

  if (!temp && !wind && !cloud) return null;

  return (
    <div className="mt-2 rounded border border-sky-400/20 bg-sky-500/5 px-2.5 py-2">
      <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-sky-300/70">
        Conditions at save time {fetchedAt ? `· ${fmtDate(fetchedAt)}` : ''}
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {temp && (
          <span className="flex items-center gap-1 text-[10px] text-sky-200/80">
            <Thermometer size={9} />
            {temp}
          </span>
        )}
        {wind && (
          <span className="flex items-center gap-1 text-[10px] text-sky-200/80">
            <Wind size={9} />
            {wind}
          </span>
        )}
        {cloud && (
          <span className="flex items-center gap-1 text-[10px] text-sky-200/80">
            <Cloud size={9} />
            Cloud {cloud}
          </span>
        )}
      </div>
      {station && (
        <p className="mt-1 text-[9px] text-sky-200/40">{station}</p>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PlansPanel() {
  const qc = useQueryClient();

  // Save form state
  const [planName, setPlanName] = useState('');
  const [unitName, setUnitName] = useState('');
  const [parentPlanId, setParentPlanId] = useState<string>('');
  const [versionLabel, setVersionLabel] = useState('');
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyBanner, setHistoryBanner] = useState<HistoryBanner | null>(null);

  // Phase state (local — persisted to backend on plan save)
  const [phases, setPhases] = useState<Phase[]>([makePhase(1)]);
  const [currentPhase, setCurrentPhase] = useState(0);
  const [editingPhaseIdx, setEditingPhaseIdx] = useState<number | null>(null);
  const [phaseNameDraft, setPhaseNameDraft] = useState('');

  // Snapshot of live state saved before entering history mode
  const [liveSnapshot, setLiveSnapshot] = useState<{
    drawn: DrawnFeature[];
    layers: LayerKey[];
    phases: Phase[];
    phase: number;
  } | null>(null);

  // Stores
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

  // ── Sync current phase state ─────────────────────────────────────────────────
  // Returns phases array with current map state saved into currentPhase slot.
  const getPhasesWithCurrentState = useCallback((): Phase[] => {
    return phases.map((p, i) =>
      i === currentPhase
        ? { ...p, drawn_features: { type: 'FeatureCollection', features: drawn }, active_layers: currentActiveLayers }
        : p
    );
  }, [phases, currentPhase, drawn, currentActiveLayers]);

  // ── Switch phase ─────────────────────────────────────────────────────────────
  const switchPhase = useCallback((newPhaseIdx: number) => {
    const updated = getPhasesWithCurrentState();
    setPhases(updated);
    setCurrentPhase(newPhaseIdx);
    const target = updated[newPhaseIdx];
    setAllDrawn(target.drawn_features.features as DrawnFeature[]);
    setActiveLayers(target.active_layers as LayerKey[]);
  }, [getPhasesWithCurrentState, setAllDrawn, setActiveLayers]);

  // ── Add phase ────────────────────────────────────────────────────────────────
  const addPhase = useCallback(() => {
    if (phases.length >= MAX_PHASES) return;
    const updated = getPhasesWithCurrentState();
    const newPhase = makePhase(updated.length + 1);
    setPhases([...updated, newPhase]);
    // Switch to new phase
    const newIdx = updated.length;
    setCurrentPhase(newIdx);
    setAllDrawn([]);
    setActiveLayers([]);
  }, [phases.length, getPhasesWithCurrentState, setAllDrawn, setActiveLayers]);

  // ── Fetch plans (flat, for parent selector) ──────────────────────────────────
  const { data: allPlans = [] } = useQuery({
    queryKey: ['plans', 'all'],
    queryFn: () => listPlans({ all: true }),
  });

  // ── Fetch top-level plans for display ────────────────────────────────────────
  const { data: plans = [], isFetching: plansLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => listPlans({ all: true }),
  });

  // Build hierarchy: group plans by parent
  const { topLevel, childrenByParent } = useMemo(() => {
    const top: PlanSummary[] = [];
    const byParent: Record<string, PlanSummary[]> = {};
    for (const p of plans) {
      if (p.parent_plan_id) {
        (byParent[p.parent_plan_id] ??= []).push(p);
      } else {
        top.push(p);
      }
    }
    return { topLevel: top, childrenByParent: byParent };
  }, [plans]);

  // ── Save plan ────────────────────────────────────────────────────────────────
  const savePlan = useMutation({
    mutationFn: async () => {
      const phasesWithCurrent = getPhasesWithCurrentState();
      const conditions = bbox ? await fetchConditionsSnapshot(bbox) : undefined;
      return createPlan({
        name: planName.trim() || 'Untitled plan',
        bbox: bboxAsArray(),
        drawn_features: { type: 'FeatureCollection', features: drawn },
        active_layers: currentActiveLayers,
        unit: unitName.trim(),
        parent_plan_id: parentPlanId || null,
        phases: phasesWithCurrent,
        conditions_snapshot: conditions,
      });
    },
    onSuccess: (plan) => {
      setCurrentPlanId(plan.id);
      setPlanName('');
      qc.invalidateQueries({ queryKey: ['plans'] });
      push('success', `Plan "${plan.name}" saved`);
    },
    onError: () => push('error', 'Failed to save plan'),
  });

  // ── Update plan (used when switching phases mid-session) ─────────────────────
  const updateCurrentPlan = useCallback(async (updatedPhases: Phase[]) => {
    if (!currentPlanId) return;
    try {
      await updatePlan(currentPlanId, { phases: updatedPhases });
    } catch {
      // Non-critical — phases are kept in local state
    }
  }, [currentPlanId]);

  // ── Save version ─────────────────────────────────────────────────────────────
  const saveVersion = useMutation({
    mutationFn: async () => {
      const conditions = bbox ? await fetchConditionsSnapshot(bbox) : undefined;
      return createPlanVersion(currentPlanId!, {
        label: versionLabel.trim() || 'Snapshot',
        role: 'commander',
        bbox: bboxAsArray(),
        drawn_features: { type: 'FeatureCollection', features: drawn },
        active_layers: currentActiveLayers,
        notes: '',
        conditions_snapshot: conditions,
      });
    },
    onSuccess: (v) => {
      setVersionLabel('');
      qc.invalidateQueries({ queryKey: ['plan-versions', currentPlanId] });
      push('success', `Version "${v.label}" saved`);
    },
    onError: () => push('error', 'Failed to save version'),
  });

  // ── Load plan ────────────────────────────────────────────────────────────────
  const loadPlan = useCallback(
    async (id: string, name: string) => {
      try {
        const plan = await getPlan(id);
        const planPhases: Phase[] = plan.phases && plan.phases.length > 0
          ? plan.phases
          : [{ id: 1, name: 'Phase 1', drawn_features: plan.drawn_features, active_layers: plan.active_layers, notes: '' }];

        setPhases(planPhases);
        setCurrentPhase(0);
        setAllDrawn(planPhases[0].drawn_features.features as DrawnFeature[]);
        setActiveLayers(planPhases[0].active_layers as LayerKey[]);
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

  // ── Delete plan ──────────────────────────────────────────────────────────────
  const delPlan = useMutation({
    mutationFn: (id: string) => deletePlan(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['plans'] });
      if (currentPlanId === id) {
        setCurrentPlanId(null);
        setPhases([makePhase(1)]);
        setCurrentPhase(0);
      }
      push('success', 'Plan deleted');
    },
    onError: () => push('error', 'Failed to delete plan'),
  });

  // ── Load version (enter history mode) ────────────────────────────────────────
  const loadVersion = useCallback(
    async (planId: string, version: number, label: string, planName: string) => {
      try {
        const v = await getPlanVersion(planId, version);
        if (!historyBanner) {
          setLiveSnapshot({ drawn: drawn.slice(), layers: currentActiveLayers, phases: phases.slice(), phase: currentPhase });
        }
        setAllDrawn(v.drawn_features.features as DrawnFeature[]);
        setActiveLayers(v.active_layers as LayerKey[]);
        setHistoryBanner({ planName, versionLabel: label, version, conditions: v.conditions_snapshot });
        if (v.bbox && map) {
          const [w, s, e, n] = v.bbox;
          map.flyToBounds([[s, w], [n, e]], { padding: [20, 20], maxZoom: 14 });
        }
        push('info', `Viewing v${version}: "${label}"`);
      } catch {
        push('error', 'Failed to load version');
      }
    },
    [historyBanner, drawn, currentActiveLayers, phases, currentPhase, setAllDrawn, setActiveLayers, map, push],
  );

  // ── Exit history mode ────────────────────────────────────────────────────────
  const exitHistory = useCallback(() => {
    if (liveSnapshot) {
      setAllDrawn(liveSnapshot.drawn);
      setActiveLayers(liveSnapshot.layers);
      setPhases(liveSnapshot.phases);
      setCurrentPhase(liveSnapshot.phase);
    }
    setHistoryBanner(null);
    setLiveSnapshot(null);
    push('info', 'Returned to live state');
  }, [liveSnapshot, setAllDrawn, setActiveLayers, push]);

  return (
    <div className="space-y-3">

      {/* ── History mode banner ──────────────────────────────────────────────── */}
      {historyBanner && (
        <div className="rounded border border-amber-300/40 bg-amber-500/10 px-3 py-2">
          <div className="mb-1 flex items-center gap-1.5">
            <Clock size={11} className="text-amber-300" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-amber-200">
              History mode
            </span>
          </div>
          <p className="mb-1 text-[11px] text-amber-100/80">
            {historyBanner.planName} &middot; v{historyBanner.version} &mdash; {historyBanner.versionLabel}
          </p>
          {historyBanner.conditions && (
            <ConditionsCard snap={historyBanner.conditions} />
          )}
          <button
            onClick={exitHistory}
            className="mt-2 flex items-center gap-1.5 rounded border border-amber-300/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-200 hover:bg-amber-400/20"
          >
            <RotateCcw size={10} />
            Exit history — return to live
          </button>
        </div>
      )}

      {/* ── Save plan ────────────────────────────────────────────────────────── */}
      <section>
        <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
          Save current state
        </p>
        <div className="space-y-1.5">
          <input
            value={planName}
            onChange={(e) => setPlanName(e.target.value)}
            placeholder="Plan name…"
            className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none"
          />
          <div className="flex gap-1.5">
            <input
              value={unitName}
              onChange={(e) => setUnitName(e.target.value)}
              placeholder="Unit (e.g. 1 Platoon)…"
              className="flex-1 rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white placeholder:text-white/30 focus:border-white/35 focus:outline-none"
            />
            <select
              value={parentPlanId}
              onChange={(e) => setParentPlanId(e.target.value)}
              className="flex-1 rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white focus:border-white/35 focus:outline-none"
            >
              <option value="">No parent (top-level)</option>
              {allPlans.filter((p) => p.id !== currentPlanId).map((p) => (
                <option key={p.id} value={p.id}>{p.name} {p.unit ? `[${p.unit}]` : ''}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => savePlan.mutate()}
            disabled={savePlan.isPending}
            className="flex w-full items-center justify-center gap-1.5 rounded border border-white/20 bg-white/[0.08] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.06em] text-white/80 hover:bg-white/[0.15] disabled:opacity-40"
          >
            {savePlan.isPending ? (
              <span className="h-3 w-3 animate-spin rounded-full border border-white/30 border-t-white" />
            ) : (
              <Save size={11} />
            )}
            Save plan · captures current conditions
          </button>
        </div>
      </section>

      {/* ── Phase tabs (only when a plan is loaded) ──────────────────────────── */}
      {currentPlanId && !historyBanner && (
        <section className="rounded border border-white/10 bg-black/25 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
              <Layers size={10} className="mr-1 inline" />
              Phases
            </p>
            {phases.length < MAX_PHASES && (
              <button
                onClick={addPhase}
                className="flex items-center gap-0.5 rounded border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.06em] text-white/50 hover:border-white/35 hover:text-white"
              >
                <Plus size={9} />
                Add
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {phases.map((phase, i) => (
              <div key={phase.id} className="flex items-center">
                {editingPhaseIdx === i ? (
                  <input
                    autoFocus
                    value={phaseNameDraft}
                    onChange={(e) => setPhaseNameDraft(e.target.value)}
                    onBlur={() => {
                      if (phaseNameDraft.trim()) {
                        setPhases((ps) => ps.map((p, idx) => idx === i ? { ...p, name: phaseNameDraft.trim() } : p));
                      }
                      setEditingPhaseIdx(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') {
                        if (phaseNameDraft.trim()) {
                          setPhases((ps) => ps.map((p, idx) => idx === i ? { ...p, name: phaseNameDraft.trim() } : p));
                        }
                        setEditingPhaseIdx(null);
                      }
                    }}
                    className="w-28 rounded border border-white/35 bg-black/60 px-1.5 py-0.5 text-[10px] text-white focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      if (i !== currentPhase) {
                        switchPhase(i);
                        updateCurrentPlan(getPhasesWithCurrentState());
                      }
                    }}
                    onDoubleClick={() => {
                      setPhaseNameDraft(phase.name);
                      setEditingPhaseIdx(i);
                    }}
                    title="Click to switch · Double-click to rename"
                    className={`rounded border px-2 py-0.5 text-[10px] transition ${
                      i === currentPhase
                        ? 'border-white/55 bg-white/15 text-white'
                        : 'border-white/15 text-white/55 hover:border-white/35 hover:text-white/80'
                    }`}
                  >
                    {phase.name}
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.04em] text-white/30">
            Each phase has its own shapes · double-click tab to rename
          </p>
        </section>
      )}

      {/* ── Save version snapshot ────────────────────────────────────────────── */}
      {currentPlanId && !historyBanner && (
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

      {/* ── Plan list ────────────────────────────────────────────────────────── */}
      <section>
        <div className="mb-1.5 flex items-center gap-1.5">
          <BookOpen size={11} className="text-white/45" />
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
            Saved plans
            {plansLoading && (
              <span className="ml-2 inline-block h-2 w-2 animate-spin rounded-full border border-white/25 border-t-white/70" />
            )}
          </p>
        </div>

        {topLevel.length === 0 && !plansLoading && (
          <p className="text-[11px] text-white/40">No plans saved yet.</p>
        )}

        <ul className="space-y-2">
          {topLevel.map((plan) => (
            <PlanRow
              key={plan.id}
              plan={plan}
              isActive={plan.id === currentPlanId}
              isExpanded={expandedId === plan.id}
              children={childrenByParent[plan.id] ?? []}
              onLoad={() => loadPlan(plan.id, plan.name)}
              onDelete={() => delPlan.mutate(plan.id)}
              onToggleExpand={() =>
                setExpandedId((prev) => (prev === plan.id ? null : plan.id))
              }
              onLoadVersion={(v, label) => loadVersion(plan.id, v, label, plan.name)}
              onLoadChild={(id, name) => loadPlan(id, name)}
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
  children: PlanSummary[];
  onLoad: () => void;
  onDelete: () => void;
  onToggleExpand: () => void;
  onLoadVersion: (version: number, label: string) => void;
  onLoadChild: (id: string, name: string) => void;
}

function PlanRow({ plan, isActive, isExpanded, children, onLoad, onDelete, onToggleExpand, onLoadVersion, onLoadChild }: PlanRowProps) {
  const { data: versions, isFetching } = useQuery({
    queryKey: ['plan-versions', plan.id],
    queryFn: () => listPlanVersions(plan.id),
    enabled: isExpanded,
  });

  return (
    <li className={`rounded border ${isActive ? 'border-white/35 bg-white/[0.04]' : 'border-white/10 bg-black/30'}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-2.5 py-2">
        <FolderOpen size={12} className={isActive ? 'text-white/70' : 'text-white/30'} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-white/90">{plan.name}</p>
          <div className="flex items-center gap-2">
            {plan.unit && (
              <span className="flex items-center gap-0.5 font-mono text-[9px] uppercase tracking-[0.04em] text-white/45">
                <Users size={8} />
                {plan.unit}
              </span>
            )}
            <span className="font-mono text-[9px] text-white/30">{fmtDate(plan.updated_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onLoad} className="rounded border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/65 hover:bg-white/[0.1] hover:text-white">
            Load
          </button>
          <button onClick={onDelete} className="rounded border border-white/10 p-1 text-red-300/50 hover:border-red-300/35 hover:bg-red-500/10 hover:text-red-200">
            <Trash2 size={10} />
          </button>
          <button onClick={onToggleExpand} className="rounded border border-white/10 p-1 text-white/45 hover:bg-white/[0.06] hover:text-white">
            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Conditions preview */}
      {plan.conditions_snapshot && !isExpanded && (
        <div className="px-2.5 pb-2">
          <ConditionsCard snap={plan.conditions_snapshot} />
        </div>
      )}

      {/* Expanded: versions + sub-plans */}
      {isExpanded && (
        <div className="border-t border-white/10 px-2.5 pb-2.5 pt-2 space-y-3">

          {/* Sub-plans (command hierarchy children) */}
          {children.length > 0 && (
            <div>
              <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.08em] text-white/40">
                Subordinate plans
              </p>
              <ul className="space-y-1">
                {children.map((child) => (
                  <li key={child.id} className="flex items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1.5">
                    <ChevronRight size={9} className="text-white/30" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-white/80">{child.name}</p>
                      {child.unit && (
                        <span className="font-mono text-[9px] text-white/40">{child.unit}</span>
                      )}
                    </div>
                    <button
                      onClick={() => onLoadChild(child.id, child.name)}
                      className="rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/55 hover:bg-white/[0.08] hover:text-white"
                    >
                      Load
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Version history */}
          <div>
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
          <div className="flex items-center gap-1.5">
            <span className="flex-shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/55">
              v{v.version}
            </span>
            <span className="truncate text-[11px] text-white/85">{v.label}</span>
          </div>

          <div className="mt-0.5 flex items-center gap-2.5">
            {v.role && (
              <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-white/40">{v.role}</span>
            )}
            <span className="font-mono text-[9px] text-white/30">{fmtDate(v.saved_at)}</span>
          </div>

          {v.active_layers.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {v.active_layers.slice(0, 5).map((l) => (
                <span key={l} className="rounded bg-white/[0.07] px-1 py-px font-mono text-[8px] uppercase tracking-[0.04em] text-white/45">
                  {l}
                </span>
              ))}
              {v.active_layers.length > 5 && (
                <span className="font-mono text-[8px] text-white/30">+{v.active_layers.length - 5} more</span>
              )}
            </div>
          )}

          {prev !== null && (() => {
            const layersDelta = v.active_layers.length - prev.active_layers.length;
            if (layersDelta === 0) return null;
            return (
              <p className="mt-0.5 font-mono text-[9px] text-white/30">
                {layersDelta > 0 ? `+${layersDelta}` : layersDelta} layer{Math.abs(layersDelta) === 1 ? '' : 's'}
              </p>
            );
          })()}

          {/* Conditions at version save time */}
          {v.conditions_snapshot && <ConditionsCard snap={v.conditions_snapshot} />}
        </div>

        <button
          onClick={onView}
          className="flex-shrink-0 self-start rounded border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-white/55 hover:bg-white/[0.08] hover:text-white"
        >
          View
        </button>
      </div>
    </li>
  );
}
