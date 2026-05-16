import L from 'leaflet';
import type { GeoJSONOptions, PathOptions, StyleFunction } from 'leaflet';
import type { LayerKey } from '../api/types';
import { getOsmPoiMeta } from './osmPoi';
import { buildPopup, fmtInt, fmtPct } from './popupHelpers';
import { zoomScale } from './zoomScale';

const baseColorByLayer: Record<LayerKey, string> = {
  osm: '#ef4444',
  digiroad: '#6b7280',
  mml: '#16a34a',
  mml_contours: '#92400e',
  statfin: '#a855f7',
  fmi: '#0ea5e9',
  fmi_forecast: '#38bdf8',
  syke: '#2563eb',
  opencellid: '#3b82f6',
  starlink: '#9333ea',
  astronomy: '#fbbf24',
  exposure: '#dc2626',
  mcoo: '#16a34a',
};

// Cell tower colour by radio technology.
const cellRadioColor: Record<string, string> = {
  NR:   '#22c55e',  // 5G — green
  LTE:  '#3b82f6',  // 4G — blue
  UMTS: '#eab308',  // 3G — yellow
  GSM:  '#9ca3af',  // 2G — grey
};

const exposurePalette = ['#86efac', '#fde047', '#fb923c', '#ef4444', '#7f1d1d'];
const exposureColor = (level: number) =>
  exposurePalette[Math.min(Math.max(Math.round(level), 1), 5) - 1];

const mcooColor = (cls: string) => {
  if (cls === 'go') return '#22c55e';
  if (cls === 'slow-go') return '#eab308';
  if (cls === 'no-go') return '#ef4444';
  return '#6b7280';
};

const terrainFill = (terrainType: string) => {
  const t = terrainType.toLowerCase();
  if (t.includes('jarvi') || t.includes('meri') || t.includes('vesi')) return '#60a5fa';
  if (t.includes('suo')) return '#a16207';
  if (t.includes('kallio')) return '#9ca3af';
  if (t.includes('metsa') || t.includes('forest')) return '#16a34a';
  if (t.includes('pelto') || t.includes('field')) return '#fde68a';
  return '#16a34a';
};

const formatValue = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

