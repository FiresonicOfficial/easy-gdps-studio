export type GdEra = 'Classic (1.0–1.8)' | 'Creator Era (1.9–2.0)' | 'Modern Era (2.1–2.2)';

export type GdVersionId =
  | '1.0'
  | '1.1'
  | '1.2'
  | '1.3'
  | '1.4'
  | '1.5'
  | '1.6'
  | '1.7'
  | '1.8'
  | '1.9'
  | '2.0'
  | '2.1'
  | '2.11'
  | '2.2';

export interface GdVersionSpec {
  id: GdVersionId;
  label: string;
  gameVersionInt: number;
  binaryVersionInt: number;
  era: GdEra;
  highlights: string;
  usesBase64Url: boolean;
  endpointSuffix: '' | '19' | '20' | '21';
  maxUrlByteLength: 33 | 44;
  supportsAccounts: boolean;
  supportsCustomSongs: boolean;
  supportsMapPacks: boolean;
  supportsGauntlets: boolean;
  maxGauntletId: number;
}

export interface GauntletCatalogEntry {
  id: number;
  name: string;
  minVersion: '2.1' | '2.2';
}

export interface MapPackDifficultyOption {
  value: number;
  label: string;
  defaultColor: string;
}

export const ORIGINAL_ASCII_URL = 'http://www.boomlings.com/database'; // 33 bytes
export const ORIGINAL_BASE64_URL = 'aHR0cDovL3d3dy5ib29tbGluZ3MuY29tL2RhdGFiYXNl'; // 44 bytes

export const GAUNTLET_CATALOG: GauntletCatalogEntry[] = [
  // GD 2.1 Official Gauntlets (1–15)
  { id: 1, name: 'Fire Gauntlet', minVersion: '2.1' },
  { id: 2, name: 'Ice Gauntlet', minVersion: '2.1' },
  { id: 3, name: 'Poison Gauntlet', minVersion: '2.1' },
  { id: 4, name: 'Shadow Gauntlet', minVersion: '2.1' },
  { id: 5, name: 'Lava Gauntlet', minVersion: '2.1' },
  { id: 6, name: 'Bonus Gauntlet', minVersion: '2.1' },
  { id: 7, name: 'Chaos Gauntlet', minVersion: '2.1' },
  { id: 8, name: 'Demon Gauntlet', minVersion: '2.1' },
  { id: 9, name: 'Time Gauntlet', minVersion: '2.1' },
  { id: 10, name: 'Crystal Gauntlet', minVersion: '2.1' },
  { id: 11, name: 'Magic Gauntlet', minVersion: '2.1' },
  { id: 12, name: 'Spike Gauntlet', minVersion: '2.1' },
  { id: 13, name: 'Monster Gauntlet', minVersion: '2.1' },
  { id: 14, name: 'Doom Gauntlet', minVersion: '2.1' },
  { id: 15, name: 'Death Gauntlet', minVersion: '2.1' },
  // GD 2.2 Official Gauntlets (16–60)
  { id: 16, name: 'Forest Gauntlet', minVersion: '2.2' },
  { id: 17, name: 'Rune Gauntlet', minVersion: '2.2' },
  { id: 18, name: 'Force Gauntlet', minVersion: '2.2' },
  { id: 19, name: 'Spooky Gauntlet', minVersion: '2.2' },
  { id: 20, name: 'Dragon Gauntlet', minVersion: '2.2' },
  { id: 21, name: 'Water Gauntlet', minVersion: '2.2' },
  { id: 22, name: 'Haunted Gauntlet', minVersion: '2.2' },
  { id: 23, name: 'Acid Gauntlet', minVersion: '2.2' },
  { id: 24, name: 'Witch Gauntlet', minVersion: '2.2' },
  { id: 25, name: 'Power Gauntlet', minVersion: '2.2' },
  { id: 26, name: 'Potion Gauntlet', minVersion: '2.2' },
  { id: 27, name: 'Snake Gauntlet', minVersion: '2.2' },
  { id: 28, name: 'Toxic Gauntlet', minVersion: '2.2' },
  { id: 29, name: 'Halloween Gauntlet', minVersion: '2.2' },
  { id: 30, name: 'Treasure Gauntlet', minVersion: '2.2' },
  { id: 31, name: 'Ghost Gauntlet', minVersion: '2.2' },
  { id: 32, name: 'Spider Gauntlet', minVersion: '2.2' },
  { id: 33, name: 'Gem Gauntlet', minVersion: '2.2' },
  { id: 34, name: 'Inferno Gauntlet', minVersion: '2.2' },
  { id: 35, name: 'Portal Gauntlet', minVersion: '2.2' },
  { id: 36, name: 'Strange Gauntlet', minVersion: '2.2' },
  { id: 37, name: 'Fantasy Gauntlet', minVersion: '2.2' },
  { id: 38, name: 'Christmas Gauntlet', minVersion: '2.2' },
  { id: 39, name: 'Surprise Gauntlet', minVersion: '2.2' },
  { id: 40, name: 'Mystery Gauntlet', minVersion: '2.2' },
  { id: 41, name: 'Cursed Gauntlet', minVersion: '2.2' },
  { id: 42, name: 'Cyborg Gauntlet', minVersion: '2.2' },
  { id: 43, name: 'Castle Gauntlet', minVersion: '2.2' },
  { id: 44, name: 'Grave Gauntlet', minVersion: '2.2' },
  { id: 45, name: 'Temple Gauntlet', minVersion: '2.2' },
  { id: 46, name: 'World Gauntlet', minVersion: '2.2' },
  { id: 47, name: 'Galaxy Gauntlet', minVersion: '2.2' },
  { id: 48, name: 'Universe Gauntlet', minVersion: '2.2' },
  { id: 49, name: 'Discord Gauntlet', minVersion: '2.2' },
  { id: 50, name: 'Split Gauntlet', minVersion: '2.2' },
  { id: 51, name: 'NCS I Gauntlet', minVersion: '2.2' },
  { id: 52, name: 'NCS II Gauntlet', minVersion: '2.2' },
  { id: 53, name: 'Space Gauntlet', minVersion: '2.2' },
  { id: 54, name: 'Cosmos Gauntlet', minVersion: '2.2' },
  { id: 55, name: 'Random Gauntlet', minVersion: '2.2' },
  { id: 56, name: 'Chance Gauntlet', minVersion: '2.2' },
  { id: 57, name: 'Future Gauntlet', minVersion: '2.2' },
  { id: 58, name: 'Utopia Gauntlet', minVersion: '2.2' },
  { id: 59, name: 'Cinema Gauntlet', minVersion: '2.2' },
  { id: 60, name: 'Love Gauntlet', minVersion: '2.2' },
];

