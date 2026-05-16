import { useDrawnStore } from '../store';

const colorByType: Record<string, string> = {
  AOI: 'bg-slate-800 text-white',
  NAI: 'bg-blue-100 text-blue-800',
  TAI: 'bg-red-100 text-red-800',
  DP: 'bg-purple-100 text-purple-800',
  annotation: 'bg-slate-100 text-slate-700',
};

export default function DrawnList() {
  const features = useDrawnStore((s) => s.features);
  const clear = useDrawnStore((s) => s.clear);

  if (!features.length) {
    return (
      <div>
        <p className="text-xs text-slate-500">
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
        <p className="text-xs text-slate-500">
          {features.length} drawn feature{features.length === 1 ? '' : 's'}
        </p>
        <button
          onClick={() => clear()}
          className="text-[10px] uppercase tracking-wide text-slate-400 hover:text-red-500"
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
              className="rounded border border-slate-200 p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    colorByType[ft] ?? colorByType.annotation
                  }`}
                >
                  {ft}
                </span>
                <span className="text-slate-400">{f.geometry?.type}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