export function getStyleForLayer(layer: LayerKey, zoom?: number | null): GeoJSONOptions {
  const baseColor = baseColorByLayer[layer];
  const scale = zoomScale(zoom);

  const style: StyleFunction = (feature) => {
    const p = (feature?.properties ?? {}) as Record<string, unknown>;
    const opts: PathOptions = {
      color: baseColor,
      weight: 1.5,
      fillOpacity: 0.3,
      fillColor: baseColor,
    };

    switch (layer) {
      case 'digiroad': {
        const isBridge = Boolean(p.is_bridge);
        opts.color = isBridge ? '#1d4ed8' : '#6b7280';
        opts.weight = isBridge ? 4 : 1.5;
        break;
      }
      case 'mml_contours': {
        opts.color = '#92400e';
        opts.weight = 0.8;
        opts.fillOpacity = 0;
        break;
      }
      case 'mml': {
        const tt = String(p.terrain_type ?? '');
        const c = terrainFill(tt);
        opts.color = c;
        opts.fillColor = c;
        opts.fillOpacity = 0.4;
        opts.weight = 0.5;
        break;
      }
      case 'exposure': {
        const level = Number(p.danger_level ?? 1);
        opts.color = exposureColor(level);
        opts.fillColor = exposureColor(level);
        opts.fillOpacity = 0.45;
        opts.weight = 0.5;
        break;
      }
      case 'mcoo': {
        const cls = String(p.mcoo_class ?? '');
        const c = mcooColor(cls);
        opts.color = c;
        opts.fillColor = c;
        opts.fillOpacity = 0.35;
        opts.weight = 0.5;
        break;
      }
      case 'statfin': {
        // Paavo polygons — colour by population density (people / km²).
        // Backend emits raw Finnish field names: he_vakiy = total population,
        // pinta_ala = area in m².
        const pop = Number(p.he_vakiy ?? 0);
        const areaM2 = Number(p.pinta_ala ?? 0);
        const areaKm2 = areaM2 > 0 ? areaM2 / 1_000_000 : 1;
        const density = pop / Math.max(areaKm2, 0.0001);
        const t = Math.min(density / 500, 1);
        const r = Math.round(168 + (88 - 168) * t);
        const g = Math.round(85 + (28 - 85) * t);
        const b = Math.round(247 + (135 - 247) * t);
        const c = `rgb(${r},${g},${b})`;
        opts.color = c;
        opts.fillColor = c;
        opts.fillOpacity = 0.45;
        opts.weight = 0.5;
        break;
      }
      case 'opencellid': {
        // Coverage ring polygons — dashed outline, very low fill so towers beneath stay visible.
        const radio = String(p.radio ?? 'LTE').toUpperCase();
        const c = cellRadioColor[radio] ?? '#3b82f6';
        opts.color = c;
        opts.fillColor = c;
        opts.fillOpacity = 0.07;
        opts.weight = 1.5;
        opts.dashArray = '6 4';
        break;
      }
      case 'starlink': {
        // Only the footprint polygons should get this faint horizon style.
        // Position points are Leaflet circleMarkers (also path-styled by this
        // function); without this guard the circleMarker's bright fill from
        // pointToLayer would be overridden with fillOpacity=0.04, making the
        // satellite dot effectively invisible.
        const isFootprint =
          (p.feature_type === 'footprint') || feature?.geometry?.type === 'Polygon';
        if (isFootprint) {
          opts.color = '#a855f7';
          opts.fillColor = '#a855f7';
          opts.fillOpacity = 0.04;
          opts.weight = 1;
          opts.dashArray = '4 6';
        }
        // For position points: leave the bright defaults from pointToLayer
        // alone — Leaflet still calls style() on circleMarkers, so returning
        // a clean PathOptions here would also override them. Use the elevation-
        // tinted colour set in pointToLayer instead.
        else {
          const elev = Number(p.elevation_deg ?? 0);
          const c = elev > 45 ? '#d946ef' : elev > 20 ? '#a855f7' : '#7c3aed';
          opts.color = '#ffffff';      // white ring (matches pointToLayer)
          opts.fillColor = c;
          opts.fillOpacity = 0.9;
          opts.weight = 2;
        }
        break;
      }
      case 'syke': {
        // Flood risk zones (blue) and Natura 2000 protected areas (green).
        const kind = String(p.kind ?? p.layer ?? '');
        const isNatura = kind.includes('natura') || kind.includes('n2000');
        opts.color = isNatura ? '#16a34a' : '#2563eb';
        opts.fillColor = opts.color;
        opts.fillOpacity = 0.25;
        opts.weight = 1.5;
        opts.dashArray = isNatura ? '6 4' : undefined;
        break;
      }
      case 'fmi_forecast': {
        // Forecast zones — color by drone rating (doctrinal fusion of
        // wind/temp/visibility/ceiling). Green=go, amber=marginal, red=no-go.
        const rating = String(p.drone_rating ?? '').toLowerCase();
        const fill =
          rating === 'no-go' ? '#dc2626' :
          rating === 'marginal' ? '#f59e0b' :
          rating === 'go' ? '#16a34a' :
          '#38bdf8';
        opts.color = fill;
        opts.fillColor = fill;
        opts.fillOpacity = 0.22;
        opts.weight = 1.5;
        opts.dashArray = '4 3';
        break;
      }
      case 'astronomy': {
        // Astronomical daily features — coloured by night_ops_rating.
        const rating = String(p.night_ops_rating ?? '');
        opts.color = rating === 'dark' ? '#1e1b4b' : rating === 'partial' ? '#92400e' : '#fbbf24';
        opts.fillColor = opts.color;
        opts.fillOpacity = 0.2;
        opts.weight = 1;
        break;
      }
    }

    return opts;
  };

  const pointToLayer: GeoJSONOptions['pointToLayer'] = (feature, latlng) => {
    const p = (feature.properties ?? {}) as Record<string, unknown>;
    let color = baseColor;
    let radius = 5;

    if (layer === 'osm') {
      const meta = getOsmPoiMeta(String(p.category ?? ''));
      const icon = meta?.icon ?? '•';
      const iconColor = meta?.color ?? '#ef4444';
      const size = Math.round(20 * scale);
      const half = Math.round(size / 2);
      const fontSize = Math.max(8, Math.round(12 * scale));
      const marker = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:#fff;border:2px solid ${iconColor};display:flex;align-items:center;justify-content:center;font-size:${fontSize}px;line-height:1">${icon}</div>`,
        iconSize: [size, size],
        iconAnchor: [half, half],
        popupAnchor: [0, -half],
      });
      return L.marker(latlng, { icon: marker });
    } else if (layer === 'fmi') {
      color = '#0ea5e9';
      radius = 7;
    } else if (layer === 'opencellid') {
      // category="coverage" features are Polygons and go through style(), not here.
      // Only Point features (category="tower") reach pointToLayer.
      const radio = String(p.radio ?? 'LTE').toUpperCase();
      color = cellRadioColor[radio] ?? '#3b82f6';
      radius = 7;
    } else if (layer === 'starlink') {
      // Elevation angle → colour: high overhead = bright purple, near-horizon = dim
      const elev = Number(p.elevation_deg ?? 0);
      color = elev > 45 ? '#d946ef' : elev > 20 ? '#a855f7' : '#7c3aed';
      radius = elev > 45 ? 8 : 6;
    } else if (layer === 'astronomy') {
      // One point per day at bbox centroid — colour by night ops rating.
      const rating = String(p.night_ops_rating ?? '');
      color = rating === 'dark' ? '#818cf8' : rating === 'partial' ? '#f59e0b' : '#fbbf24';
      radius = 9;
    } else if (layer === 'fmi_forecast') {
      color = '#38bdf8';
      radius = 5;
    }

    return L.circleMarker(latlng, {
      radius: radius * scale,
      color: '#fff',       // white border makes dots pop on any background
      weight: 2,
      fillColor: color,
      fillOpacity: 0.9,
    });
  };

  const onEachFeature: GeoJSONOptions['onEachFeature'] = (feature, lyr) => {
    const props = feature.properties ?? {};
    if (layer === 'osm') {
      const p = props as Record<string, unknown>;
      const category = String(p.category ?? 'unknown');
      const meta = getOsmPoiMeta(category);
      const name = String(p.name ?? 'Unnamed POI');
      const operator = p.operator ? `<div><span style="color:#64748b">operator</span>: <strong>${formatValue(p.operator)}</strong></div>` : '';
      const html = `
        <div style="font-size:11px;line-height:1.4;min-width:180px">
          <div style="font-weight:700;margin-bottom:2px">${meta?.icon ?? '•'} ${name}</div>
          <div><span style="color:#64748b">category</span>: <strong>${meta?.label ?? category}</strong></div>
          ${operator}
        </div>
      `;
      lyr.bindPopup(html);
      return;
    }

    if (layer === 'opencellid' && props.category === 'tower') {
      const radio = String(props.radio ?? 'LTE').toUpperCase();
      const radiusM = Number(props.radius_m ?? 0);
      const radiusKm = (radiusM / 1000).toFixed(0);
      const color = cellRadioColor[radio] ?? '#3b82f6';
      const gen = radio === 'NR' ? '5G' : radio === 'LTE' ? '4G' : radio === 'UMTS' ? '3G' : '2G';
      const signal = props.signal_strength != null ? `${props.signal_strength} dBm` : '—';
      lyr.bindPopup(`
        <div style="font-size:11px;line-height:1.6;min-width:160px">
          <div style="font-weight:700;margin-bottom:4px">
            <span style="background:${color};color:#fff;padding:1px 6px;border-radius:3px">${gen} ${radio}</span>
            Cell tower
          </div>
          <div><span style="color:#64748b">Est. range</span>: <strong>~${radiusKm} km</strong></div>
          <div><span style="color:#64748b">Avg signal</span>: <strong>${signal}</strong></div>
          ${props.mcc != null ? `<div><span style="color:#64748b">MCC/MNC</span>: <strong>${props.mcc}/${props.mnc}</strong></div>` : ''}
          ${props.samples != null ? `<div><span style="color:#64748b">Samples</span>: <strong>${props.samples}</strong></div>` : ''}
          <div style="margin-top:4px;color:#94a3b8;font-size:10px">Coverage ring = estimated — varies with terrain</div>
        </div>
      `);
      return;
    }

    if (layer === 'opencellid') return; // coverage polygons don't need their own popup

    // Starlink: bind the rich satellite popup to every Point feature regardless of
    // whether feature_type is set to 'position' (defensive — provider currently
    // emits feature_type, but the popup is the right one for any sat-position
    // point). Footprint polygons fall through to the early-return below.
    const isStarlinkPoint =
      layer === 'starlink' &&
      (props.feature_type === 'position' ||
        (feature.geometry?.type === 'Point' && props.feature_type !== 'footprint'));
    if (isStarlinkPoint) {
      const alt   = props.altitude_km  != null ? `${Number(props.altitude_km).toFixed(0)} km`  : '—';
      const elev  = props.elevation_deg != null ? `${Number(props.elevation_deg).toFixed(1)}°`  : '—';
      const speed = props.speed_kmh     != null ? `${Number(props.speed_kmh / 1000).toFixed(1)} km/s` : '—';
      const fp    = props.footprint_radius_km != null ? `~${Number(props.footprint_radius_km).toFixed(0)} km` : '—';
      const incl  = props.inclination_deg    != null ? `${Number(props.inclination_deg).toFixed(1)}°`  : '—';
      lyr.bindPopup(`
        <div style="font-size:11px;line-height:1.6;min-width:185px">
          <div style="font-weight:700;margin-bottom:4px">🛰 ${props.satname ?? 'Starlink'}</div>
          <div><span style="color:#64748b">NORAD ID</span>: <strong>${props.norad_id ?? '—'}</strong></div>
          <div><span style="color:#64748b">Altitude</span>: <strong>${alt}</strong></div>
          <div><span style="color:#64748b">Elevation</span>: <strong>${elev}</strong></div>
          <div><span style="color:#64748b">Speed</span>: <strong>${speed}</strong></div>
          <div><span style="color:#64748b">Coverage radius</span>: <strong>${fp}</strong></div>
          <div><span style="color:#64748b">Inclination</span>: <strong>${incl}</strong></div>
          <div style="margin-top:4px;color:#94a3b8;font-size:10px">Coverage circle = horizon-to-horizon visibility. Source: Celestrak TLE / SGP4.</div>
        </div>
      `);
      return;
    }

    if (layer === 'starlink') return;

    if (layer === 'astronomy') {
      const p = props as Record<string, unknown>;
      const rating = String(p.night_ops_rating ?? '');
      const ratingColor = rating === 'dark' ? '#818cf8' : rating === 'partial' ? '#f59e0b' : '#fbbf24';
      const illum = p.moon_illumination_pct != null ? `${p.moon_illumination_pct}%` : '—';
      const dark = p.darkness_hours != null ? `${Number(p.darkness_hours).toFixed(1)} h` : '—';
      lyr.bindPopup(`
        <div style="font-size:11px;line-height:1.6;min-width:180px">
          <div style="font-weight:700;margin-bottom:4px">${p.date ?? '—'}</div>
          <div><span style="color:#64748b">Night ops</span>: <strong style="color:${ratingColor}">${rating.toUpperCase()}</strong></div>
          <div><span style="color:#64748b">Moon illum.</span>: <strong>${illum}</strong></div>
          <div><span style="color:#64748b">Darkness</span>: <strong>${dark}</strong></div>
          <div><span style="color:#64748b">Sunrise</span>: <strong>${p.sunrise ?? '—'}</strong></div>
          <div><span style="color:#64748b">Sunset</span>: <strong>${p.sunset ?? '—'}</strong></div>
          <div><span style="color:#64748b">Civil dawn</span>: <strong>${p.civil_dawn ?? '—'}</strong> / <strong>${p.civil_dusk ?? '—'}</strong> dusk</div>
        </div>
      `);
      return;
    }

    if (layer === 'syke') {
      const p = props as Record<string, unknown>;
      const kind = String(p.kind ?? p.layer ?? 'Unknown');
      const name = String(p.name ?? p.nimi ?? '');
      lyr.bindPopup(`
        <div style="font-size:11px;line-height:1.6;min-width:160px">
          <div style="font-weight:700;margin-bottom:2px">${name || kind}</div>
          <div><span style="color:#64748b">Type</span>: <strong>${kind}</strong></div>
          ${p.area_ha ? `<div><span style="color:#64748b">Area</span>: <strong>${Number(p.area_ha).toFixed(0)} ha</strong></div>` : ''}
        </div>
      `);
      return;
    }

    if (layer === 'fmi') {
      const p = props as Record<string, unknown>;
      const time = p.time ? String(p.time) : '';
      // Show HH:MM UTC from the ISO timestamp.
      const hhmm = time.length >= 16 ? `${time.slice(11, 16)} UTC` : '';

      const tempC      = Number(p.temperature_c ?? NaN);
      const dewC       = Number(p.dewpoint_c ?? NaN);
      const chillC     = Number(p.wind_chill_c ?? NaN);
      const humidity   = Number(p.humidity_pct ?? NaN);
      const pressure   = Number(p.pressure_hpa ?? NaN);
      const windMs     = Number(p.wind_speed_ms ?? NaN);
      const windCard   = p.wind_direction_card ? String(p.wind_direction_card) : '';
      const windDeg    = Number(p.wind_direction_deg ?? NaN);
      const gustMs     = Number(p.wind_gust_ms ?? NaN);
      const precip     = Number(p.precipitation_mmh ?? NaN);
      const precipKind = p.precip_intensity ? String(p.precip_intensity) : '';
      const visM       = Number(p.visibility_m ?? NaN);
      const cloud      = Number(p.cloud_cover_pct ?? NaN);
      const snow       = Number(p.snow_depth_cm ?? NaN);

      // Headline temperature with wind-chill suffix when it actually differs.
      let tempValue: string | undefined;
      if (Number.isFinite(tempC)) {
        const main = `${tempC.toFixed(1)}°C`;
        const chillDiffers = Number.isFinite(chillC) && Math.abs(chillC - tempC) >= 1;
        tempValue = chillDiffers
          ? `${main}`
          : main;
      }
      const chillHint = Number.isFinite(chillC) && Number.isFinite(tempC) && Math.abs(chillC - tempC) >= 1
        ? `feels ${chillC.toFixed(0)}°C`
        : undefined;

      // Wind: "6 m/s NE (gust 9)"
      let windValue: string | undefined;
      if (Number.isFinite(windMs)) {
        const dir = windCard || (Number.isFinite(windDeg) ? `${Math.round(windDeg)}°` : '');
        windValue = dir ? `${windMs.toFixed(1)} m/s ${dir}` : `${windMs.toFixed(1)} m/s`;
      }
      const gustHint = Number.isFinite(gustMs) ? `gust ${gustMs.toFixed(0)}` : undefined;

      // Conditions: "Cloud 40% · Light rain"
      const condParts: string[] = [];
      if (Number.isFinite(cloud)) condParts.push(`Cloud ${Math.round(cloud)}%`);
      if (precipKind && precipKind !== 'none') {
        const verb = precipKind.charAt(0).toUpperCase() + precipKind.slice(1);
        condParts.push(Number.isFinite(precip) && precip > 0 ? `${verb} ${precip.toFixed(1)} mm/h` : verb);
      }
      const condValue = condParts.join(' · ') || undefined;

      // Quick drone-ops verdict — mirrors backend doctrine thresholds.
      let tactical: string | undefined;
      let droneState: 'no-go' | 'marginal' | 'go' = 'go';
      let droneReason = '';
      if (Number.isFinite(windMs) && windMs >= 12) { droneState = 'no-go'; droneReason = `wind ${windMs.toFixed(0)} m/s`; }
      else if (Number.isFinite(gustMs) && gustMs >= 15) { droneState = 'no-go'; droneReason = `gusts ${gustMs.toFixed(0)} m/s`; }
      else if (Number.isFinite(visM) && visM < 1000) { droneState = 'no-go'; droneReason = `vis ${(visM / 1000).toFixed(1)} km`; }
      else if (Number.isFinite(tempC) && tempC <= -15) { droneState = 'no-go'; droneReason = `temp ${tempC.toFixed(0)}°C`; }
      else if (Number.isFinite(windMs) && windMs >= 8) { droneState = 'marginal'; droneReason = `wind ${windMs.toFixed(0)} m/s`; }
      else if (Number.isFinite(gustMs) && gustMs >= 10) { droneState = 'marginal'; droneReason = `gusts ${gustMs.toFixed(0)} m/s`; }
      else if (Number.isFinite(visM) && visM < 3000) { droneState = 'marginal'; droneReason = `vis ${(visM / 1000).toFixed(1)} km`; }
      else if (Number.isFinite(tempC) && tempC <= 0) { droneState = 'marginal'; droneReason = `temp ${tempC.toFixed(0)}°C`; }
      if (Number.isFinite(windMs) || Number.isFinite(visM) || Number.isFinite(tempC)) {
        tactical = droneReason
          ? `Drone: ${droneState.toUpperCase()} (${droneReason})`
          : `Drone: ${droneState.toUpperCase()}`;
      }

      lyr.bindPopup(buildPopup({
        header: 'Weather observation',
        subheader: hhmm || undefined,
        minWidth: 220,
        facts: [
          { label: 'Temperature', value: tempValue, hint: chillHint },
          { label: 'Wind', value: windValue, hint: gustHint },
          { label: 'Conditions', value: condValue },
        ],
        tactical,
        details: {
          facts: [
            { label: 'Dewpoint', value: Number.isFinite(dewC) ? `${dewC.toFixed(1)}°C` : undefined },
            { label: 'Humidity', value: Number.isFinite(humidity) ? `${Math.round(humidity)}%` : undefined },
            { label: 'Pressure', value: Number.isFinite(pressure) ? `${Math.round(pressure)} hPa` : undefined },
            { label: 'Visibility', value: Number.isFinite(visM) ? `${(visM / 1000).toFixed(1)} km` : undefined },
            { label: 'Wind gust', value: Number.isFinite(gustMs) ? `${gustMs.toFixed(1)} m/s` : undefined },
            { label: 'Wind direction', value: Number.isFinite(windDeg) ? `${Math.round(windDeg)}°` : undefined },
            { label: 'Precipitation', value: Number.isFinite(precip) ? `${precip.toFixed(2)} mm/h` : undefined },
            { label: 'Snow depth', value: Number.isFinite(snow) ? `${Math.round(snow)} cm` : undefined },
            { label: 'Time (UTC)', value: time || undefined },
          ],
        },
      }));
      return;
    }

    if (layer === 'fmi_forecast') {
      const p = props as Record<string, unknown>;
      const time = p.time ? String(p.time) : '';
      const hhmm = time.length >= 16 ? `${time.slice(11, 16)} UTC` : '';

      const tempC    = Number(p.temperature_c ?? NaN);
      const windMs   = Number(p.wind_speed_ms ?? NaN);
      const windDeg  = Number(p.wind_direction_deg ?? NaN);
      const gustMs   = Number(p.wind_gust_ms ?? NaN);
      const precip   = Number(p.precipitation_mmh ?? NaN);
      const cloud    = Number(p.cloud_cover_pct ?? NaN);
      const lowCloud = Number(p.low_cloud_pct ?? NaN);
      const visM     = Number(p.visibility_m ?? NaN);
      const ceilM    = Number(p.ceiling_m ?? NaN);
      const humidity = Number(p.humidity_pct ?? NaN);

      let leadHint: string | undefined;
      if (time) {
        const t = Date.parse(time);
        if (Number.isFinite(t)) {
          const hours = Math.round((t - Date.now()) / 3_600_000);
          leadHint = hours === 0 ? 'now'
            : hours > 0 ? `+${hours}h`
            : `${hours}h`;
        }
      }

      const cardinals = ['N','NE','E','SE','S','SW','W','NW'];
      const windCard = Number.isFinite(windDeg)
        ? cardinals[Math.round((((windDeg % 360) + 360) % 360) / 45) % 8]
        : '';

      const tempValue = Number.isFinite(tempC) ? `${tempC.toFixed(1)}°C` : undefined;

      let windValue: string | undefined;
      if (Number.isFinite(windMs)) {
        const dir = windCard || (Number.isFinite(windDeg) ? `${Math.round(windDeg)}°` : '');
        windValue = dir ? `${windMs.toFixed(1)} m/s ${dir}` : `${windMs.toFixed(1)} m/s`;
      }
      const gustHint = Number.isFinite(gustMs) ? `gust ${gustMs.toFixed(0)}` : undefined;

      const condParts: string[] = [];
      if (Number.isFinite(cloud)) condParts.push(`Cloud ${Math.round(cloud)}%`);
      if (Number.isFinite(precip) && precip > 0) condParts.push(`Rain ${precip.toFixed(1)} mm/h`);
      const condValue = condParts.join(' · ') || undefined;

      let tactical: string | undefined;
      const droneSummary = p.drone_summary ? String(p.drone_summary) : '';
      const droneRating  = p.drone_rating  ? String(p.drone_rating)  : '';
      if (droneSummary) {
        tactical = droneSummary;
      } else if (droneRating) {
        tactical = `Drone: ${droneRating.toUpperCase()}`;
      } else {
        let droneState: 'no-go' | 'marginal' | 'go' = 'go';
        let droneReason = '';
        if (Number.isFinite(windMs) && windMs >= 12) { droneState = 'no-go'; droneReason = `wind ${windMs.toFixed(0)} m/s`; }
        else if (Number.isFinite(gustMs) && gustMs >= 15) { droneState = 'no-go'; droneReason = `gusts ${gustMs.toFixed(0)} m/s`; }
        else if (Number.isFinite(visM) && visM < 1000) { droneState = 'no-go'; droneReason = `vis ${(visM / 1000).toFixed(1)} km`; }
        else if (Number.isFinite(tempC) && tempC <= -15) { droneState = 'no-go'; droneReason = `temp ${tempC.toFixed(0)}°C`; }
        else if (Number.isFinite(windMs) && windMs >= 8) { droneState = 'marginal'; droneReason = `wind ${windMs.toFixed(0)} m/s`; }
        else if (Number.isFinite(gustMs) && gustMs >= 10) { droneState = 'marginal'; droneReason = `gusts ${gustMs.toFixed(0)} m/s`; }
        else if (Number.isFinite(visM) && visM < 3000) { droneState = 'marginal'; droneReason = `vis ${(visM / 1000).toFixed(1)} km`; }
        else if (Number.isFinite(tempC) && tempC <= 0) { droneState = 'marginal'; droneReason = `temp ${tempC.toFixed(0)}°C`; }
        if (Number.isFinite(windMs) || Number.isFinite(visM) || Number.isFinite(tempC)) {
          tactical = droneReason
            ? `Drone: ${droneState.toUpperCase()} (${droneReason})`
            : `Drone: ${droneState.toUpperCase()}`;
        }
      }

      const aviation = p.aviation_rating ? String(p.aviation_rating) : '';

      // Permanent on-map label so the user can read conditions at a glance
      // without clicking. Arrows point in the direction the wind is going.
      const cardinalArrows = ['↓','↙','←','↖','↑','↗','→','↘'];
      const windArrow = Number.isFinite(windDeg)
        ? cardinalArrows[Math.round((((windDeg % 360) + 360) % 360) / 45) % 8]
        : '';
      const labelRows: string[] = [];
      if (Number.isFinite(tempC)) labelRows.push(`${tempC.toFixed(0)}°C`);
      if (Number.isFinite(windMs)) labelRows.push(`${windMs.toFixed(0)} m/s ${windArrow}`.trim());
      if (Number.isFinite(precip) && precip >= 0.1) labelRows.push(`☂ ${precip.toFixed(1)}`);
      else if (Number.isFinite(cloud)) labelRows.push(`☁ ${Math.round(cloud)}%`);
      const labelHtml = labelRows.length
        ? `<div class="fmi-forecast-label">${labelRows.map((r) => `<span>${r}</span>`).join('')}</div>`
        : '';
      if (labelHtml) {
        lyr.bindTooltip(labelHtml, {
          permanent: true,
          direction: 'center',
          className: 'fmi-forecast-tooltip',
          opacity: 1,
        });
      }

      lyr.bindPopup(buildPopup({
        header: 'Forecast',
        subheader: [hhmm, leadHint].filter(Boolean).join(' · ') || undefined,
        minWidth: 220,
        facts: [
          { label: 'Temperature', value: tempValue },
          { label: 'Wind', value: windValue, hint: gustHint },
          { label: 'Conditions', value: condValue },
        ],
        tactical,
        details: {
          facts: [
            { label: 'Wind direction', value: Number.isFinite(windDeg) ? `${Math.round(windDeg)}°` : undefined },
            { label: 'Wind gust', value: Number.isFinite(gustMs) ? `${gustMs.toFixed(1)} m/s` : undefined },
            { label: 'Low cloud', value: Number.isFinite(lowCloud) ? `${Math.round(lowCloud)}%` : undefined },
            { label: 'Ceiling', value: Number.isFinite(ceilM) ? `${Math.round(ceilM)} m` : undefined },
            { label: 'Visibility', value: Number.isFinite(visM) ? `${(visM / 1000).toFixed(1)} km` : undefined },
            { label: 'Humidity', value: Number.isFinite(humidity) ? `${Math.round(humidity)}%` : undefined },
            { label: 'Precipitation', value: Number.isFinite(precip) ? `${precip.toFixed(2)} mm/h` : undefined },
            { label: 'Aviation', value: aviation || undefined },
            { label: 'Time (UTC)', value: time || undefined },
          ],
        },
      }));
      return;
    }

    if (layer === 'mml') {
      const p = props as Record<string, unknown>;
      const tt = String(p.terrain_type ?? '').toLowerCase();
      const pass = String(p.passability ?? '').toLowerCase();

      // Terrain type → emoji + display label.
      const terrainMeta: Record<string, { emoji: string; label: string }> = {
        swamp:   { emoji: '🟫', label: 'Swamp' },
        lake:    { emoji: '🟦', label: 'Lake' },
        river:   { emoji: '🟦', label: 'River' },
        sea:     { emoji: '🌊', label: 'Sea' },
        bedrock: { emoji: '⛰', label: 'Bedrock' },
        sand:    { emoji: '🟨', label: 'Sand / gravel' },
      };
      const meta = terrainMeta[tt] ?? { emoji: '🟩', label: tt ? tt.charAt(0).toUpperCase() + tt.slice(1) : 'Terrain' };

      // Passability colour for the header chip.
      const passColor: Record<string, string> = {
        impassable: '#dc2626',
        obstacle:   '#f59e0b',
        slow:       '#eab308',
      };

      // Tactical implication per terrain × passability.
      const tacticalMap: Record<string, string> = {
        swamp:   'Bog — impassable for vehicles, partial concealment',
        lake:    'Water barrier — no crossing',
        river:   'Water — crossing point required',
        sea:     'Water barrier — no crossing',
        bedrock: 'Elevated hard ground — limited cover, defensible',
        sand:    'Soft going — reduced mobility, poor footing',
      };
      const tactical = tacticalMap[tt];

      // alkupvm = survey/update date (ISO date string from MML).
      const surveyed = p.alkupvm ? String(p.alkupvm) : undefined;

      // sijaintitarkkuus = location accuracy in mm.
      const accuracyMm = Number(p.sijaintitarkkuus ?? NaN);
      const accuracyM = Number.isFinite(accuracyMm) ? accuracyMm / 1000 : NaN;

      // keskikorkeus = mean elevation. Unit varies by feature class (m for
      // terrain, cm for water surfaces) so we render it raw and label as such.
      const meanHeightRaw = p.keskikorkeus;
      const meanHeight = (meanHeightRaw !== null && meanHeightRaw !== undefined && meanHeightRaw !== '')
        ? `${meanHeightRaw}`
        : undefined;

      lyr.bindPopup(buildPopup({
        header: `${meta.emoji} ${meta.label}`,
        headerChip: pass && passColor[pass]
          ? { text: pass, color: passColor[pass] }
          : undefined,
        minWidth: 220,
        facts: [
          { label: 'Surveyed', value: surveyed },
        ],
        tactical,
        details: {
          facts: [
            { label: 'Mean height', value: meanHeight, hint: 'MML raw value' },
            { label: 'Location accuracy', value: Number.isFinite(accuracyM) ? `± ${accuracyM.toFixed(1)} m` : undefined },
            { label: 'MML ID', value: p.mtk_id ? String(p.mtk_id) : undefined },
            { label: 'Class code', value: p.kohdeluokka != null ? String(p.kohdeluokka) : undefined },
          ],
        },
      }));
      return;
    }

    if (layer === 'statfin') {
      const p = props as Record<string, unknown>;
      const nameFi = p.nimi ? String(p.nimi) : '';
      const nameSv = p.namn ? String(p.namn) : '';
      const header = nameFi || nameSv || `Postinumero ${p.kunta ?? ''}`;
      const subParts: string[] = [];
      if (nameFi && nameSv && nameFi !== nameSv) subParts.push(nameSv);
      if (p.kunta_nimi) subParts.push(`${p.kunta_nimi} (${p.kunta ?? '—'})`);
      else if (p.kunta) subParts.push(`Kunta ${p.kunta}`);
      const areaM2 = Number(p.pinta_ala ?? 0);
      if (areaM2 > 0) subParts.push(`${(areaM2 / 1_000_000).toFixed(1)} km²`);

      const pop = Number(p.he_vakiy ?? NaN);
      const men = Number(p.he_miehet ?? NaN);
      const women = Number(p.he_naiset ?? NaN);
      const meanAge = Number(p.he_kika ?? NaN);
      const age0_14 = Number(p.he_0_14 ?? NaN);
      const workingAge = Number(p.he_15_64 ?? NaN);
      const age65 = Number(p.he_65_ ?? NaN);
      const employed = Number(p.pt_tyolli ?? NaN);
      const unemployed = Number(p.pt_tyott ?? NaN);
      const labourForce = Number.isFinite(employed) && Number.isFinite(unemployed)
        ? employed + unemployed
        : NaN;
      const income = Number(p.tr_ktu ?? NaN);
      const dwellings = Number(p.ra_asunn ?? NaN);

      // Qualitative tier only — the underlying numbers live behind "Show all".
      let tactical: string | undefined;
      if (Number.isFinite(pop)) {
        const tier = pop < 500 ? 'hamlet' : pop < 5000 ? 'village' : pop < 50000 ? 'town' : 'urban';
        tactical = `${tier} — civilian considerations & recruiting/billeting pool`;
      }

      const popVal = Number.isFinite(pop) ? fmtInt(pop) : undefined;
      const fmt = (v: number) => (Number.isFinite(v) ? fmtInt(v) : undefined);
      const fmtEuro = (v: number) => (Number.isFinite(v) ? `€${fmtInt(v)}` : undefined);

      lyr.bindPopup(buildPopup({
        header,
        subheader: subParts.join(' · ') || undefined,
        minWidth: 220,
        facts: [
          { label: 'Population', value: popVal },
        ],
        tactical,
        details: {
          facts: [
            { label: 'Men', value: fmt(men),
              hint: Number.isFinite(men) && Number.isFinite(pop) ? fmtPct(men, pop) : undefined },
            { label: 'Women', value: fmt(women),
              hint: Number.isFinite(women) && Number.isFinite(pop) ? fmtPct(women, pop) : undefined },
            { label: 'Mean age', value: Number.isFinite(meanAge) ? `${meanAge.toFixed(0)}` : undefined },
            { label: 'Ages 0-14', value: fmt(age0_14),
              hint: Number.isFinite(age0_14) && Number.isFinite(pop) ? fmtPct(age0_14, pop) : undefined },
            { label: 'Working age (15-64)', value: fmt(workingAge),
              hint: Number.isFinite(workingAge) && Number.isFinite(pop) ? fmtPct(workingAge, pop) : undefined },
            { label: 'Ages 65+', value: fmt(age65),
              hint: Number.isFinite(age65) && Number.isFinite(pop) ? fmtPct(age65, pop) : undefined },
            { label: 'Employed', value: fmt(employed) },
            { label: 'Unemployed', value: fmt(unemployed),
              hint: Number.isFinite(unemployed) && Number.isFinite(labourForce) && labourForce > 0
                ? fmtPct(unemployed, labourForce) : undefined },
            { label: 'Median income', value: fmtEuro(income) },
            { label: 'Dwellings', value: fmt(dwellings) },
          ],
        },
      }));
      return;
    }

    const entries = Object.entries(props)
      .filter(([k]) => k !== 'source')
      .slice(0, 10);
    if (!entries.length) return;
    const html = entries
      .map(
        ([k, v]) =>
          `<div><span style="color:#64748b">${k}</span>: <strong>${formatValue(v)}</strong></div>`,
      )
      .join('');
    lyr.bindPopup(`<div style="font-size:11px;line-height:1.4">${html}</div>`);
  };

  return { style, pointToLayer, onEachFeature };
}
