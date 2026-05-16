/**
 * SymbolControl — places NATO APP-6 military symbols on the map.
 *
 * When a symbol is pending (set via useTacticalStore.pendingSymbol):
 *   • Map cursor becomes a crosshair
 *   • Single click places a Leaflet marker with the milsymbol SVG as its icon
 *   • The symbol stays "pending" so the user can place multiple copies
 *   • The placed symbol is stored in useDrawnStore as a Point feature
 *
 * Draggable markers: placed markers can be dragged; dragend updates the store.
 *
 * Delete mode: when isDeleteMode is true, clicking a marker removes it immediately.
 *
 * Syncs deletions: subscribes to useDrawnStore so markers are removed from
 * the map when deleted from the DrawnList panel.
 *
 * Renders saved SYMBOL features from the store (e.g. loaded from a file)
 * so state survives page navigation and operation file import.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import ms from 'milsymbol';
import { useDrawnStore, useTacticalStore } from '../store';
import type { DrawnFeature } from '../api/types';

const SYMBOL_SIZE = 40; // px — rendered icon size

function makeMilIcon(sidc: string, size = SYMBOL_SIZE, label?: string): L.DivIcon {
  const options: Record<string, unknown> = {
    size,
    frame: true,
    fill: true,
    infoFields: false,
  };
  if (label) {
    options.uniqueDesignation = label;
  }
  const sym = new ms.Symbol(sidc, options);
  const svg = sym.asSVG();
  const { width, height } = sym.getSize();
  const anchor = sym.getAnchor();
  return L.divIcon({
    className: '',
    html: svg,
    iconSize: [width, height],
    iconAnchor: [anchor.x, anchor.y],
    popupAnchor: [0, -anchor.y],
  });
}

export default function SymbolControl() {
  const map = useMap();
  const pendingSymbol = useTacticalStore((s) => s.pendingSymbol);
  const isDeleteMode  = useTacticalStore((s) => s.isDeleteMode);
  const markersRef    = useRef<Map<string, L.Marker>>(new Map());
  const pendingRef    = useRef(pendingSymbol);
  const deleteModeRef = useRef(isDeleteMode);
  pendingRef.current    = pendingSymbol;
  deleteModeRef.current = isDeleteMode;

  // ── Cursor ────────────────────────────────────────────────────────────────
  useEffect(() => {
    map.getContainer().style.cursor = pendingSymbol ? 'crosshair' : '';
  }, [pendingSymbol, map]);

  // ── Place symbol on click ─────────────────────────────────────────────────
  useEffect(() => {
    function onClick(e: L.LeafletMouseEvent) {
      const sym = pendingRef.current;
      if (!sym) return;
      if (deleteModeRef.current) return;
      L.DomEvent.stop(e);

      const { lat, lng } = e.latlng;
      const id = `symbol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;

      const customLabel = sym.isCustom && sym.customName ? sym.customName : undefined;
      const icon = makeMilIcon(sym.sidc, SYMBOL_SIZE, customLabel);

      const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);

      // Draggable: update store on dragend
      marker.on('dragend', () => {
        const newLatLng = marker.getLatLng();
        useDrawnStore.getState().updateFeature(id, {
          geometry: { type: 'Point', coordinates: [newLatLng.lng, newLatLng.lat] },
        });
      });

      // Click handler: delete mode or popup
      marker.on('click', (ev) => {
        L.DomEvent.stop(ev);
        if (deleteModeRef.current) {
          useDrawnStore.getState().removeFeature(id);
          return;
        }
        // Show popup (already bound below, leaflet handles it)
      });

      // Popup with delete button
      marker.bindPopup(
        `<div style="font-size:11px;line-height:1.6;min-width:160px">
          <div style="font-weight:700;margin-bottom:4px">${sym.name}</div>
          <div style="color:#64748b;font-size:10px;margin-bottom:6px">${sym.category}</div>
          <div style="color:#94a3b8;font-size:9px;margin-bottom:6px">SIDC: ${sym.sidc}</div>
          <button id="del-sym-${id}" style="background:#ef4444;color:#fff;border:none;border-radius:3px;padding:2px 10px;cursor:pointer;font-size:10px">Delete</button>
        </div>`,
      );
      marker.on('popupopen', () => {
        setTimeout(() => {
          document.getElementById(`del-sym-${id}`)?.addEventListener('click', () => {
            map.closePopup();
            useDrawnStore.getState().removeFeature(id);
          });
        }, 0);
      });

      markersRef.current.set(id, marker);

      const feature: DrawnFeature = {
        type: 'Feature',
        id,
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          feature_type: 'SYMBOL',
          sidc: sym.sidc,
          name: sym.name,
          category: sym.category,
          customName: customLabel ?? null,
        },
      };
      useDrawnStore.getState().addFeature(feature);
    }

    map.on('click', onClick);
    return () => { map.off('click', onClick); };
  }, [map]);

  // ── Sync deletions and new features from store ────────────────────────────
  useEffect(() => {
    return useDrawnStore.subscribe((state, prev) => {
      const prevIds = new Set(
        prev.features.filter((f) => f.properties?.feature_type === 'SYMBOL').map((f) => String(f.id)),
      );
      const currIds = new Set(
        state.features.filter((f) => f.properties?.feature_type === 'SYMBOL').map((f) => String(f.id)),
      );

      // Remove deleted markers
      prevIds.forEach((id) => {
        if (!currIds.has(id)) {
          markersRef.current.get(id)?.remove();
          markersRef.current.delete(id);
        }
      });

      // Render new symbols + sync positions of moved ones
      state.features.forEach((f) => {
        if (f.properties?.feature_type !== 'SYMBOL') return;
        const id = String(f.id);
        if (markersRef.current.has(id)) {
          // Sync position if the marker was moved remotely (collab drag).
          if (f.geometry.type === 'Point') {
            const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
            const marker = markersRef.current.get(id)!;
            const cur = marker.getLatLng();
            if (Math.abs(cur.lat - lat) > 1e-9 || Math.abs(cur.lng - lng) > 1e-9) {
              marker.setLatLng([lat, lng]);
            }
          }
          return;
        }
        if (f.geometry.type !== 'Point') return;

        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const sidc       = String(f.properties.sidc ?? 'SFGPUCI----D---');
        const name       = String(f.properties.name ?? 'Symbol');
        const category   = String(f.properties.category ?? '');
        const customName = f.properties.customName ? String(f.properties.customName) : undefined;

        const icon   = makeMilIcon(sidc, SYMBOL_SIZE, customName);
        const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map);

        marker.on('dragend', () => {
          const newLatLng = marker.getLatLng();
          useDrawnStore.getState().updateFeature(id, {
            geometry: { type: 'Point', coordinates: [newLatLng.lng, newLatLng.lat] },
          });
        });

        marker.on('click', (ev) => {
          L.DomEvent.stop(ev);
          if (deleteModeRef.current) {
            useDrawnStore.getState().removeFeature(id);
          }
        });

        marker.bindPopup(
          `<div style="font-size:11px;line-height:1.6;min-width:160px">
            <div style="font-weight:700;margin-bottom:4px">${name}</div>
            <div style="color:#64748b;font-size:10px;margin-bottom:6px">${category}</div>
            <button id="del-sym-${id}" style="background:#ef4444;color:#fff;border:none;border-radius:3px;padding:2px 10px;cursor:pointer;font-size:10px">Delete</button>
          </div>`,
        );
        marker.on('popupopen', () => {
          setTimeout(() => {
            document.getElementById(`del-sym-${id}`)?.addEventListener('click', () => {
              map.closePopup();
              useDrawnStore.getState().removeFeature(id);
            });
          }, 0);
        });

        markersRef.current.set(id, marker);
      });

      // Full clear
      if (state.features.length === 0 && prev.features.length > 0) {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current.clear();
      }
    });
  }, [map]);

  return null;
}
