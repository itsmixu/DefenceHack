// Helper — wraps Lucide-style path data in a sized SVG element.
const i = (paths: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const OSM_POI_CATEGORIES = [
  {
    id: 'hospital',
    label: 'Hospital',
    icon: i('<path d="M12 6v12"/><path d="M6 12h12"/><rect x="2" y="2" width="20" height="20" rx="2"/>'),
    color: '#dc2626',
  },
  {
    id: 'clinic',
    label: 'Clinic',
    icon: i('<path d="M12 8v8"/><path d="M8 12h8"/><circle cx="12" cy="12" r="10"/>'),
    color: '#f43f5e',
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy',
    icon: i('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>'),
    color: '#16a34a',
  },
  {
    id: 'fuel',
    label: 'Fuel Station',
    icon: i('<path d="M3 22V9a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v13"/><path d="M14 7h3l2 2v5h-5"/><path d="M3 22h11"/><path d="M16 17v5"/><path d="M7 10h4"/>'),
    color: '#f97316',
  },
  {
    id: 'charging_station',
    label: 'Charging Station',
    icon: i('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>'),
    color: '#0ea5e9',
  },
  {
    id: 'police',
    label: 'Police',
    icon: i('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    color: '#2563eb',
  },
  {
    id: 'fire_station',
    label: 'Fire Station',
    icon: i('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>'),
    color: '#ea580c',
  },
  {
    id: 'shelter',
    label: 'Shelter',
    icon: i('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
    color: '#4b5563',
  },
  {
    id: 'power_plant',
    label: 'Power Plant',
    icon: i('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3h-4l-2 4h8l-2-4z"/><path d="M9 11v4"/><path d="M12 11v4"/><path d="M15 11v4"/>'),
    color: '#a16207',
  },
  {
    id: 'power_substation',
    label: 'Power Substation',
    icon: i('<path d="M12 22V12"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><path d="M8 6l4-4 4 4"/><path d="M12 2v10"/>'),
    color: '#ca8a04',
  },
  {
    id: 'airfield',
    label: 'Airfield',
    icon: i('<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21 4 19 4s-2 1-3.5 2.5L11 10 2.8 6.2l-2 2 8 3L6.5 14l-4 2 2 4 4-2 3 8z"/>'),
    color: '#0891b2',
  },
  {
    id: 'helipad',
    label: 'Helipad',
    icon: i('<path d="M12 2a9 9 0 0 1 9 9v10H3V11a9 9 0 0 1 9-9z"/><path d="M8 8v8"/><path d="M16 8v8"/><path d="M8 12h8"/>'),
    color: '#0e7490',
  },
  {
    id: 'railway',
    label: 'Railway',
    icon: i('<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><path d="m8 19-2 3"/><path d="m18 22-2-3"/><path d="M8 15h.01"/><path d="M16 15h.01"/>'),
    color: '#475569',
  },
  {
    id: 'railway_bridge',
    label: 'Rail Bridge',
    icon: i('<path d="M2 9h20"/><path d="M2 15h20"/><path d="M5 9v6"/><path d="M19 9v6"/><path d="M8 9v6"/><path d="M16 9v6"/><path d="M2 9c0-3 2-6 5-6"/><path d="M22 9c0-3-2-6-5-6"/>'),
    color: '#1d4ed8',
  },
  {
    id: 'waterway',
    label: 'Waterway',
    icon: i('<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>'),
    color: '#0284c7',
  },
  {
    id: 'ford',
    label: 'Ford',
    icon: i('<path d="M5 22H2"/><path d="M22 22h-3"/><path d="M12 12v10"/><path d="M12 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M2 18c2-2 4-3 6-2l4 2c2 1 4 0 6-2"/>'),
    color: '#0369a1',
  },
] as const;

export type OsmPoiCategory = (typeof OSM_POI_CATEGORIES)[number]['id'];

export const ALL_OSM_POI_CATEGORIES: OsmPoiCategory[] = OSM_POI_CATEGORIES.map((c) => c.id);

const OSM_POI_BY_ID = Object.fromEntries(OSM_POI_CATEGORIES.map((c) => [c.id, c])) as Record<
  OsmPoiCategory,
  (typeof OSM_POI_CATEGORIES)[number]
>;

export const getOsmPoiMeta = (category: string | undefined) => {
  if (!category) return undefined;
  return OSM_POI_BY_ID[category as OsmPoiCategory];
};
