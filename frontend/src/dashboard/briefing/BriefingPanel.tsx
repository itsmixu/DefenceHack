import { useMemo } from 'react';
import TerrainEffectsCard from './TerrainEffectsCard';
import WeatherCard from './WeatherCard';
import DroneConditionsCard from './DroneConditionsCard';
import AstronomyCard from './AstronomyCard';
import SatellitesCard from './SatellitesCard';
import { useBboxStore, useTimelineStore } from '../../store';

// Briefing cards run heavy area-wide analyses on the backend. At low zoom the
// viewport bbox covers most of Finland, the responses balloon, and rendering
// them in a single render pass can crash the tab. Gate everything until the
// user is zoomed in enough that the analysis is bounded.
const BRIEFING_MIN_ZOOM = 9;

const fmtSliderTime = (ms: number): string => {
  const d = new Date(ms);
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
};

export default function BriefingPanel() {
  const committedMs = useTimelineStore((s) => s.committedMs);
  const selectedMs = useTimelineStore((s) => s.selectedMs);
  const zoom = useBboxStore((s) => s.zoom);
  const committedLabel = useMemo(() => fmtSliderTime(committedMs), [committedMs]);
  const isFuture = committedMs > Date.now() + 60_000;
  const isPast = committedMs < Date.now() - 60_000;
  const drift = selectedMs !== committedMs;
  const zoomedOut = zoom != null && zoom < BRIEFING_MIN_ZOOM;

  return (
    <div className="space-y-3">
      <section className="rounded border border-white/15 bg-white/[0.03] px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-white/55">
            timeline @
          </span>
          <span className="font-mono text-[11px] text-white/90">{committedLabel}</span>
        </div>
        <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-white/40">
          {drift
            ? 'release slider to commit…'
            : isFuture
              ? 'forecast view'
              : isPast
                ? 'historical view'
                : 'live'}
        </div>
      </section>
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
        Doctrinal IPB products fused from raw layers. All ratings cite ATP 2-41.1
        Appendix B where applicable.
      </p>

      {zoomedOut ? (
        <section className="rounded border border-amber-300/30 bg-amber-500/[0.06] px-3 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-amber-200/90">
            Zoom in to load briefing
          </p>
          <p className="mt-1 text-[10px] leading-snug text-white/55">
            Briefing analyses are suppressed at zoom&nbsp;{zoom} to prevent the tab
            from crashing on a country-wide bbox. Zoom to at least{' '}
            <strong>{BRIEFING_MIN_ZOOM}</strong> (≈ regional view) and reopen this tab.
          </p>
        </section>
      ) : (
        <>
          <TerrainEffectsCard />
          <WeatherCard />
          <DroneConditionsCard />
          <AstronomyCard />
          <SatellitesCard />
        </>
      )}
    </div>
  );
}