export const MAPPACK_DIFFICULTIES: MapPackDifficultyOption[] = [
  { value: 0, label: 'Auto', defaultColor: '255,210,63' },
  { value: 1, label: 'Easy', defaultColor: '0,224,255' },
  { value: 2, label: 'Normal', defaultColor: '56,242,110' },
  { value: 3, label: 'Hard', defaultColor: '255,200,0' },
  { value: 4, label: 'Harder', defaultColor: '255,110,48' },
  { value: 5, label: 'Insane', defaultColor: '236,72,153' },
  { value: 6, label: 'Hard Demon', defaultColor: '239,68,68' },
  { value: 7, label: 'Easy Demon', defaultColor: '168,85,247' },
  { value: 8, label: 'Medium Demon', defaultColor: '217,70,239' },
  { value: 9, label: 'Insane Demon', defaultColor: '225,29,72' },
  { value: 10, label: 'Extreme Demon', defaultColor: '185,28,28' },
];

export function getGauntletCatalogForVersion(versionId: GdVersionId): GauntletCatalogEntry[] {
  const spec = getGdVersionSpec(versionId);
  if (!spec.supportsGauntlets || spec.maxGauntletId <= 0) {
    return [];
  }
  return GAUNTLET_CATALOG.filter((entry) => entry.id <= spec.maxGauntletId);
}

export function getGauntletNameById(id: number): string {
  return GAUNTLET_CATALOG.find((g) => g.id === id)?.name ?? `Gauntlet #${id}`;
}

