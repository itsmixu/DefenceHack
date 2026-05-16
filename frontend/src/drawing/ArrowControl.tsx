/**
 * ArrowControl — click-drag arrow drawing for Leaflet.
 *
 * Design:
 *   • Rendered inside <MapContainer> so useMap() works.
 *   • When isArrowMode is true, captures mousedown on the map → starts drawing.
 *   • During drag: live ghost arrow (shaft polyline + arrowhead polygon) follows the cursor.
 *   • On mouseup: ghost is replaced by a permanent arrow; stored in useDrawnStore.
 *   • Arrowhead is computed in PIXEL SPACE then converted back to LatLng, so it
 *     always looks correct regardless of latitude or zoom level.
 *   • On zoomend: all arrowheads are recomputed so they stay the right pixel size.
 *   • Subscribes to useDrawnStore to remove Leaflet layers when DrawnList deletes an arrow.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useDrawnStore, useTacticalStore } from '../store';
import type { DrawnFeature } from '../api/types';

// ── Size table ────────────────────────────────────────────────────────────────
// [lineWeight (px), headLength (px), headWidth (px)]
const SIZE_TABLE: [number, number, number][] = [
  [1.5, 10, 6],
  [2,   15, 9],
  [3,   22, 13],
  [4.5, 32, 19],
  [7,   46, 28],
];

function sizeParams(size: number): [number, number, number] {
  return SIZE_TABLE[Math.min(Math.max(size - 1, 0), SIZE_TABLE.length - 1)];
}

// ── Arrowhead geometry ────────────────────────────────────────────────────────

function arrowheadPoints(
  map: L.Map,
  from: L.LatLng,
  to: L.LatLng,
  headLen: number,
  headWid: number,
): L.LatLng[] {
  const pFrom = map.latLngToContainerPoint(from);
  const pTo   = map.latLngToContainerPoint(to);
  const dx = pTo.x - pFrom.x;
  const dy = pTo.y - pFrom.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return [];

  // Unit direction vector (shaft direction)
  const ux = dx / dist;
  const uy = dy / dist;
  // Perpendicular
  const px = -uy;
  const py =  ux;

  // Tip of arrowhead = pTo
  // Base centre = pTo - headLen * unit
  const baseCx = pTo.x - headLen * ux;
  const baseCy = pTo.y - headLen * uy;

  // Left and right base corners
  const half = headWid / 2;
  const left  = L.point(baseCx + half * px, baseCy + half * py);
  const right = L.point(baseCx - half * px, baseCy - half * py);

  return [
    map.containerPointToLatLng(pTo),
    map.containerPointToLatLng(left),
    map.containerPointToLatLng(right),
  ];
}

// ── Arrow entry tracking ──────────────────────────────────────────────────────

interface ArrowEntry {
  id: string;
  startLatLng: L.LatLng;
  endLatLng: L.LatLng;
  color: string;
  weight: number;
  headLen: number;
  headWid: number;
  shaft: L.Polyline;
  head: L.Polygon;
  group: L.LayerGroup;
}

function makeArrowLayers(
  map: L.Map,
  start: L.LatLng,
  end: L.LatLng,
  color: string,
  weight: number,
  headLen: number,
  headWid: number,
  interactive: boolean,
): { shaft: L.Polyline; head: L.Polygon; group: L.LayerGroup } {
  const shaft = L.polyline([start, end], {
    color, weight,
    lineCap: 'round',
    interactive,
  });

  const headPts = arrowheadPoints(map, start, end, headLen, headWid);
  const head = L.polygon(headPts.length ? headPts : [start], {
    color,
    fillColor: color,
    fillOpacity: 1,
    weight: 0,
    interactive,
  });

  const group = L.layerGroup([shaft, head]);
  return { shaft, head, group };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ArrowControl() {
  const map = useMap();

  const isArrowMode = useTacticalStore((s) => s.isArrowMode);
  const arrowColor  = useTacticalStore((s) => s.arrowColor);
  const arrowSize   = useTacticalStore((s) => s.arrowSize);
  const setArrowMode = useTacticalStore((s) => s.setArrowMode);

  // All arrow entries indexed by id — lives as a ref so Leaflet callbacks see latest
  const arrowsRef   = useRef<Map<string, ArrowEntry>>(new Map());
  // Ghost layers shown while dragging
  const ghostRef    = useRef<{ shaft: L.Polyline; head: L.Polygon } | null>(null);
  const drawingRef  = useRef(false);
  const startRef    = useRef<L.LatLng | null>(null);
  const colorRef    = useRef(arrowColor);
  const sizeRef     = useRef(arrowSize);
  const modeRef     = useRef(isArrowMode);

  // Keep refs in sync with latest Zustand values without re-creating handlers
  colorRef.current = arrowColor;
  sizeRef.current  = arrowSize;
  modeRef.current  = isArrowMode;

  // ── Cursor management ──────────────────────────────────────────────────────
  useEffect(() => {
    const container = map.getContainer();
    if (isArrowMode) {
      container.style.cursor = 'crosshair';
    } else {
      container.style.cursor = '';
      // If we abort while mid-draw, clean up ghost
      if (drawingRef.current) {
        drawingRef.current = false;
        startRef.current = null;
        if (ghostRef.current) {
          ghostRef.current.shaft.remove();
          ghostRef.current.head.remove();
          ghostRef.current = null;
        }
        map.dragging.enable();
      }
    }
  }, [isArrowMode, map]);

  // ── Zoom recompute ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onZoomEnd() {
      arrowsRef.current.forEach((entry) => {
        const pts = arrowheadPoints(map, entry.startLatLng, entry.endLatLng, entry.headLen, entry.headWid);
        if (pts.length) entry.head.setLatLngs(pts);
      });
    }
    map.on('zoomend', onZoomEnd);
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map]);

  // ── Sync deletions from DrawnList ──────────────────────────────────────────
  useEffect(() => {
    return useDrawnStore.subscribe((state, prev) => {
      const prevIds = new Set(
        prev.features
          .filter((f) => f.properties?.feature_type === 'ARROW')
          .map((f) => String(f.id)),
      );
      const currIds = new Set(
        state.features
          .filter((f) => f.properties?.feature_type === 'ARROW')
          .map((f) => String(f.id)),
      );
      // Remove Leaflet layers for any arrow deleted from store
      prevIds.forEach((id) => {
        if (!currIds.has(id)) {
          const entry = arrowsRef.current.get(id);
          if (entry) {
            entry.group.remove();
            arrowsRef.current.delete(id);
          }
        }
      });
      // If all features cleared, wipe everything
      if (state.features.length === 0 && prev.features.length > 0) {
        arrowsRef.current.forEach((e) => e.group.remove());
        arrowsRef.current.clear();
      }
    });
  }, []);

  // ── Main draw handlers ─────────────────────────────────────────────────────
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
        ghostRef.current = null;
      }
    }

    function onMouseDown(e: MouseEvent) {
      if (!modeRef.current) return;
      // Only left button
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();

      startRef.current = getLatLng(e.clientX, e.clientY);
      drawingRef.current = true;
      map.dragging.disable();

      // Create ghost layers
      const [weight, headLen, headWid] = sizeParams(sizeRef.current);
      const ghostShaft = L.polyline([startRef.current, startRef.current], {
        color: colorRef.current, weight,
        lineCap: 'round', interactive: false, opacity: 0.65,
      }).addTo(map);
      const ghostHead = L.polygon([], {
        color: colorRef.current,
        fillColor: colorRef.current,
        fillOpacity: 0.65,
        weight: 0, interactive: false,
      }).addTo(map);
      ghostRef.current = { shaft: ghostShaft, head: ghostHead };
    }

    function onMouseMove(e: MouseEvent) {
      if (!drawingRef.current || !startRef.current || !ghostRef.current) return;
      const end = getLatLng(e.clientX, e.clientY);
      const [weight, headLen, headWid] = sizeParams(sizeRef.current);

      ghostRef.current.shaft.setLatLngs([startRef.current, end]);
      const pts = arrowheadPoints(map, startRef.current, end, headLen, headWid);
      if (pts.length) ghostRef.current.head.setLatLngs(pts);
    }

    function onMouseUp(e: MouseEvent) {
      if (!drawingRef.current || !startRef.current) return;
      drawingRef.current = false;
      map.dragging.enable();

      const end = getLatLng(e.clientX, e.clientY);
      const start = startRef.current;
      startRef.current = null;
      removeGhost();

      // Reject zero-length arrows (just a click with no drag)
      const pStart = map.latLngToContainerPoint(start);
      const pEnd   = map.latLngToContainerPoint(end);
      const dist = Math.sqrt((pEnd.x - pStart.x) ** 2 + (pEnd.y - pStart.y) ** 2);
      if (dist < 8) return;

      const [weight, headLen, headWid] = sizeParams(sizeRef.current);
      const color = colorRef.current;
      const id = `arrow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      // Build permanent arrow
      const { shaft, head, group } = makeArrowLayers(
        map, start, end, color, weight, headLen, headWid, true,
      );

      // Click on arrow → show "click to delete" popup
      group.on('click', () => {
        const popup = L.popup({ closeButton: true, className: 'arrow-popup' })
          .setLatLng(end)
          .setContent(
            `<div style="font-size:11px;line-height:1.6">
              <strong>Arrow</strong>
              <div style="margin-top:4px">
                <button id="del-${id}" style="background:#ef4444;color:#fff;border:none;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:10px">Delete</button>
              </div>
            </div>`,
          )
          .openOn(map);
        // Wire delete button after popup mounts
        setTimeout(() => {
          document.getElementById(`del-${id}`)?.addEventListener('click', () => {
            map.closePopup(popup);
            useDrawnStore.getState().removeFeature(id);
          });
        }, 0);
      });

      group.addTo(map);

      const entry: ArrowEntry = {
        id, startLatLng: start, endLatLng: end,
        color, weight, headLen, headWid,
        shaft, head, group,
      };
      arrowsRef.current.set(id, entry);

      // Persist to drawn store as a LineString feature
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
          feature_type: 'ARROW',
          color,
          weight,
          head_len_px: headLen,
          head_wid_px: headWid,
          size: sizeRef.current,
        },
      };
      useDrawnStore.getState().addFeature(feature);

      // Stay in arrow mode so user can keep drawing
    }

    // Use container-level listeners so we capture events even when mouse
    // moves outside the map during a drag.
    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [map]); // only re-run if map changes; color/size/mode read via refs

  // ── Escape key exits arrow mode ────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && modeRef.current) {
        setArrowMode(false);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setArrowMode]);

  return null;
}
