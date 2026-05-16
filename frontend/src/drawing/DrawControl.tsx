import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import type { Feature } from 'geojson';
import { useDrawnStore, useTacticalStore } from '../store';
import type { DrawnFeature } from '../api/types';

// All supported feature type strings (doctrinal + tactical + freeform).
const ALL_TYPES = [
  'AOI', 'NAI', 'TAI', 'DP',
  'PHASE_LINE', 'BOUNDARY', 'ROUTE', 'OBJECTIVE',
  'UNIT_FRIENDLY', 'UNIT_ENEMY', 'CHOKE_POINT', 'HIDE_SITE',
  'annotation',
] as const;

type FeatureType = typeof ALL_TYPES[number];

interface TaggedLayer extends L.Layer {
  _leaflet_id: number;
  _defenceHackFeatureType?: FeatureType;
  toGeoJSON: () => Feature;
}

export default function DrawControl() {
  const map = useMap();
  const pendingType = useTacticalStore((s) => s.pendingType);
  const pendingDrawMode = useTacticalStore((s) => s.pendingDrawMode);
  const clearPending = useTacticalStore((s) => s.clearPending);

  // Keep latest pendingType in a ref so the onCreate closure always sees
  // the current value without needing to re-register event listeners.
  const pendingTypeRef = useRef<string | null>(null);
  pendingTypeRef.current = pendingType;

  // Activate geoman draw mode when TacticalTools sets a pending mode.
  useEffect(() => {
    if (!pendingDrawMode) return;
    const m = map as L.Map & {
      pm: { enableDraw: (mode: string, opts?: Record<string, unknown>) => void };
    };
    m.pm.enableDraw(pendingDrawMode, { allowSelfIntersection: false });
    // Keep pendingType alive until onCreate consumes it — don't clear yet.
  }, [pendingDrawMode, map]);

  useEffect(() => {
    const m = map as L.Map & {
      pm: {
        addControls: (opts: Record<string, unknown>) => void;
        removeControls?: () => void;
      };
    };

    m.pm.addControls({
      position: 'topleft',
      drawCircleMarker: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
    });

    const drawn = new Map<number, TaggedLayer>();

    const sync = () => {
      const features: DrawnFeature[] = [];
      drawn.forEach((layer, id) => {
        const f = layer.toGeoJSON() as DrawnFeature;
        f.id = id;
        f.properties = {
          ...(f.properties ?? {}),
          feature_type: layer._defenceHackFeatureType ?? 'annotation',
        };
        features.push(f);
      });
      useDrawnStore.getState().setAll(features);
    };

    const promptType = (current?: string): FeatureType => {
      const choice = window.prompt(
        `Feature type?\n${ALL_TYPES.join(' / ')}`,
        current ?? 'AOI',
      );
      if (!choice) return (current as FeatureType) ?? 'annotation';
      const normalised = choice.trim().toUpperCase();
      const match = ALL_TYPES.find((t) => t === normalised);
      return match ?? 'annotation';
    };

    const TYPE_COLORS: Partial<Record<string, string>> = {
      AOI: '#ffffff', NAI: '#3b82f6', TAI: '#ef4444', DP: '#f59e0b',
      PHASE_LINE: '#22c55e', BOUNDARY: '#f59e0b', ROUTE: '#a855f7',
      OBJECTIVE: '#ef4444', UNIT_FRIENDLY: '#3b82f6', UNIT_ENEMY: '#ef4444',
      CHOKE_POINT: '#f59e0b', HIDE_SITE: '#22c55e', annotation: '#9ca3af',
    };

    const applyStyle = (layer: TaggedLayer, type: string) => {
      const color = TYPE_COLORS[type] ?? '#9ca3af';
      const asPath = layer as unknown as L.Path;
      if (typeof asPath.setStyle === 'function') {
        asPath.setStyle({ color, fillColor: color, fillOpacity: 0.15, weight: type === 'AOI' ? 2.5 : 1.5 });
      }
    };

    const onCreate = (e: { layer: TaggedLayer }) => {
      const layer = e.layer;
      // Use type pre-selected from TacticalTools panel if set; otherwise prompt.
      const pt = pendingTypeRef.current;
      if (pt) {
        layer._defenceHackFeatureType = pt as FeatureType;
        clearPending();
      } else {
        layer._defenceHackFeatureType = promptType();
      }
      applyStyle(layer, layer._defenceHackFeatureType ?? 'annotation');
      drawn.set(layer._leaflet_id, layer);
      layer.on('pm:edit pm:update', sync);
      sync();
    };

    const onRemove = (e: { layer: TaggedLayer }) => {
      drawn.delete(e.layer._leaflet_id);
      sync();
    };

    map.on('pm:create', onCreate as unknown as L.LeafletEventHandlerFn);
    map.on('pm:remove', onRemove as unknown as L.LeafletEventHandlerFn);

    return () => {
      map.off('pm:create', onCreate as unknown as L.LeafletEventHandlerFn);
      map.off('pm:remove', onRemove as unknown as L.LeafletEventHandlerFn);
      drawn.forEach((layer) => layer.off('pm:edit pm:update', sync));
      drawn.clear();
      m.pm.removeControls?.();
    };
  }, [map, clearPending]);

  return null;
}
