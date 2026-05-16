export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom?: number;
}

// MML tiles are proxied through our backend (`/api/tiles/mml/...`) so the
// MML API key stays server-side. Configure MML_API_KEY in backend/.env.
const mmlUrl = (layer: string) => `/api/tiles/mml/${layer}/{z}/{y}/{x}.png`;

export const basemaps: Basemap[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
  {
    id: 'mml',
    label: 'MML Maastokartta',
    url: mmlUrl('maastokartta'),
    attribution: '&copy; Maanmittauslaitos',
    maxZoom: 18,
  },
  {
    id: 'mml-shade',
    label: 'MML Taustakartta',
    url: mmlUrl('taustakartta'),
    attribution: '&copy; Maanmittauslaitos',
    maxZoom: 18,
  },
];
