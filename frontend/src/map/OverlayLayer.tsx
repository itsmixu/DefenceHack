/**
 * OverlayLayer — read-only visualisation of subordinate units' drawn features.
 *
 * Reads the overlay tab set from useOpenFilesStore and renders each
 * subordinate's drawn features on top of the active map in a dimmed,
 * unit-coloured style. Features are non-interactive: clicks pass through.
 *
 * The styling rule: each overlay unit gets a single accent colour derived
 * from its rank (so a battalion sees its three companies in three distinct
 * tints rather than every shape blending together). Polygons/lines render
 * with that colour at reduced opacity and a dashed stroke; symbols render
 * with their NATO milsymbol SVG at reduced size; arrows render as a styled
 * polyline (no arrowhead polygon — it's pixel-space and would be expensive
 * to recompute on zoom for read-only overlays).
 *
 * To merge an overlay into the live map permanently, use
 * `useOpenFilesStore.mergeOverlayIntoActivePhase()` from the panel UI.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import type { Feature, Geometry, Position } from 'geojson';
import {
  selectOverlayDrawnLayers,
  useOpenFilesStore,
  type OverlayDrawnLayer,
  type OpenFileTab,
} from '../store';
import type { DrawnFeature } from '../api/types';

/** Distinct accent colours for up to ~6 simultaneous overlays. */
const UNIT_PALETTE = [
  '#22d3ee', // cyan
  '#a855f7', // violet
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ec4899', // pink
  '#60a5fa', // sky
];

function colourForTab(tabId: string, index: number): string {
  // Pick from the palette by insertion index so distinct tabs stay distinct
  // across re-renders even if the IDs are random.
  return UNIT_PALETTE[index % UNIT_PALETTE.length];
}

/** Build a tooltip line: "1 Plt · LT Park · Platoon". */
function describeTab(t: OverlayDrawnLayer | OpenFileTab): string {
  const parts: string[] = [];
  if ('unit' in t && t.unit) parts.push(t.unit);
  if ('commanderName' in t && t.commanderName) parts.push(t.commanderName);
  if ('tabName' in t) parts.push(t.tabName);
  else if ('name' in t) parts.push(t.name);
  return parts.join(' · ');
}

/** A leaflet renderer for a single overlay feature. */
function buildLayerForFeature(
  feature: DrawnFeature,
  color: string,
  unitLabel: string,
): L.Layer | null {
  const geom: Geometry | undefined = feature.geometry;
  if (!geom) return null;

  const baseStyle: L.PathOptions = {
    color,
    weight: 2,
    opacity: 0.7,
    fillColor: color,
    fillOpacity: 0.12,
    dashArray: '5 4',
    interactive: false,
  };

  if (geom.type === 'Polygon') {
    const coords = (geom.coordinates as Position[][]).map((ring) =>
      ring.map(([lng, lat]) => L.latLng(lat, lng)),
    );
    return L.polygon(coords, baseStyle);
  }

  if (geom.type === 'LineString') {
    const ft = String(feature.properties?.feature_type ?? '');
    const isArrow = ft === 'ARROW';
    const coords = (geom.coordinates as Position[]).map(([lng, lat]) =>
      L.latLng(lat, lng),
    );
    return L.polyline(coords, {
      ...baseStyle,
      fill: false,
      dashArray: isArrow ? undefined : '5 4',
      weight: isArrow ? 3 : 2,
    });
  }

  if (geom.type === 'Point') {
    const [lng, lat] = geom.coordinates as Position;
    const props = feature.properties ?? {};
    const ft = String(props.feature_type ?? '');

    // Milsymbol SYMBOL points
    if (ft === 'SYMBOL') {
      const sidc = String(props.sidc ?? 'SFGPUCI----D---');
      const label = props.customName ? String(props.customName) : undefined;
      try {
        const options: Record<string, unknown> = {
          size: 32, frame: true, fill: true, infoFields: false,
        };
        if (label) options.uniqueDesignation = label;
        const sym = new ms.Symbol(sidc, options);
        const svg = sym.asSVG();
        const { width, height } = sym.getSize();
        const anchor = sym.getAnchor();
        const icon = L.divIcon({
          className: 'overlay-symbol-icon',
          html: `<div style="opacity:0.55;filter:drop-shadow(0 0 4px ${color}aa)">${svg}</div>`,
          iconSize: [width, height],
          iconAnchor: [anchor.x, anchor.y],
        });
        return L.marker([lat, lng], { icon, interactive: false, keyboard: false });
      } catch {
        /* fall through to plain dot */
      }
    }

    // Generic Point — small coloured dot
    return L.circleMarker([lat, lng], {
      ...baseStyle,
      radius: 5,
      fillOpacity: 0.55,
    });
  }

  return null;
}

interface RenderedOverlay {
  tabId: string;
  group: L.LayerGroup;
}

export default function OverlayLayer() {
  const map = useMap();
  const renderedRef = useRef<RenderedOverlay[]>([]);

  // Subscribe to the open-files store. Whenever overlay set OR any open tab's
  // drawn features change, rebuild the rendered overlay groups.
  useEffect(() => {
    function render() {
      // Tear down previous overlay groups
      for (const r of renderedRef.current) {
        r.group.removeFrom(map);
      }
      renderedRef.current = [];

      const state = useOpenFilesStore.getState();
      const layers = selectOverlayDrawnLayers(state);

      layers.forEach((layer, idx) => {
        const color = colourForTab(layer.tabId, idx);
        const unitLabel = describeTab(layer);

        const group = L.layerGroup();
        for (const feature of layer.features) {
          const sub = buildLayerForFeature(feature, color, unitLabel);
          if (!sub) continue;
          // Attach a tooltip with provenance
          if ('bindTooltip' in sub && typeof (sub as L.Layer & { bindTooltip?: unknown }).bindTooltip === 'function') {
            (sub as L.Path).bindTooltip(unitLabel, {
              direction: 'top',
              opacity: 0.9,
              className: 'overlay-tooltip',
              sticky: true,
            });
          }
          sub.addTo(group);
        }
        group.addTo(map);
        renderedRef.current.push({ tabId: layer.tabId, group });
      });
    }

    render();
    const unsub = useOpenFilesStore.subscribe(render);
    return () => {
      unsub();
      for (const r of renderedRef.current) r.group.removeFrom(map);
      renderedRef.current = [];
    };
  }, [map]);

  return null;
}
