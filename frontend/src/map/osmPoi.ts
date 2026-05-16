export const OSM_POI_CATEGORIES = [
  {
    id: 'hospital',
    label: 'Hospital',
    icon: '+',
    color: '#dc2626',
  },
  {
    id: 'clinic',
    label: 'Clinic',
    icon: '✚',
    color: '#f43f5e',
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy',
    icon: '⚕',
    color: '#16a34a',
  },
  {
    id: 'fuel',
    label: 'Fuel Station',
    icon: '⛽',
    color: '#f97316',
  },
  {
    id: 'charging_station',
    label: 'Charging Station',
    icon: '⚡',
    color: '#0ea5e9',
  },
  {
    id: 'police',
    label: 'Police',
    icon: '🛡',
    color: '#2563eb',
  },
  {
    id: 'fire_station',
    label: 'Fire Station',
    icon: '🚒',
    color: '#ea580c',
  },
  {
    id: 'shelter',
    label: 'Shelter',
    icon: '⌂',
    color: '#4b5563',
  },
  {
    id: 'power_plant',
    label: 'Power Plant',
    icon: '⚙',
    color: '#a16207',
  },
  {
    id: 'power_substation',
    label: 'Power Substation',
    icon: '🔌',
    color: '#ca8a04',
  },
  {
    id: 'airfield',
    label: 'Airfield',
    icon: '✈',
    color: '#0891b2',
  },
  {
    id: 'helipad',
    label: 'Helipad',
    icon: 'H',
    color: '#0e7490',
  },
  {
    id: 'railway',
    label: 'Railway',
    icon: '═',
    color: '#475569',
  },
  {
    id: 'railway_bridge',
    label: 'Rail Bridge',
    icon: '╪',
    color: '#1d4ed8',
  },
  {
    id: 'waterway',
    label: 'Waterway',
    icon: '~',
    color: '#0284c7',
  },
  {
    id: 'ford',
    label: 'Ford',
    icon: '≈',
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
