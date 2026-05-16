import { useDrawnStore } from '../store';

const colorByType: Record<string, string> = {
  AOI: 'border border-white/35 bg-white/10 text-white',
  NAI: 'border border-cyan-300/40 bg-cyan-500/10 text-cyan-100',
  TAI: 'border border-red-300/40 bg-red-500/10 text-red-100',
  DP: 'border border-violet-300/40 bg-violet-500/10 text-violet-100',
  annotation: 'border border-white/20 bg-white/5 text-white/80',
};

export default function DrawnList() {
  const features = useDrawnStore((s) => s.features);
  const clear = useDrawnStore((s) => s.clear);

  if (!features.length) {
    return (
      <div>
        <p className="text-xs text-white/65">
          No drawn features yet. Use the toolbar at the top-left of the map to
          draw an <strong>AOI</strong>, <strong>NAI</strong>,{' '}
          <strong>TAI</strong>, <strong>DP</strong>, or annotation.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
          {features.length} drawn feature{features.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={() => clear()}
          className="text-[10px] uppercase tracking-[0.06em] text-white/50 hover:text-red-300"
        >
          Clear store
        </button>
      </div>
      <ul className="space-y-2">
        {features.map((f) => {
          const ft = String(
            (f.properties as { feature_type?: string } | null)?.feature_type ??
              'annotation',
          );
          return (
            <li
              key={String(f.id)}
              className="rounded border border-white/10 bg-black/30 p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${
                    colorByType[ft] ?? colorByType.annotation
                  }`}
                >
                  {ft}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-white/45">{f.geometry?.type}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
