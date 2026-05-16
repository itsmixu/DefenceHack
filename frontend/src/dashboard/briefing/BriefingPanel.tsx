import TerrainEffectsCard from './TerrainEffectsCard';
import WeatherCard from './WeatherCard';
import DroneConditionsCard from './DroneConditionsCard';
import AstronomyCard from './AstronomyCard';
import SatellitesCard from './SatellitesCard';

export default function BriefingPanel() {
  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-white/55">
        Doctrinal IPB products fused from raw layers. All ratings cite ATP 2-41.1
        Appendix B where applicable.
      </p>
      <TerrainEffectsCard />
      <WeatherCard />
      <DroneConditionsCard />
      <AstronomyCard />
      <SatellitesCard />
    </div>
  );
}
