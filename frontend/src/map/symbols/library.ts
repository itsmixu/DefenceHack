/**
 * NATO APP-6 / MIL-STD-2525B military symbol library.
 *
 * SIDC = Symbol Identification Code (15 characters)
 *   [1]   Coding scheme  : S = Warfighting
 *   [2]   Affiliation    : F=Friendly  H=Hostile  U=Unknown  N=Neutral
 *   [3]   Battle dim     : G=Ground  A=Air  S=Sea  U=Subsurface
 *   [4]   Status         : P=Present  A=Anticipated
 *   [5-10] Function ID   : unit/equipment type
 *   [11-12] Echelon      : -- = none, *2=team, *3=squad … *E=army
 *   [13-14] Country      : -- = not specified
 *   [15]  Order of battle: D=Dismounted, G=Army, W=WMD, - = N/A
 */

export interface MilSymbol {
  sidc: string;
  name: string;
  category: SymbolCategory;
  subcategory?: string;
  desc?: string;
  echelon?: string;
  isCustom?: boolean;
}

export type SymbolCategory =
  | 'Friendly'
  | 'Hostile'
  | 'Unknown'
  | 'Neutral'
  | 'Equipment'
  | 'Installations';

// Helper: swap affiliation character (index 1) in an SIDC
function aff(sidc: string, affiliation: 'F' | 'H' | 'U' | 'N'): string {
  return sidc[0] + affiliation + sidc.slice(2);
}

// Base SIDCs (Friendly = F at index 1)
const BASE_SIDCS = {
  Infantry:       'SFGPUCI----D---',
  Motorized:      'SFGPUCIM---D---',
  Mechanized:     'SFGPUCIZ---D---',
  Armor:          'SFGPUCA----D---',
  Aviation:       'SFGPUCAH---D---',
  Maintenance:    'SFGPUUE----D---',
  HQ:             'SFGPUH-----D---',
  Logistics:      'SFGPUUL----D---',
  FireSupport:    'SFGPUCFS---D---',
  Artillery:      'SFGPUCF----D---',
  Mortar:         'SFGPUCFM---D---',
  Medical:        'SFGPUUM----D---',
  Reconnaissance: 'SFGPUCR----D---',
  UAV:            'SFAPMFU----D---',
  FixedWing:      'SFAPWMFB---D---',
  Unknown:        'SFGPU------D---',
};

// Unit type definitions: [name, base SIDC, desc]
const UNIT_TYPES: Array<{ key: keyof typeof BASE_SIDCS; name: string; desc: string }> = [
  { key: 'Infantry',       name: 'Infantry',        desc: 'Dismounted infantry unit' },
  { key: 'Motorized',      name: 'Motorized',        desc: 'Motorized infantry unit' },
  { key: 'Mechanized',     name: 'Mechanized',       desc: 'Mechanised infantry — IFV/APC mounted' },
  { key: 'Armor',          name: 'Armor',            desc: 'Tank / armour unit' },
  { key: 'Aviation',       name: 'Aviation',         desc: 'Rotary wing aviation unit' },
  { key: 'Maintenance',    name: 'Maintenance',      desc: 'Maintenance and repair unit' },
  { key: 'HQ',             name: 'HQ',               desc: 'Command post / headquarters' },
  { key: 'Logistics',      name: 'Supply/Logistics', desc: 'Combat service support — supply, transport' },
  { key: 'FireSupport',    name: 'Fire Support',     desc: 'Fire support coordination element' },
  { key: 'Artillery',      name: 'Artillery',        desc: 'Field artillery — howitzer, rocket' },
  { key: 'Mortar',         name: 'Mortar',           desc: 'Mortar unit' },
  { key: 'Medical',        name: 'Medical',          desc: 'Medical support — aid station, hospital' },
  { key: 'Reconnaissance', name: 'Reconnaissance',   desc: 'Recon / cavalry — ISR forward unit' },
  { key: 'UAV',            name: 'UAV',              desc: 'Unmanned aerial vehicle unit' },
  { key: 'FixedWing',      name: 'Fixed Wing',       desc: 'Fixed wing aviation unit' },
  { key: 'Unknown',        name: 'Unknown/Empty',    desc: 'Unidentified or placeholder unit' },
];

