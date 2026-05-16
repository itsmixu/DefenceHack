export function zoomScale(zoom: number | null | undefined): number {
  if (zoom == null || !Number.isFinite(zoom)) return 1;
  const stops: [number, number][] = [
    [8, 0.85],
    [11, 1.0],
    [14, 1.25],
    [17, 1.5],
  ];
  if (zoom <= stops[0][0]) return stops[0][1];
  if (zoom >= stops[stops.length - 1][0]) return stops[stops.length - 1][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [z0, s0] = stops[i];
    const [z1, s1] = stops[i + 1];
    if (zoom >= z0 && zoom <= z1) {
      const t = (zoom - z0) / (z1 - z0);
      return s0 + (s1 - s0) * t;
    }
  }
  return 1;
}
