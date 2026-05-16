/**
 * MapToolbar — bottom-centre map overlay with all drawing / annotation tools.
 *
 * Three tools, always visible on the map:
 *   1. Arrow   — click-drag to draw direction arrows
 *   2. Symbols — NATO APP-6 military symbol library, click-to-place
 *   3. Shapes  — geoman drawing palette (AOI, NAI, TAI, routes, etc.)
 *
 * Each tool button opens a panel above the toolbar. Only one tool/panel
 * is active at a time. Clicking an active tool deactivates it.
 */
import { useState, useMemo } from 'react';
import ms from 'milsymbol';
import {
  MoveUpRight, Shield, Shapes, X, Search,
} from 'lucide-react';
import { useTacticalStore, MILITARY_FEATURE_TYPES } from '../store';
import type { MilitaryFeatureType } from '../store';
import { SYMBOL_LIBRARY, SYMBOL_CATEGORIES } from './symbols/library';
import type { SymbolCategory, MilSymbol } from './symbols/library';
import type { ActiveMapTool } from '../store';

// ── Shared colours ─────────────────────────────────────────────────────────────
const ARROW_COLORS = [
  { hex: '#ef4444', label: 'Red'    },
  { hex: '#3b82f6', label: 'Blue'   },
  { hex: '#22c55e', label: 'Green'  },
  { hex: '#f59e0b', label: 'Amber'  },
  { hex: '#ffffff', label: 'White'  },
  { hex: '#a855f7', label: 'Purple' },
  { hex: '#f97316', label: 'Orange' },
];
const ARROW_SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL'];

// ── Category badge colours ─────────────────────────────────────────────────────
const CAT_COLOR: Record<SymbolCategory, string> = {
  Friendly:      '#3b82f6',
  Hostile:       '#ef4444',
  Unknown:       '#f59e0b',
  Neutral:       '#22c55e',
  Equipment:     '#a855f7',
  Installations: '#06b6d4',
};

// ── Milsymbol mini-icon (inline SVG, rendered by milsymbol) ───────────────────
function SymIcon({ sidc, size = 36 }: { sidc: string; size?: number }) {
  const svg = useMemo(() => {
    try {
      return new ms.Symbol(sidc, { size, frame: true, fill: true, infoFields: false }).asSVG();
    } catch {
      return '';
    }
  }, [sidc, size]);
  return (
    <span
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    />
  );
}

