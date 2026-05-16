import L from 'leaflet';
import type { GeoJSONOptions, PathOptions, StyleFunction } from 'leaflet';
import type { LayerKey } from '../api/types';
import { getOsmPoiMeta } from './osmPoi';

const baseColorByLayer: Record<LayerKey, string> = {
  osm: '#ef4444',
  digiroad: '#6b7280',
  mml: '#16a34a',
  mml_contours: '#92400e',
  statfin: '#a855f7',
  fmi: '#0ea5e9',
  fmi_forecast: '#38bdf8',
  opencellid: '#3b82f6',
  n2yo: '#9333ea',
  exposure: '#dc2626',
  mcoo: '#16a34a',
  syke: '#2563eb',
  astronomy: '#fbbf24',
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

export function getStyleForLayer(layer: LayerKey): GeoJSONOptions {
  const baseColor = baseColorByLayer[layer];

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
        const pop = Number(p.population ?? 0);
        const area = Number(p.area_km2 ?? 1);
        const density = pop / Math.max(area, 0.0001);
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
      case 'n2yo': {
        // Footprint polygon for satellites — very faint, just shows the visibility horizon.
        const cat = String(p.category ?? '');
        opts.color = cat === 'earth_observation' ? '#a855f7' : '#06b6d4';
        opts.fillColor = opts.color;
        opts.fillOpacity = 0.05;
        opts.weight = 1;
        opts.dashArray = '4 6';
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
        // Forecast point-in-time features — semi-transparent, light blue.
        opts.color = '#38bdf8';
        opts.fillColor = '#38bdf8';
        opts.fillOpacity = 0.15;
        opts.weight = 1;
        opts.dashArray = '4 4';
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
      const marker = L.divIcon({
        className: '',
        html: `<div style="width:20px;height:20px;border-radius:9999px;background:#fff;border:2px solid ${iconColor};display:flex;align-items:center;justify-content:center;font-size:12px;line-height:1">${icon}</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
        popupAnchor: [0, -10],
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
    } else if (layer === 'n2yo') {
      const cat = String(p.category ?? '');
      if (cat === 'earth_observation') color = '#a855f7';
      else if (cat === 'weather') color = '#06b6d4';
      else color = '#6b7280';
      radius = 7;
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
      radius,
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

    if (layer === 'n2yo' && props.feature_type === 'position') {
      const cat = String(props.category ?? '');
      const catLabel = cat === 'earth_observation' ? '🛰 Earth Observation' : cat === 'weather' ? '🌦 Weather' : '🛰 Satellite';
      const alt = props.altitude_km != null ? `${Number(props.altitude_km).toFixed(0)} km` : '—';
      const fp = props.footprint_radius_km != null ? `~${Number(props.footprint_radius_km).toFixed(0)} km` : '—';
      lyr.bindPopup(`
        <div style="font-size:11px;line-height:1.6;min-width:160px">
          <div style="font-weight:700;margin-bottom:4px">${catLabel}</div>
          <div><span style="color:#64748b">Name</span>: <strong>${props.satname ?? '—'}</strong></div>
          <div><span style="color:#64748b">Altitude</span>: <strong>${alt}</strong></div>
          <div><span style="color:#64748b">Footprint radius</span>: <strong>${fp}</strong></div>
          ${props.cospar_id ? `<div><span style="color:#64748b">COSPAR</span>: <strong>${props.cospar_id}</strong></div>` : ''}
          ${props.launch_date ? `<div><span style="color:#64748b">Launched</span>: <strong>${props.launch_date}</strong></div>` : ''}
          <div style="margin-top:4px;color:#94a3b8;font-size:10px">Footprint = visibility horizon. Imaging swath is narrower.</div>
        </div>
      `);
      return;
    }

    if (layer === 'n2yo') return;

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

    if (layer === 'fmi_forecast') {
      const p = props as Record<string, unknown>;
      lyr.bindPopup(`
        <div style="font-size:11px;line-height:1.6;min-width:160px">
          <div style="font-weight:700;margin-bottom:2px">Forecast — ${p.time ?? ''}</div>
          ${p.temperature != null ? `<div><span style="color:#64748b">Temp</span>: <strong>${p.temperature}°C</strong></div>` : ''}
          ${p.windspeedms != null ? `<div><span style="color:#64748b">Wind</span>: <strong>${p.windspeedms} m/s</strong></div>` : ''}
          ${p.totalcloudcover != null ? `<div><span style="color:#64748b">Cloud</span>: <strong>${p.totalcloudcover}%</strong></div>` : ''}
          ${p.precipitation1h != null ? `<div><span style="color:#64748b">Precip</span>: <strong>${p.precipitation1h} mm/h</strong></div>` : ''}
        </div>
      `);
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
