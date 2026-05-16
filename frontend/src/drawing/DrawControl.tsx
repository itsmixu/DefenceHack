import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import type { Feature } from 'geojson';
import { useDrawnStore } from '../store';
import type { DrawnFeature } from '../api/types';

const FEATURE_TYPES = ['AOI', 'NAI', 'TAI', 'DP', 'annotation'] as const;

interface TaggedLayer extends L.Layer {
  _leaflet_id: number;
  _defenceHackFeatureType?: string;
  toGeoJSON: () => Feature;
}

export default function DrawControl() {
  const map = useMap();

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

    const promptType = (current?: string) => {
      const choice = window.prompt(
        `Feature type? (${FEATURE_TYPES.join(' / ')})`,
        current ?? 'AOI',
      );
      if (!choice) return current ?? 'annotation';
      const normalised = choice.trim();
      const match = FEATURE_TYPES.find(
        (t) => t.toLowerCase() === normalised.toLowerCase(),
      );
      return match ?? 'annotation';
    };

    const onCreate = (e: { layer: TaggedLayer }) => {
      const layer = e.layer;
      layer._defenceHackFeatureType = promptType();
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
  }, [map]);

  return null;
}
