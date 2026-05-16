/**
 * TopBar — global navigation strip for LINX.
 *
 * Tactile Noir: solid #131313 surface, #393939 bottom border, monospace caps.
 *   • Left:   LINX wordmark
 *   • Center: PLAN / HISTORY tabs (active gets a white underline)
 *   • Right:  active-operator indicator + EXPORT PDF action
 */
import { useState } from 'react';
import { useToastStore } from '../store';

type TopTab = 'plan' | 'history';

const OPERATORS_ACTIVE = 3; // placeholder — wire to presence service later

export default function TopBar() {
  const [tab, setTab] = useState<TopTab>('plan');
  const push = useToastStore((s) => s.push);

  return (
    <nav
      className="flex h-16 w-full shrink-0 items-center justify-between px-8"
      style={{ background: '#131313', borderBottom: '1px solid #393939' }}
    >
      {/* Brand */}
      <div className="text-xl font-black tracking-tighter text-white">LINX</div>

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
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          {OPERATORS_ACTIVE} OPERATORS ACTIVE
        </div>
        <button
          onClick={() => push('info', 'PDF export not implemented yet')}
          className="rounded-sm bg-white px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black transition-all hover:invert"
        >
          EXPORT PDF
        </button>
      </div>
    </nav>
  );
}