// ── Arrow panel ────────────────────────────────────────────────────────────────
function ArrowPanel() {
  const arrowColor   = useTacticalStore((s) => s.arrowColor);
  const arrowSize    = useTacticalStore((s) => s.arrowSize);
  const isArrowMode  = useTacticalStore((s) => s.isArrowMode);
  const setArrowColor = useTacticalStore((s) => s.setArrowColor);
  const setArrowSize  = useTacticalStore((s) => s.setArrowSize);

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">Arrow tool</p>
        <span
          className="rounded border px-2 py-0.5 font-mono text-[9px] uppercase"
          style={{ color: arrowColor, borderColor: `${arrowColor}60`, background: `${arrowColor}15` }}
        >
          {isArrowMode ? '● Active — click & drag' : 'Click Arrow to activate'}
        </span>
      </div>

      {/* Colour row */}
      <div>
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/35">Colour</p>
        <div className="flex flex-wrap gap-2">
          {ARROW_COLORS.map(({ hex, label }) => (
            <button
              key={hex}
              title={label}
              onClick={() => setArrowColor(hex)}
              className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: hex,
                borderColor: arrowColor === hex ? '#fff' : 'rgba(255,255,255,0.15)',
                boxShadow: arrowColor === hex ? `0 0 0 2px ${hex}` : 'none',
              }}
            />
          ))}
          <label className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-white/5 text-[9px] text-white/50 hover:border-white/40">
            ✎
            <input type="color" value={arrowColor} onChange={(e) => setArrowColor(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </label>
        </div>
      </div>

      {/* Size + preview */}
      <div>
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/35">Size</p>
        <div className="flex gap-1.5">
          {ARROW_SIZE_LABELS.map((label, i) => {
            const s = i + 1;
            const active = arrowSize === s;
            return (
              <button
                key={s}
                onClick={() => setArrowSize(s)}
                className="flex-1 rounded border py-1 font-mono text-[9px] transition"
                style={{
                  borderColor: active ? `${arrowColor}80` : 'rgba(255,255,255,0.12)',
                  background: active ? `${arrowColor}18` : 'transparent',
                  color: active ? arrowColor : 'rgba(255,255,255,0.5)',
                  fontWeight: active ? 700 : 400,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {/* Preview */}
        <svg className="mt-2 w-full" height="18" style={{ overflow: 'visible' }}>
          <defs>
            <marker id="tb-arrow-prev" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={arrowColor} />
            </marker>
          </defs>
          <line x1="8" y1="9" x2="90%" y2="9"
            stroke={arrowColor}
            strokeWidth={Math.max(1, (arrowSize - 1) * 1.4 + 1.5)}
            markerEnd="url(#tb-arrow-prev)"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <p className="font-mono text-[9px] text-white/30">
        Click & drag anywhere on the map • Press <kbd className="rounded bg-white/10 px-1">Esc</kbd> to stop
      </p>
    </div>
  );
}

// ── Symbol panel ───────────────────────────────────────────────────────────────
function SymbolPanel({ onClose }: { onClose: () => void }) {
  const [activeCategory, setActiveCategory] = useState<SymbolCategory>('Friendly');
  const [search, setSearch] = useState('');
  const pendingSymbol  = useTacticalStore((s) => s.pendingSymbol);
  const setPendingSymbol = useTacticalStore((s) => s.setPendingSymbol);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return SYMBOL_LIBRARY.filter(
      (sym) =>
        sym.category === activeCategory &&
        (!q || sym.name.toLowerCase().includes(q) || (sym.desc ?? '').toLowerCase().includes(q)),
    );
  }, [activeCategory, search]);

  function selectSymbol(sym: MilSymbol) {
    setPendingSymbol({ sidc: sym.sidc, name: sym.name, category: sym.category });
    // Keep panel open so user can place multiple
  }

  return (
    <div className="flex h-[420px] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
            NATO APP-6 Symbols
          </p>
          {pendingSymbol ? (
            <p className="flex items-center gap-1.5 font-mono text-[9px] text-amber-200/70">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              Placing: <strong>{pendingSymbol.name}</strong> — click map to place, pick another to change
            </p>
          ) : (
            <p className="font-mono text-[9px] text-white/35">Select a symbol then click the map to place</p>
          )}
        </div>
        {pendingSymbol && (
          <button
            onClick={() => setPendingSymbol(null)}
            className="rounded border border-white/15 px-2 py-0.5 font-mono text-[9px] text-white/50 hover:border-white/30 hover:text-white/80"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-px border-b border-white/10 bg-black/20">
        {SYMBOL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className="flex-1 py-1.5 font-mono text-[8px] uppercase tracking-[0.08em] transition"
            style={{
              color: activeCategory === cat ? CAT_COLOR[cat] : 'rgba(255,255,255,0.4)',
              borderBottom: activeCategory === cat ? `2px solid ${CAT_COLOR[cat]}` : '2px solid transparent',
              background: activeCategory === cat ? `${CAT_COLOR[cat]}10` : 'transparent',
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative border-b border-white/8 px-2 py-1.5">
        <Search size={10} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          placeholder="Search symbols…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded border border-white/10 bg-white/5 py-0.5 pl-6 pr-2 font-mono text-[10px] text-white/80 placeholder-white/25 focus:border-white/25 focus:outline-none"
        />
      </div>

      {/* Symbol grid */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {filtered.map((sym) => {
            const isActive = pendingSymbol?.sidc === sym.sidc;
            return (
              <button
                key={sym.sidc}
                onClick={() => selectSymbol(sym)}
                title={sym.desc ?? sym.name}
                className="flex flex-col items-center gap-1 rounded border p-1.5 text-center transition hover:bg-white/[0.06]"
                style={{
                  borderColor: isActive ? CAT_COLOR[sym.category] : 'rgba(255,255,255,0.08)',
                  background: isActive ? `${CAT_COLOR[sym.category]}18` : 'transparent',
                  boxShadow: isActive ? `0 0 0 1px ${CAT_COLOR[sym.category]}60` : 'none',
                }}
              >
                <SymIcon sidc={sym.sidc} size={32} />
                <span
                  className="w-full truncate font-mono text-[8px] leading-tight"
                  style={{ color: isActive ? CAT_COLOR[sym.category] : 'rgba(255,255,255,0.65)' }}
                >
                  {sym.name}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-4 py-4 text-center font-mono text-[10px] text-white/30">
              No symbols match your search
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shape panel (geoman shapes) ────────────────────────────────────────────────
const SHAPE_GROUPS = [
  {
    label: 'IPB Zones',
    types: ['AOI', 'NAI', 'TAI', 'DP'] as MilitaryFeatureType[],
  },
  {
    label: 'Control Measures',
    types: ['PHASE_LINE', 'BOUNDARY', 'ROUTE', 'OBJECTIVE'] as MilitaryFeatureType[],
  },
  {
    label: 'Unit Positions',
    types: ['UNIT_FRIENDLY', 'UNIT_ENEMY', 'CHOKE_POINT', 'HIDE_SITE'] as MilitaryFeatureType[],
  },
  {
    label: 'Freeform',
    types: ['annotation'] as MilitaryFeatureType[],
  },
];

function ShapePanel() {
  const setPending   = useTacticalStore((s) => s.setPending);
  const pendingType  = useTacticalStore((s) => s.pendingType);

  return (
    <div className="space-y-3 p-3">
      <p className="font-mono text-[10px] text-white/50">
        Click a shape to activate it, then draw on the map.
      </p>
      {pendingType && (
        <div className="flex items-center gap-2 rounded border border-amber-300/40 bg-amber-500/10 px-2 py-1.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          <span className="font-mono text-[10px] text-amber-200">
            Drawing <strong>{pendingType}</strong> — click map to start
          </span>
        </div>
      )}
      {SHAPE_GROUPS.map((group) => (
        <section key={group.label}>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/35">
            {group.label}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {group.types.map((type) => {
              const def = MILITARY_FEATURE_TYPES.find((t) => t.type === type);
              if (!def) return null;
              const isActive = pendingType === type;
              return (
                <button
                  key={type}
                  onClick={() => setPending(type, def.mode)}
                  title={def.desc}
                  className="flex flex-col items-start rounded border px-2 py-1.5 text-left transition"
                  style={{
                    borderColor: isActive ? def.color : 'rgba(255,255,255,0.1)',
                    background: isActive ? `${def.color}18` : 'transparent',
                    color: isActive ? '#fff' : 'rgba(255,255,255,0.65)',
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm" style={{ background: def.color }} />
                    <span className="font-mono text-[9px] uppercase tracking-[0.07em]">
                      {type === 'annotation' ? 'Note' : type.replace(/_/g, ' ')}
                    </span>
                    <span className="ml-auto font-mono text-[8px] text-white/25">
                      {def.mode === 'Polygon' ? '▪' : def.mode === 'Polyline' ? '—' : '●'}
                    </span>
                  </div>
                  <span className="mt-0.5 text-[9px] text-white/35">{def.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Toolbar button ─────────────────────────────────────────────────────────────
interface ToolBtnProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  color?: string;
  onClick: () => void;
}

function ToolBtn({ icon, label, active, color = '#3b82f6', onClick }: ToolBtnProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex flex-col items-center gap-0.5 rounded-lg border-2 px-3 py-2 transition"
      style={{
        borderColor: active ? color : 'rgba(255,255,255,0.15)',
        background:  active ? `${color}22` : 'rgba(20,20,20,0.92)',
        color:       active ? color : 'rgba(255,255,255,0.65)',
        boxShadow:   active ? `0 0 12px ${color}40` : '0 2px 8px rgba(0,0,0,0.5)',
      }}
    >
      {icon}
      <span className="font-mono text-[8px] uppercase tracking-[0.08em]">{label}</span>
    </button>
  );
}

// ── Main toolbar ───────────────────────────────────────────────────────────────
export default function MapToolbar() {
  const activeTool    = useTacticalStore((s) => s.activeTool);
  const setActiveTool = useTacticalStore((s) => s.setActiveTool);
  const isArrowMode   = useTacticalStore((s) => s.isArrowMode);
  const arrowColor    = useTacticalStore((s) => s.arrowColor);
  const pendingSymbol = useTacticalStore((s) => s.pendingSymbol);

  const [openPanel, setOpenPanel] = useState<ActiveMapTool>(null);

  function toggleTool(tool: ActiveMapTool) {
    if (openPanel === tool) {
      // Click active tool → close panel, deactivate
      setOpenPanel(null);
      setActiveTool(null);
    } else {
      setOpenPanel(tool);
      setActiveTool(tool);
    }
  }

  const panelWidth = openPanel === 'symbol' ? 360 : 300;

  return (
    <div
      className="pointer-events-auto absolute bottom-6 left-1/2 z-[1000] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {/* Panel shown above toolbar when a tool is active */}
      {openPanel && (
        <div
          className="rounded-xl border border-white/15 bg-[#0e0e0e]/96 shadow-[0_8px_32px_rgba(0,0,0,0.7)] backdrop-blur-md"
          style={{ width: panelWidth, maxHeight: 480 }}
        >
          {/* Panel header with close button */}
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/60">
              {openPanel === 'arrow' && 'Arrow Tool'}
              {openPanel === 'symbol' && 'Symbol Library'}
              {openPanel === 'shape' && 'Drawing Shapes'}
            </span>
            <button
              onClick={() => { setOpenPanel(null); setActiveTool(null); }}
              className="rounded p-0.5 text-white/30 hover:text-white/70"
            >
              <X size={12} />
            </button>
          </div>

          {openPanel === 'arrow'  && <ArrowPanel />}
          {openPanel === 'symbol' && <SymbolPanel onClose={() => { setOpenPanel(null); setActiveTool(null); }} />}
          {openPanel === 'shape'  && <ShapePanel />}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-[#0e0e0e]/96 p-2 shadow-[0_4px_20px_rgba(0,0,0,0.6)] backdrop-blur-md">
        <ToolBtn
          icon={<MoveUpRight size={18} />}
          label="Arrow"
          active={isArrowMode}
          color={arrowColor}
          onClick={() => toggleTool('arrow')}
        />
        <ToolBtn
          icon={
            pendingSymbol
              ? <span dangerouslySetInnerHTML={{ __html: new ms.Symbol(pendingSymbol.sidc, { size: 18, frame: true, fill: true, infoFields: false }).asSVG() }} />
              : <Shield size={18} />
          }
          label="Symbols"
          active={openPanel === 'symbol'}
          color="#3b82f6"
          onClick={() => toggleTool('symbol')}
        />
        <ToolBtn
          icon={<Shapes size={18} />}
          label="Shapes"
          active={openPanel === 'shape'}
          color="#22c55e"
          onClick={() => toggleTool('shape')}
        />
      </div>
    </div>
  );
}
