import { getDemoManifest, isDemoMode } from './demoMode';

export default function DemoBanner() {
  if (!isDemoMode()) return null;
  const m = getDemoManifest();
  const area = m?.area_label ?? 'preset area';
  const captured = m?.captured_at?.slice(0, 10) ?? '';
  return (
    <div
      className="pointer-events-none fixed bottom-3 left-1/2 z-[9999] -translate-x-1/2"
    >
      <div
        className="rounded-sm border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] shadow-[0_4px_14px_rgba(0,0,0,0.6)]"
        style={{ background: '#fbbf24', borderColor: '#92400e', color: '#1c1917' }}
      >
        DEMO · {area}{captured ? ` · ${captured}` : ''}
      </div>
    </div>
  );
}
