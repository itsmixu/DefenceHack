export interface Basemap {
  id: string;
  label: string;
  url: string;
  attribution: string;
  maxZoom?: number;
  timeAware?: boolean;
  /** Earliest ISO date this basemap has data for. Omit for "always". */
  minDate?: string;
  /**
   * How many hours behind real-time the data is. A request for t=now will
   * actually serve t=(now - lagHours). UI greys the basemap when committedMs
   * is closer to "now" than this lag — there's no fresh tile available yet.
   */
  lagHours?: number;
  /** Latest ISO date this basemap covers. Omit if it extends to "now - lagHours". */
  maxDate?: string;
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
  {
    id: 'fmi-precipitation',
    label: 'FMI Precipitation (radar)',
    url: '/api/tiles/weather/precipitation/{z}/{y}/{x}.png',
    attribution: '&copy; Ilmatieteen laitos (FMI)',
    maxZoom: 14,
    timeAware: true,
    // FMI radar archive starts ~2014, refreshes every 5 min — almost live.
    minDate: '2014-01-01',
    lagHours: 0.1,
  },
  {
    // FMI's openwms.fmi.fi doesn't publish a cloud-cover WMS layer (only
    // Radar:* layers exist there). Falling back to NASA GIBS MODIS Aqua
    // Cloud Fraction Day — a global daily composite. URL uses {date} which
    // MapView substitutes with the YYYY-MM-DD slice of the selected ISO.
    id: 'nasa-clouds',
    label: 'Cloud cover (NASA MODIS)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_Cloud_Fraction_Day/default/{date}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
    attribution: '&copy; NASA EOSDIS GIBS — MODIS Aqua',
    maxZoom: 6,
    timeAware: true,
    // MODIS Aqua launched 2002; daily composite means ~24 h lag for any given day.
    minDate: '2002-07-04',
    lagHours: 24,
  },
  {
    // Bonus: NASA Terra true-colour imagery. Clouds appear as bright white
    // swirls over the actual Earth surface — great for visual situational
    // awareness when you want to see weather + geography together.
    id: 'nasa-truecolor',
    label: 'Earth — true colour (NASA)',
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg',
    attribution: '&copy; NASA EOSDIS GIBS — MODIS Terra',
    maxZoom: 9,
    timeAware: true,
    // MODIS Terra started 2000-02-24. Daily composite → ~24 h lag.
    minDate: '2000-02-24',
    lagHours: 24,
  },
];
