import { useState, useEffect } from 'react';
import { useToastStore } from '../store';
import { DebugTriggerButton } from './DebugPanel';

type TopTab = 'plan' | 'history';

export default function TopBar() {
  const [tab, setTab] = useState<TopTab>('plan');
  const push = useToastStore((s) => s.push);

  return (
    <nav
      className="flex h-16 w-full shrink-0 items-center justify-between px-8"
      style={{ background: '#131313', borderBottom: '1px solid #393939' }}
    >
      {/* Brand */}
      <div className="text-xl font-black tracking-tighter text-white">L1NX</div>

      {/* Tabs */}
      <div className="flex items-center gap-10 font-mono text-[11px] tracking-[0.2em]">
        <button
          onClick={() => setTab('plan')}
          className="pb-1 transition-colors"
          style={{
            color: tab === 'plan' ? '#ffffff' : 'rgba(255,255,255,0.5)',
            borderBottom: tab === 'plan' ? '2px solid #ffffff' : '2px solid transparent',
          }}
        >
          PLAN
        </button>
        <button
          onClick={() => setTab('history')}
          className="pb-1 transition-colors"
          style={{
            color: tab === 'history' ? '#ffffff' : 'rgba(255,255,255,0.5)',
            borderBottom: tab === 'history' ? '2px solid #ffffff' : '2px solid transparent',
          }}
        >
          HISTORY
        </button>
      </div>

      {/* Utilities */}
      <div className="flex items-center gap-4">
        {/* Network debug trigger — opens the request log overlay */}
        <DebugTriggerButton />

        {/* Primary action */}
        <button
          onClick={() => push('info', 'PDF export not implemented yet')}
          className="rounded-sm bg-white px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black transition-all hover:invert"
        >
          EXPORT PDF
        </button>
      </div>
      {tab === 'history' && <HistoryComingSoon onClose={() => setTab('plan')} />}
    </nav>
  );
}

function HistoryComingSoon({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl border p-8 max-w-lg mx-4"
        style={{ background: '#131313', borderColor: '#393939' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-mono text-lg font-bold tracking-[0.2em] text-white mb-4">
          PAST OPERATIONS
        </h2>
        <div className="space-y-3 text-sm text-white/70 leading-relaxed">
          <p>
            this is where you will browse archived missions, after-action reports,
            and prior plans once the operation has concluded.
          </p>
          <p>
            historical overlays, route playbacks, and decision logs will be
            recoverable here for review and debrief.
          </p>
          <p className="text-white/50">coming soon.</p>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-sm bg-white px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black transition-all hover:invert"
          >
            BACK TO PLAN
          </button>
        </div>
      </div>
    </div>
  );
}
