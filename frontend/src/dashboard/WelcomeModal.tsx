/**
 * WelcomeModal — first-thing-you-see splash describing L1NX.
 *
 * Tactile Noir styling matched to HistoryComingSoon (TopBar.tsx). Auto-opens
 * on app mount; closes via the primary button, backdrop click, or Esc.
 */
import { useEffect, useState } from 'react';
import { Github } from 'lucide-react';

const REPO_URL = 'https://github.com/itsmixu/DefenceHack';

export default function WelcomeModal() {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={() => setOpen(false)}
    >
      <div
        className="rounded-xl border p-8 max-w-lg mx-4"
        style={{ background: '#131313', borderColor: '#393939' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-mono text-lg font-bold tracking-[0.2em] text-white mb-4">
          WELCOME TO L1NX
        </h2>
        <div className="space-y-3 text-sm text-white/70 leading-relaxed">
          <p>
            drop a location and get a full operational picture in seconds —
            terrain analysis, weather intelligence, infrastructure mapping,
            satellite windows, population data, and threat indexing fused onto
            a single interactive map.
          </p>
          <p>
            built for the <span className="text-white/90">Junction × Aalto Defence Hackathon</span> —
            automating intelligence preparation of the battlespace from
            open-source data. <span className="text-white/90">we won. 🏆</span>
          </p>
          <p className="text-white/50">
            click anywhere outside or hit esc to begin.
          </p>
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-white/80 transition hover:border-white hover:bg-white hover:text-black"
            style={{ borderColor: '#393939', background: '#1a1a1a' }}
          >
            <Github size={12} />
            VIEW ON GITHUB
          </a>
          <button
            onClick={() => setOpen(false)}
            className="rounded-sm bg-white px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-black transition-all hover:invert"
          >
            LET'S GO
          </button>
        </div>
      </div>
    </div>
  );
}
