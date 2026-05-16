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
  opencellid: '#3b82f6',
  n2yo: '#9333ea',
  exposure: '#dc2626',
  mcoo: '#16a34a',
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
      color = '#3b82f6';
      radius = 4;
    } else if (layer === 'n2yo') {
      const cat = String(p.category ?? '');
      if (cat === 'earth_observation') color = '#a855f7';
      else if (cat === 'weather') color = '#06b6d4';
      else color = '#6b7280';
      radius = 6;
    }

    return L.circleMarker(latlng, {
      radius,
      color,
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.7,
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
