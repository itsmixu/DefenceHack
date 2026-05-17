import { useMemo } from 'react';
import { MoveUpRight, Shield, Trash2, Ruler } from 'lucide-react';
import ms from 'milsymbol';
import { useDrawnStore } from '../store';

const STYLE_BY_TYPE: Record<string, string> = {
  AOI:          'border border-white/35 bg-white/10 text-white',
  NAI:          'border border-cyan-300/40 bg-cyan-500/10 text-cyan-100',
  TAI:          'border border-red-300/40 bg-red-500/10 text-red-100',
  DP:           'border border-violet-300/40 bg-violet-500/10 text-violet-100',
  PHASE_LINE:   'border border-emerald-300/40 bg-emerald-500/10 text-emerald-100',
  BOUNDARY:     'border border-amber-300/40 bg-amber-500/10 text-amber-100',
  ROUTE:        'border border-purple-300/40 bg-purple-500/10 text-purple-100',
  OBJECTIVE:    'border border-red-300/40 bg-red-500/10 text-red-100',
  UNIT_FRIENDLY:'border border-blue-300/40 bg-blue-500/10 text-blue-100',
  UNIT_ENEMY:   'border border-red-300/40 bg-red-500/10 text-red-100',
  CHOKE_POINT:  'border border-amber-300/40 bg-amber-500/10 text-amber-100',
  HIDE_SITE:    'border border-emerald-300/40 bg-emerald-500/10 text-emerald-100',
  annotation:   'border border-white/20 bg-white/5 text-white/80',
};

const GEO_LABEL: Record<string, string> = {
  Polygon:    'polygon',
  LineString: 'line',
  Point:      'point',
};

function SymbolMiniIcon({ sidc }: { sidc: string }) {
  const svg = useMemo(() => {
    try { return new ms.Symbol(sidc, { size: 24, frame: true, fill: true, infoFields: false }).asSVG(); }
    catch { return ''; }
  }, [sidc]);
  return <span dangerouslySetInnerHTML={{ __html: svg }} style={{ display: 'inline-flex' }} />;
}

export default function DrawnList() {
  const features    = useDrawnStore((s) => s.features);
  const clear       = useDrawnStore((s) => s.clear);
  const removeFeature = useDrawnStore((s) => s.removeFeature);

  if (!features.length) {
    return (
      <div>
        <p className="text-xs text-white/65">
          No drawn features yet. Use the toolbar at the bottom of the map to
          draw arrows, place symbols, or draw areas and lines.
        </p>
      </div>
    );
  }

  const arrows  = features.filter((f) => f.properties?.feature_type === 'ARROW');
  const rulers  = features.filter((f) => f.properties?.feature_type === 'RULER');
  const symbols = features.filter((f) => f.properties?.feature_type === 'SYMBOL');
  const shapes  = features.filter((f) => !['ARROW', 'RULER', 'SYMBOL'].includes(f.properties?.feature_type as string));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
          {features.length} drawn feature{features.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={() => clear()}
          className="text-[10px] uppercase tracking-[0.06em] text-white/50 hover:text-red-300"
        >
          Clear all
        </button>
      </div>

      {/* Arrows section */}
      {arrows.length > 0 && (
        <section>
          <p className="mb-1.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.06em] text-white/35">
            <MoveUpRight size={9} />
            Arrows ({arrows.length})
          </p>
          <ul className="space-y-1">
            {arrows.map((f) => {
              const p = f.properties as {
                color?: string; style?: 'solid' | 'dashed' | 'dotted'; weight?: number;
              };
              const color  = p.color  ?? '#ef4444';
              const style  = p.style  ?? 'solid';
              const weight = p.weight ?? 3;
              const dashArray =
                style === 'dashed' ? '6 3'
                : style === 'dotted' ? '1.5 3'
                : undefined;
              const lineCap = style === 'dashed' ? 'butt' : 'round';

              return (
                <li
                  key={String(f.id)}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5"
                >
                  {/* Arrow preview */}
                  <svg width="36" height="14" style={{ flexShrink: 0, overflow: 'visible' }}>
                    <defs>
                      <marker id={`ah-${f.id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                        <path d="M0,0 L0,6 L6,3 z" fill={color} />
                      </marker>
                    </defs>
                    <line x1="2" y1="7" x2="28" y2="7"
                      stroke={color}
                      strokeWidth={Math.max(1, weight * 0.7)}
                      strokeDasharray={dashArray}
                      strokeLinecap={lineCap}
                      markerEnd={`url(#ah-${f.id})`}
                    />
                  </svg>

                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] font-semibold text-white/85">Arrow</div>
                    <div className="font-mono text-[9px] text-white/40">
                      {style}
                    </div>
                  </div>

                  <button
                    onClick={() => removeFeature(String(f.id))}
                    title="Delete arrow"
                    className="shrink-0 rounded-lg p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Rulers section */}
      {rulers.length > 0 && (
        <section>
          <p className="mb-1.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.06em] text-white/35">
            <Ruler size={9} />
            Rulers ({rulers.length})
          </p>
          <ul className="space-y-1">
            {rulers.map((f) => {
              const p = f.properties as { distance_m?: number };
              const m = p.distance_m ?? 0;
              const label = m >= 10000 ? `${(m / 1000).toFixed(1)} km`
                : m >= 1000 ? `${(m / 1000).toFixed(2)} km`
                : `${Math.round(m)} m`;
              return (
                <li
                  key={String(f.id)}
                  className="flex items-center gap-2 rounded-lg border border-amber-300/25 bg-black/30 px-2 py-1.5"
                >
                  <Ruler size={14} className="shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] font-semibold text-white/85">Ruler</div>
                    <div className="font-mono text-[9px] text-amber-200/80">{label}</div>
                  </div>
                  <button
                    onClick={() => removeFeature(String(f.id))}
                    title="Delete ruler"
                    className="shrink-0 rounded-lg p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Symbols section */}
      {symbols.length > 0 && (
        <section>
          <p className="mb-1.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.06em] text-white/35">
            <Shield size={9} />
            Symbols ({symbols.length})
          </p>
          <ul className="space-y-1">
            {symbols.map((f) => {
              const p = f.properties as { sidc?: string; name?: string; category?: string };
              const sidc     = p.sidc     ?? 'SFGPUCI----D---';
              const name     = p.name     ?? 'Symbol';
              const category = p.category ?? '';
              return (
                <li key={String(f.id)} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
                  <SymbolMiniIcon sidc={sidc} />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[10px] font-semibold text-white/85">{name}</div>
                    <div className="font-mono text-[9px] text-white/40">{category}</div>
                  </div>
                  <button onClick={() => removeFeature(String(f.id))} title="Delete symbol"
                    className="shrink-0 rounded-lg p-1 text-white/30 hover:bg-red-500/15 hover:text-red-300">
                    <Trash2 size={11} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Shapes section */}
      {shapes.length > 0 && (
        <section>
          {(arrows.length > 0 || symbols.length > 0) && (
            <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-white/35">
              Shapes ({shapes.length})
            </p>
          )}
          <ul className="space-y-1">
            {shapes.map((f) => {
              const ft = String(f.properties?.feature_type ?? 'annotation');
              const geoType = f.geometry?.type ?? '';
              return (
                <li
                  key={String(f.id)}
                  className="rounded-lg border border-white/10 bg-black/30 p-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${
                        STYLE_BY_TYPE[ft] ?? STYLE_BY_TYPE.annotation
                      }`}
                    >
                      {ft === 'annotation' ? 'Note' : ft.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-white/45">
                      {GEO_LABEL[geoType] ?? geoType}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
