import { useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import { useBboxStore } from '../store';
import { boundsToBboxString } from '../lib/bbox';

export default function BboxTracker() {
  const map = useMap();
  const setBbox = useBboxStore((s) => s.setBbox);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setBbox(boundsToBboxString(map.getBounds()));
  }, [map, setBbox]);

  const schedule = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setBbox(boundsToBboxString(map.getBounds()));
    }, 300);
  };

  useMapEvents({
    moveend: schedule,
    zoomend: schedule,
  });

  return null;
}