const AFFILIATIONS: Array<{ cat: 'Friendly' | 'Hostile' | 'Unknown' | 'Neutral'; char: 'F' | 'H' | 'U' | 'N'; prefix: string }> = [
  { cat: 'Friendly', char: 'F', prefix: '' },
  { cat: 'Hostile',  char: 'H', prefix: 'Enemy ' },
  { cat: 'Unknown',  char: 'U', prefix: 'Unknown ' },
  { cat: 'Neutral',  char: 'N', prefix: 'Neutral ' },
];

// Generate 4 affiliation variants for each unit type
const unitSymbols: MilSymbol[] = [];
for (const affil of AFFILIATIONS) {
  for (const ut of UNIT_TYPES) {
    unitSymbols.push({
      sidc: aff(BASE_SIDCS[ut.key], affil.char),
      name: `${affil.prefix}${ut.name}`,
      category: affil.cat,
      desc: ut.desc,
    });
  }
  // Custom entry for each affiliation
  const customSidcBase = 'SFGPU------D---';
  unitSymbols.push({
    sidc: aff(customSidcBase, affil.char),
    name: 'Custom',
    category: affil.cat,
    desc: 'Custom unit — type your own designation',
    isCustom: true,
  });
}

// Equipment symbols
const equipmentSymbols: MilSymbol[] = [
  {
    sidc: 'SFGPEVCA---D---', name: 'Tank',
    category: 'Equipment', subcategory: 'Vehicles',
    desc: 'Main battle tank',
  },
  {
    sidc: 'SFGPEVCAT--D---', name: 'APC/IFV',
    category: 'Equipment', subcategory: 'Vehicles',
    desc: 'Armoured personnel carrier / infantry fighting vehicle',
  },
  {
    sidc: 'SFGPEVA----D---', name: 'Truck',
    category: 'Equipment', subcategory: 'Vehicles',
    desc: 'Wheeled logistics vehicle',
  },
  {
    sidc: 'SFAPWMHQ---D---', name: 'Helicopter',
    category: 'Equipment', subcategory: 'Aviation',
    desc: 'Military helicopter (rotary wing)',
  },
  {
    sidc: 'SFAPWMFB---D---', name: 'Fixed Wing',
    category: 'Equipment', subcategory: 'Aviation',
    desc: 'Fixed-wing aircraft',
  },
  {
    sidc: 'SFAPMFU----D---', name: 'UAV',
    category: 'Equipment', subcategory: 'Aviation',
    desc: 'Unmanned aerial vehicle',
  },
  {
    sidc: 'SFGPEWA----D---', name: 'Radar',
    category: 'Equipment', subcategory: 'Sensors',
    desc: 'Ground-based radar system',
  },
];

// Installation symbols
const installationSymbols: MilSymbol[] = [
  {
    sidc: 'SFGPIDC----D---', name: 'Command Post',
    category: 'Installations',
    desc: 'Command and control installation',
  },
  {
    sidc: 'SFGPIDS----D---', name: 'Supply Depot',
    category: 'Installations',
    desc: 'Ammunition / supply storage point',
  },
  {
    sidc: 'SFGPIDH----D---', name: 'Medical Facility',
    category: 'Installations',
    desc: 'Field hospital / aid station',
  },
  {
    sidc: 'SFGPIDF----D---', name: 'Airfield',
    category: 'Installations',
    desc: 'Military airfield / FARP',
  },
  {
    sidc: 'SHGPIDC----D---', name: 'Enemy CP',
    category: 'Installations',
    desc: 'Confirmed enemy command post',
  },
  {
    sidc: 'SHGPIDS----D---', name: 'Enemy Supply',
    category: 'Installations',
    desc: 'Enemy ammunition / supply point',
  },
];

export const SYMBOL_LIBRARY: MilSymbol[] = [
  ...unitSymbols,
  ...equipmentSymbols,
  ...installationSymbols,
];

export const SYMBOL_CATEGORIES: SymbolCategory[] = [
  'Friendly', 'Hostile', 'Unknown', 'Neutral', 'Equipment', 'Installations',
];

export function symbolsByCategory(cat: SymbolCategory): MilSymbol[] {
  return SYMBOL_LIBRARY.filter((s) => s.category === cat);
}
