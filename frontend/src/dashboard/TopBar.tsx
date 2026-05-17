/**
 * TopBar — global navigation strip for LINX.
 *
 * Tactile Noir: solid #131313 surface, #393939 bottom border, monospace caps.
 *   • Left:   LINX wordmark
 *   • Center: PLAN / HISTORY tabs (active gets a white underline)
 *   • Right:  collab session pill (role + peer count + take-over) + EXPORT PDF
 */
import { useState } from 'react';
import { Crown, Eye } from 'lucide-react';
import { useCollabStore, useToastStore } from '../store';
import { collabApi } from '../api/collab';
import { DebugTriggerButton } from './DebugPanel';

type TopTab = 'plan' | 'history';

export default function TopBar() {
  const [tab, setTab] = useState<TopTab>('plan');
  const push = useToastStore((s) => s.push);
  const role = useCollabStore((s) => s.role);
  const peers = useCollabStore((s) => s.peers);
  const leaderName = useCollabStore((s) => s.leaderName);
  const fileId = useCollabStore((s) => s.fileId);
  const sessionId = useCollabStore((s) => s.sessionId);

  const me = peers.find((p) => p.sessionId === sessionId);
  const myCallsign = me?.displayName ?? null;
  const peerCount = peers.length;
  const followerCount = peers.filter((p) => p.role === 'follower').length;

  async function handleTakeover() {
    if (!fileId || !sessionId) return;
    try {
      await collabApi.takeover(fileId, sessionId);
      push('success', 'You are now the lead');
    } catch (e) {
      push('error', `Take-over failed: ${String(e)}`);
    }
  }

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
        {/* Assigned callsign (auto-assigned NATO phonetic per session) */}
        {myCallsign && (
          <span
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50"
            title="Auto-assigned callsign for this session"
          >
            you: {myCallsign}
          </span>
        )}

        {/* Collab session pill */}
        {role ? (
          <div
            className="flex items-center gap-2 rounded-sm border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]"
            style={{
              borderColor: role === 'leader' ? '#fbbf24' : '#393939',
              background: role === 'leader' ? 'rgba(251,191,36,0.10)' : '#1a1a1a',
              color: role === 'leader' ? '#fbbf24' : 'rgba(255,255,255,0.65)',
            }}
          >
            {role === 'leader' ? <Crown size={11} /> : <Eye size={11} />}
            <span>
              {role === 'leader'
                ? `LEAD · ${followerCount} FOLLOWER${followerCount === 1 ? '' : 'S'}`
                : `FOLLOWER · LEAD: ${leaderName ?? '—'}`}
            </span>
            {role === 'follower' && (
              <button
                onClick={handleTakeover}
                className="ml-1 rounded-sm border px-1.5 py-0.5 text-[9px] text-white/80 transition hover:border-white hover:bg-white hover:text-black"
                style={{ borderColor: '#393939', background: '#131313' }}
                title="Take over as leader"
              >
                TAKE LEAD
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
            <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
            {peerCount > 0 ? `${peerCount} IN SESSION` : 'NO FILE OPEN'}
          </div>
        )}

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
    </nav>
  );
}
