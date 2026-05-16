/**
 * RulerControl — click-drag distance measurement for Leaflet.
 *
 * Visually identical to an arrow but with a permanent label showing
 * the great-circle distance (meters / kilometers) between the two
 * endpoints. The arrow stays on the map; clicking it in delete mode
 * removes it like any other drawn feature.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useDrawnStore, useTacticalStore } from '../store';
import type { DrawnFeature } from '../api/types';

const RULER_COLOR = '#fbbf24'; // amber — distinct from red arrows
const SHAFT_WEIGHT = 3;
const HEAD_LEN = 22;
const HEAD_WID = 13;

function formatDistance(m: number): string {
  if (m >= 10000) return `${(m / 1000).toFixed(1)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function arrowheadPoints(
  map: L.Map,
  from: L.LatLng,
  to: L.LatLng,
  headLen: number,
  headWid: number,
): L.LatLng[] {
  const pFrom = map.latLngToContainerPoint(from);
  const pTo = map.latLngToContainerPoint(to);
  const dx = pTo.x - pFrom.x;
  const dy = pTo.y - pFrom.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return [];
  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy;
  const py = ux;
  const baseCx = pTo.x - headLen * ux;
  const baseCy = pTo.y - headLen * uy;
  const half = headWid / 2;
  const left = L.point(baseCx + half * px, baseCy + half * py);
  const right = L.point(baseCx - half * px, baseCy - half * py);
  return [
    map.containerPointToLatLng(pTo),
    map.containerPointToLatLng(left),
    map.containerPointToLatLng(right),
  ];
}

function makeLabelIcon(text: string): L.DivIcon {
  return L.divIcon({
    className: 'ruler-label',
    html:
      `<div style="background:#131313;border:1px solid ${RULER_COLOR};` +
      `color:${RULER_COLOR};font-family:ui-monospace,monospace;font-size:11px;` +
      `font-weight:600;padding:2px 6px;border-radius:2px;white-space:nowrap;` +
      `letter-spacing:0.04em;box-shadow:0 2px 6px rgba(0,0,0,0.6);transform:translate(-50%,-50%);">` +
      `${text}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

interface RulerEntry {
  id: string;
  start: L.LatLng;
  end: L.LatLng;
  shaft: L.Polyline;
  head: L.Polygon;
  label: L.Marker;
  group: L.LayerGroup;
}

export default function RulerControl() {
  const map = useMap();
  const isRulerMode = useTacticalStore((s) => s.activeTool === 'ruler');
  const isDeleteMode = useTacticalStore((s) => s.isDeleteMode);
  const setActiveTool = useTacticalStore((s) => s.setActiveTool);

  const rulersRef = useRef<Map<string, RulerEntry>>(new Map());
  const ghostRef = useRef<{ shaft: L.Polyline; head: L.Polygon; label: L.Marker } | null>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<L.LatLng | null>(null);
  const modeRef = useRef(isRulerMode);
  const deleteModeRef = useRef(isDeleteMode);

  modeRef.current = isRulerMode;
  deleteModeRef.current = isDeleteMode;

  // Cursor + cleanup when leaving mode mid-draw
  useEffect(() => {
    const container = map.getContainer();
    if (isRulerMode) {
      container.style.cursor = 'crosshair';
    } else {
      if (drawingRef.current) {
        drawingRef.current = false;
        startRef.current = null;
        if (ghostRef.current) {
          ghostRef.current.shaft.remove();
          ghostRef.current.head.remove();
          ghostRef.current.label.remove();
          ghostRef.current = null;
        }
        map.dragging.enable();
      }
      // Don't blank cursor if another tool set it
      if (container.style.cursor === 'crosshair') container.style.cursor = '';
    }
  }, [isRulerMode, map]);

  // Recompute arrowheads on zoom
  useEffect(() => {
    function onZoomEnd() {
      rulersRef.current.forEach((entry) => {
        const pts = arrowheadPoints(map, entry.start, entry.end, HEAD_LEN, HEAD_WID);
        if (pts.length) entry.head.setLatLngs(pts);
      });
    }
    map.on('zoomend', onZoomEnd);
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map]);

  // Sync deletions from store
  useEffect(() => {
    return useDrawnStore.subscribe((state, prev) => {
      const prevIds = new Set(
        prev.features
          .filter((f) => f.properties?.feature_type === 'RULER')
          .map((f) => String(f.id)),
      );
      const currIds = new Set(
        state.features
          .filter((f) => f.properties?.feature_type === 'RULER')
          .map((f) => String(f.id)),
      );
      prevIds.forEach((id) => {
        if (!currIds.has(id)) {
          const entry = rulersRef.current.get(id);
          if (entry) {
            entry.group.remove();
            rulersRef.current.delete(id);
          }
        }
      });
      if (state.features.length === 0 && prev.features.length > 0) {
        rulersRef.current.forEach((e) => e.group.remove());
        rulersRef.current.clear();
      }
    });
  }, []);

  // Draw handlers
  useEffect(() => {
    const container = map.getContainer();

    function getLatLng(clientX: number, clientY: number): L.LatLng {
      const rect = container.getBoundingClientRect();
      return map.containerPointToLatLng(
        L.point(clientX - rect.left, clientY - rect.top),
      );
    }

    function removeGhost() {
      if (ghostRef.current) {
        ghostRef.current.shaft.remove();
        ghostRef.current.head.remove();
        ghostRef.current.label.remove();
        ghostRef.current = null;
      }
    }

    function onMouseDown(e: MouseEvent) {
      if (deleteModeRef.current) return;
      if (!modeRef.current) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      startRef.current = getLatLng(e.clientX, e.clientY);
      drawingRef.current = true;
      map.dragging.disable();

      const ghostShaft = L.polyline([startRef.current, startRef.current], {
        color: RULER_COLOR,
        weight: SHAFT_WEIGHT,
        lineCap: 'round',
        interactive: false,
        opacity: 0.75,
        dashArray: '6 4',
      }).addTo(map);
      const ghostHead = L.polygon([], {
        color: RULER_COLOR,
        fillColor: RULER_COLOR,
        fillOpacity: 0.75,
        weight: 0,
        interactive: false,
      }).addTo(map);
      const ghostLabel = L.marker(startRef.current, {
        icon: makeLabelIcon('0 m'),
        interactive: false,
        keyboard: false,
      }).addTo(map);
      ghostRef.current = { shaft: ghostShaft, head: ghostHead, label: ghostLabel };
    }

    function onMouseMove(e: MouseEvent) {
      if (!drawingRef.current || !startRef.current || !ghostRef.current) return;
      const end = getLatLng(e.clientX, e.clientY);
      ghostRef.current.shaft.setLatLngs([startRef.current, end]);
      const pts = arrowheadPoints(map, startRef.current, end, HEAD_LEN, HEAD_WID);
      if (pts.length) ghostRef.current.head.setLatLngs(pts);
      const meters = startRef.current.distanceTo(end);
      const midLat = (startRef.current.lat + end.lat) / 2;
      const midLng = (startRef.current.lng + end.lng) / 2;
      ghostRef.current.label.setLatLng([midLat, midLng]);
      ghostRef.current.label.setIcon(makeLabelIcon(formatDistance(meters)));
    }

    function onMouseUp(e: MouseEvent) {
      if (!drawingRef.current || !startRef.current) return;
      drawingRef.current = false;
      map.dragging.enable();

      const end = getLatLng(e.clientX, e.clientY);
      const start = startRef.current;
      startRef.current = null;
      removeGhost();

      const pStart = map.latLngToContainerPoint(start);
      const pEnd = map.latLngToContainerPoint(end);
      const pixDist = Math.sqrt((pEnd.x - pStart.x) ** 2 + (pEnd.y - pStart.y) ** 2);
      if (pixDist < 8) return;

      const meters = start.distanceTo(end);
      const id = `ruler-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      const shaft = L.polyline([start, end], {
        color: RULER_COLOR,
        weight: SHAFT_WEIGHT,
        lineCap: 'round',
        interactive: true,
      });
      const headPts = arrowheadPoints(map, start, end, HEAD_LEN, HEAD_WID);
      const head = L.polygon(headPts.length ? headPts : [start], {
        color: RULER_COLOR,
        fillColor: RULER_COLOR,
        fillOpacity: 1,
        weight: 0,
        interactive: true,
      });
      const midLat = (start.lat + end.lat) / 2;
      const midLng = (start.lng + end.lng) / 2;
      const label = L.marker([midLat, midLng], {
        icon: makeLabelIcon(formatDistance(meters)),
        interactive: true,
        keyboard: false,
      });

      const group = L.layerGroup([shaft, head, label]);

      const onClick = (ev: L.LeafletEvent) => {
        L.DomEvent.stop(ev as L.LeafletMouseEvent);
        if (deleteModeRef.current) {
          useDrawnStore.getState().removeFeature(id);
        }
      };
      shaft.on('click', onClick);
      head.on('click', onClick);
      label.on('click', onClick);

      group.addTo(map);

      rulersRef.current.set(id, { id, start, end, shaft, head, label, group });

      const feature: DrawnFeature = {
        type: 'Feature',
        id,
        geometry: {
          type: 'LineString',
          coordinates: [
            [start.lng, start.lat],
            [end.lng, end.lat],
          ],
        },
        properties: {
          feature_type: 'RULER',
          color: RULER_COLOR,
          distance_m: Math.round(meters),
        },
      };
      useDrawnStore.getState().addFeature(feature);
    }

    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [map]);

  // Escape exits ruler mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && modeRef.current) {
        setActiveTool(null);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setActiveTool]);

  return null;
}