export const GD_VERSIONS: GdVersionSpec[] = [
  {
    id: '1.0',
    label: 'Geometry Dash 1.0',
    gameVersionInt: 1,
    binaryVersionInt: 1,
    era: 'Classic (1.0–1.8)',
    highlights: '1.0: Original Release, Cube & Ship, 7 Classic Main Levels',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: false,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.1',
    label: 'Geometry Dash 1.1',
    gameVersionInt: 2,
    binaryVersionInt: 2,
    era: 'Classic (1.0–1.8)',
    highlights: '1.1: Mirror Portal, Time Machine, Level Comments Foundation',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: false,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.2',
    label: 'Geometry Dash 1.2',
    gameVersionInt: 3,
    binaryVersionInt: 3,
    era: 'Classic (1.0–1.8)',
    highlights: '1.2: Ball Gamemode, Cycles, Early Custom Level Sharing',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: false,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.3',
    label: 'Geometry Dash 1.3',
    gameVersionInt: 4,
    binaryVersionInt: 4,
    era: 'Classic (1.0–1.8)',
    highlights: '1.3: xStep, Demon Difficulty, Secret Coins Intro',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: false,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.4',
    label: 'Geometry Dash 1.4',
    gameVersionInt: 5,
    binaryVersionInt: 5,
    era: 'Classic (1.0–1.8)',
    highlights: '1.4: Clutterfunk, Mini Portal, Sawblades & Early Deco',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: false,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.5',
    label: 'Geometry Dash 1.5',
    gameVersionInt: 6,
    binaryVersionInt: 6,
    era: 'Classic (1.0–1.8)',
    highlights: '1.5: UFO Gamemode, Theory of Everything, Pink Jump Pad',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: false,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.6',
    label: 'Geometry Dash 1.6',
    gameVersionInt: 7,
    binaryVersionInt: 7,
    era: 'Classic (1.0–1.8)',
    highlights: '1.6: Electroman Adventures, Clubstep, Map Packs, Destructible Blocks',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: true,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.7',
    label: 'Geometry Dash 1.7',
    gameVersionInt: 10,
    binaryVersionInt: 10,
    era: 'Classic (1.0–1.8)',
    highlights: '1.7: Electrodynamix, Speed Portals (0.5x–3x), Colored Triggers',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: true,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.8',
    label: 'Geometry Dash 1.8',
    gameVersionInt: 18,
    binaryVersionInt: 18,
    era: 'Classic (1.0–1.8)',
    highlights: '1.8: Hexagon Force, Dual Portal, Slopes & Two-Player Mode',
    usesBase64Url: false,
    endpointSuffix: '',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: false,
    supportsMapPacks: true,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '1.9',
    label: 'Geometry Dash 1.9',
    gameVersionInt: 19,
    binaryVersionInt: 19,
    era: 'Creator Era (1.9–2.0)',
    highlights: '1.9: Wave Gamemode, Blast Processing, Newgrounds Custom Songs',
    usesBase64Url: false,
    endpointSuffix: '19',
    maxUrlByteLength: 33,
    supportsAccounts: false,
    supportsCustomSongs: true,
    supportsMapPacks: true,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '2.0',
    label: 'Geometry Dash 2.0',
    gameVersionInt: 20,
    binaryVersionInt: 20,
    era: 'Creator Era (1.9–2.0)',
    highlights: '2.0: Robot Mode, User Accounts, Move Triggers, User Coins',
    usesBase64Url: false,
    endpointSuffix: '20',
    maxUrlByteLength: 33,
    supportsAccounts: true,
    supportsCustomSongs: true,
    supportsMapPacks: true,
    supportsGauntlets: false,
    maxGauntletId: 0,
  },
  {
    id: '2.1',
    label: 'Geometry Dash 2.1',
    gameVersionInt: 21,
    binaryVersionInt: 33,
    era: 'Modern Era (2.1–2.2)',
    highlights: '2.1: Spider Mode, Fingerdash, Gauntlets (1–15), Daily/Weekly, Epic Rate',
    usesBase64Url: true,
    endpointSuffix: '21',
    maxUrlByteLength: 44,
    supportsAccounts: true,
    supportsCustomSongs: true,
    supportsMapPacks: true,
    supportsGauntlets: true,
    maxGauntletId: 15,
  },
  {
    id: '2.11',
    label: 'Geometry Dash 2.11',
    gameVersionInt: 21,
    binaryVersionInt: 35,
    era: 'Modern Era (2.1–2.2)',
    highlights: '2.11: Updated 2.1 Build, Gauntlets (1–15), Weekly Demons, 4x Speed',
    usesBase64Url: true,
    endpointSuffix: '21',
    maxUrlByteLength: 44,
    supportsAccounts: true,
    supportsCustomSongs: true,
    supportsMapPacks: true,
    supportsGauntlets: true,
    maxGauntletId: 15,
  },
  {
    id: '2.2',
    label: 'Geometry Dash 2.2',
    gameVersionInt: 22,
    binaryVersionInt: 42,
    era: 'Modern Era (2.1–2.2)',
    highlights: '2.2: Platformer Mode, Camera Controls, Swing Copter, Gauntlets (1–60), Lists',
    usesBase64Url: true,
    endpointSuffix: '21',
    maxUrlByteLength: 44,
    supportsAccounts: true,
    supportsCustomSongs: true,
    supportsMapPacks: true,
    supportsGauntlets: true,
    maxGauntletId: 60,
  },
];

export function getGdVersionSpec(versionId: string): GdVersionSpec {
  const found = GD_VERSIONS.find((v) => v.id === versionId);
  if (!found) {
    throw new Error(`Unsupported Geometry Dash version: ${versionId}`);
  }
  return found;
}
