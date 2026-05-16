import { useEffect, useRef } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import { useBboxStore } from '../store';
import { boundsToBboxString } from '../lib/bbox';

export default function BboxTracker() {
  const map = useMap();
  const setBbox = useBboxStore((s) => s.setBbox);
  const setZoom = useBboxStore((s) => s.setZoom);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setBbox(boundsToBboxString(map.getBounds()));
    setZoom(map.getZoom());
  }, [map, setBbox, setZoom]);

  const schedule = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setBbox(boundsToBboxString(map.getBounds()));
      setZoom(map.getZoom());
    }, 300);
  };

  useMapEvents({
    moveend: schedule,
    zoomend: schedule,
  });

  return null;
}
