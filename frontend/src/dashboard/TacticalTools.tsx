import { Crosshair, MousePointer } from 'lucide-react';
import { MILITARY_FEATURE_TYPES, useTacticalStore } from '../store';
import type { MilitaryFeatureType } from '../store';

// Group the military feature types for display.
const GROUPS = [
  {
    label: 'IPB Doctrinal',
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

export default function TacticalTools() {
  const setPending = useTacticalStore((s) => s.setPending);
  const pendingType = useTacticalStore((s) => s.pendingType);

  const handleClick = (type: MilitaryFeatureType, mode: 'Polygon' | 'Polyline' | 'Marker') => {
    setPending(type, mode);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2">
        <MousePointer size={12} className="mt-0.5 flex-shrink-0 text-white/40" />
        <p className="text-[10px] leading-relaxed text-white/55">
          Click a shape below then draw on the map. The tool automatically labels
          your shape with the correct military type and colour.
        </p>
      </div>

      {pendingType && (
        <div className="flex items-center gap-2 rounded border border-amber-300/40 bg-amber-500/10 px-3 py-2">
          <Crosshair size={12} className="text-amber-300" />
          <span className="text-[11px] text-amber-200">
            Drawing&nbsp;<strong>{pendingType}</strong> — click on the map to start
          </span>
        </div>
      )}

      {GROUPS.map((group) => (
        <section key={group.label}>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/40">
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
                  onClick={() => handleClick(type, def.mode)}
                  title={def.desc}
                  style={{
                    borderColor: isActive ? def.color : undefined,
                    backgroundColor: isActive ? `${def.color}18` : undefined,
                  }}
                  className={`flex flex-col items-start rounded border px-2 py-1.5 text-left transition ${
                    isActive
                      ? 'text-white'
                      : 'border-white/10 text-white/65 hover:border-white/30 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-sm"
                      style={{ backgroundColor: def.color }}
                    />
                    <span className="font-mono text-[9px] uppercase tracking-[0.08em]">
                      {type === 'annotation' ? 'Note' : type.replace(/_/g, ' ')}
                    </span>
                    <span className="ml-auto font-mono text-[8px] text-white/30">
                      {def.mode === 'Polygon' ? '▪' : def.mode === 'Polyline' ? '—' : '●'}
                    </span>
                  </div>
                  <span className="mt-0.5 text-[9px] text-white/40 leading-tight">
                    {def.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <p className="font-mono text-[9px] uppercase tracking-[0.04em] text-white/25">
        Shapes are colour-coded by type on the map. Use the Drawn tab to review.
      </p>
    </div>
  );
}
