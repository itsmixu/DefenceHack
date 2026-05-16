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
  echelon?: string; // display hint only
}

export type SymbolCategory =
  | 'Friendly'
  | 'Hostile'
  | 'Unknown'
  | 'Neutral'
  | 'Equipment'
  | 'Installations';

export const SYMBOL_LIBRARY: MilSymbol[] = [
  // ── Friendly ground units ────────────────────────────────────────────────
  {
    sidc: 'SFGPUCI----D---', name: 'Infantry',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Dismounted infantry unit',
  },
  {
    sidc: 'SFGPUCIZ---D---', name: 'Mech. Infantry',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Mechanised infantry — IFV/APC mounted',
  },
  {
    sidc: 'SFGPUCA----D---', name: 'Armor',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Tank / armour unit',
  },
  {
    sidc: 'SFGPUCF----D---', name: 'Artillery',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Field artillery — howitzer, rocket',
  },
  {
    sidc: 'SFGPUCAD---D---', name: 'Air Defense',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Air defense artillery (SHORAD / HIMAD)',
  },
  {
    sidc: 'SFGPUCR----D---', name: 'Reconnaissance',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Recon / cavalry — ISR forward unit',
  },
  {
    sidc: 'SFGPUCL----D---', name: 'Engineer',
    category: 'Friendly', subcategory: 'Combat Support',
    desc: 'Combat engineer — breach, obstacle, bridge',
  },
  {
    sidc: 'SFGPUCAH---D---', name: 'Aviation',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Rotary wing aviation unit',
  },
  {
    sidc: 'SFGPUCAS---D---', name: 'Special Ops',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Special operations forces (SOF)',
  },
  {
    sidc: 'SFGPUH-----D---', name: 'HQ / Command',
    category: 'Friendly', subcategory: 'C2',
    desc: 'Command post / headquarters',
  },
  {
    sidc: 'SFGPUUS----D---', name: 'Signal',
    category: 'Friendly', subcategory: 'Combat Support',
    desc: 'Signal / communications unit',
  },
  {
    sidc: 'SFGPUUM----D---', name: 'Medical',
    category: 'Friendly', subcategory: 'CSS',
    desc: 'Medical support — aid station, hospital',
  },
  {
    sidc: 'SFGPUUL----D---', name: 'Logistics',
    category: 'Friendly', subcategory: 'CSS',
    desc: 'Combat service support — supply, transport',
  },
  {
    sidc: 'SFGPUUP----D---', name: 'Military Police',
    category: 'Friendly', subcategory: 'CSS',
    desc: 'Military police / law enforcement',
  },
  {
    sidc: 'SFGPUUE----D---', name: 'Electronic Warfare',
    category: 'Friendly', subcategory: 'Combat Support',
    desc: 'EW — jamming, SIGINT, ELINT',
  },
  {
    sidc: 'SFGPUUSC---D---', name: 'CBRN',
    category: 'Friendly', subcategory: 'Combat Support',
    desc: 'Chemical, biological, radiological, nuclear defence',
  },
  {
    sidc: 'SFGPUUSR---D---', name: 'Sniper',
    category: 'Friendly', subcategory: 'Combat',
    desc: 'Sniper / sharpshooter team',
  },

  // ── Hostile (enemy) units ─────────────────────────────────────────────────
  {
    sidc: 'SHGPUCI----D---', name: 'Enemy Infantry',
    category: 'Hostile', subcategory: 'Combat',
    desc: 'Confirmed enemy infantry unit',
  },
  {
    sidc: 'SHGPUCIZ---D---', name: 'Enemy Mech. Inf.',
    category: 'Hostile', subcategory: 'Combat',
    desc: 'Enemy mechanised infantry',
  },
  {
    sidc: 'SHGPUCA----D---', name: 'Enemy Armor',
    category: 'Hostile', subcategory: 'Combat',
    desc: 'Enemy tank / armour unit',
  },
  {
    sidc: 'SHGPUCF----D---', name: 'Enemy Artillery',
    category: 'Hostile', subcategory: 'Combat',
    desc: 'Enemy field artillery',
  },
  {
    sidc: 'SHGPUCAD---D---', name: 'Enemy Air Defense',
    category: 'Hostile', subcategory: 'Combat',
    desc: 'Enemy air defense system',
  },
  {
    sidc: 'SHGPUCR----D---', name: 'Enemy Recon',
    category: 'Hostile', subcategory: 'Combat',
    desc: 'Enemy reconnaissance element',
  },
  {
    sidc: 'SHGPUCAH---D---', name: 'Enemy Aviation',
    category: 'Hostile', subcategory: 'Combat',
    desc: 'Enemy rotary wing',
  },
  {
    sidc: 'SHGPUH-----D---', name: 'Enemy HQ',
    category: 'Hostile', subcategory: 'C2',
    desc: 'Enemy command post',
  },
  {
    sidc: 'SHGPUCAS---D---', name: 'Enemy SOF',
    category: 'Hostile', subcategory: 'Combat',
    desc: 'Enemy special operations forces',
  },
  {
    sidc: 'SHGPUUE----D---', name: 'Enemy EW',
    category: 'Hostile', subcategory: 'Combat Support',
    desc: 'Enemy electronic warfare unit',
  },
  {
    sidc: 'SHGPUUL----D---', name: 'Enemy Logistics',
    category: 'Hostile', subcategory: 'CSS',
    desc: 'Enemy logistics / supply element',
  },

  // ── Unknown ──────────────────────────────────────────────────────────────
  {
    sidc: 'SUGPU------D---', name: 'Unknown Unit',
    category: 'Unknown',
    desc: 'Unidentified ground unit',
  },
  {
    sidc: 'SUGPUCI----D---', name: 'Unknown Infantry',
    category: 'Unknown',
    desc: 'Unknown infantry — affiliation not confirmed',
  },
  {
    sidc: 'SUGPUCA----D---', name: 'Unknown Armor',
    category: 'Unknown',
    desc: 'Unknown armoured vehicle',
  },
  {
    sidc: 'SUGPUH-----D---', name: 'Unknown HQ',
    category: 'Unknown',
    desc: 'Unknown command element',
  },
  {
    sidc: 'SUAPU------D---', name: 'Unknown Aircraft',
    category: 'Unknown',
    desc: 'Unidentified aircraft',
  },

  // ── Neutral ──────────────────────────────────────────────────────────────
  {
    sidc: 'SNGPU------D---', name: 'Neutral Force',
    category: 'Neutral',
    desc: 'Neutral or civilian force',
  },
  {
    sidc: 'SNGPUCI----D---', name: 'Neutral Infantry',
    category: 'Neutral',
    desc: 'Neutral armed personnel',
  },

  // ── Equipment (friendly) ─────────────────────────────────────────────────
  {
    sidc: 'SFGPEVCA---D---', name: 'Tank',
    category: 'Equipment', subcategory: 'Vehicles',
    desc: 'Main battle tank',
  },
  {
    sidc: 'SFGPEVCAH--D---', name: 'APC / IFV',
    category: 'Equipment', subcategory: 'Vehicles',
    desc: 'Armoured personnel carrier / infantry fighting vehicle',
  },
  {
    sidc: 'SFGPEVAT---D---', name: 'Artillery Piece',
    category: 'Equipment', subcategory: 'Weapons',
    desc: 'Towed howitzer / cannon',
  },
  {
    sidc: 'SFGPEVA----D---', name: 'Truck',
    category: 'Equipment', subcategory: 'Vehicles',
    desc: 'Wheeled logistics vehicle',
  },
  {
    sidc: 'SFAPMFH----D---', name: 'Helicopter',
    category: 'Equipment', subcategory: 'Aviation',
    desc: 'Military helicopter (rotary wing)',
  },
  {
    sidc: 'SFAPWMFB---D---', name: 'Fixed-wing',
    category: 'Equipment', subcategory: 'Aviation',
    desc: 'Fixed-wing aircraft',
  },
  {
    sidc: 'SFGPEWA----D---', name: 'Radar',
    category: 'Equipment', subcategory: 'Sensors',
    desc: 'Ground-based radar system',
  },
  {
    sidc: 'SFAPMFF----D---', name: 'UAV / Drone',
    category: 'Equipment', subcategory: 'Aviation',
    desc: 'Unmanned aerial vehicle',
  },

  // ── Installations ────────────────────────────────────────────────────────
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
    sidc: 'SFGPIDM----D---', name: 'Maintenance',
    category: 'Installations',
    desc: 'Vehicle / equipment maintenance facility',
  },
  {
    sidc: 'SFGPIDR----D---', name: 'Relay Station',
    category: 'Installations',
    desc: 'Communication relay / signal node',
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

export const SYMBOL_CATEGORIES: SymbolCategory[] = [
  'Friendly', 'Hostile', 'Unknown', 'Neutral', 'Equipment', 'Installations',
];

export function symbolsByCategory(cat: SymbolCategory): MilSymbol[] {
  return SYMBOL_LIBRARY.filter((s) => s.category === cat);
}
