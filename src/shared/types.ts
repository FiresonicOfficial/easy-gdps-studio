import type { GdVersionId } from './gdVersions';

export type NetworkMode = 'localhost' | 'lan' | 'vpn' | 'vps' | 'tunnel';

export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  kind?: 'lan' | 'vpn' | 'virtual';
}

export interface TemplateAvailability {
  version: GdVersionId;
  windowsReady: boolean;
  windowsPath: string | null;
  windowsFileCount: number;
  androidReady: boolean;
  androidPath: string | null;
}

export interface ClientBuildArtifacts {
  windowsExePath?: string;
  windowsZipPath?: string;
  androidApkPath?: string;
  patchedUrl?: string;
  usedRedirector?: boolean;
  builtAt?: string;
  warnings: string[];
}

export interface GdpsServerConfig {
  id: string;
  name: string;
  slug: string;
  version: GdVersionId;
  port: number;
  networkMode: NetworkMode;
  lanHost: string;
  vpsUrl?: string;
  tunnelUrl?: string;
  adminToken?: string;
  buildWindows: boolean;
  buildAndroid: boolean;
  customWindowsBasePath?: string;
  customAndroidBasePath?: string;
  createdAt: string;
  updatedAt: string;
  artifacts: ClientBuildArtifacts;
}

export interface CreateServerInput {
  name: string;
  version: GdVersionId;
  port?: number;
  networkMode: NetworkMode;
  lanHost?: string;
  vpsUrl?: string;
  buildWindows: boolean;
  buildAndroid: boolean;
  customWindowsBasePath?: string;
  customAndroidBasePath?: string;
  saveCustomWindowsToTemplate?: boolean;
  saveCustomAndroidToTemplate?: boolean;
}

export interface RuntimeStatus {
  phpReady: boolean;
  phpPath: string | null;
  zipalignReady: boolean;
  zipalignPath: string | null;
  uberApkSignerReady: boolean;
  uberApkSignerPath: string | null;
  javaReady: boolean;
  javaPath: string | null;
  cloudflaredReady: boolean;
  cloudflaredPath: string | null;
}

export interface ServerLiveState {
  id: string;
  status: ServerStatus;
  pid?: number;
  localUrl: string;
  publicUrl: string;
  tunnelUrl?: string;
  tunnelStatus: 'inactive' | 'starting' | 'active' | 'error';
  lastError?: string;
  logs: string[];
}

export interface GdpsStats {
  accountsCount: number;
  usersCount: number;
  levelsCount: number;
  commentsCount: number;
  songsCount: number;
  mapPacksCount?: number;
  gauntletsCount?: number;
}

export interface GdpsLevelRecord {
  levelID: number;
  levelName: string;
  levelDesc: string;
  userID: number;
  userName: string;
  starStars: number;
  starFeatured: number;
  starEpic: number;
  starDemon: number;
  starAuto: number;
  downloads: number;
  likes: number;
  gameVersion: number;
  uploadDate: number;
}

export interface GdpsUserRecord {
  userID: number;
  accountID: number;
  userName: string;
  stars: number;
  demons: number;
  creatorPoints: number;
  isMod: number;
  isBanned: number;
}

export interface GdpsCommentRecord {
  commentID: number;
  levelID: number;
  userID: number;
  userName: string;
  comment: string;
  likes: number;
  timestamp: number;
}

export interface GdpsMapPackRecord {
  ID: number;
  name: string;
  levels: number[];
  stars: number;
  coins: number;
  difficulty: number;
  rgbcolors: string;
  colors2: string;
}

export interface GdpsGauntletRecord {
  ID: number;
  name: string;
  levels: [number, number, number, number, number];
  timestamp: number;
}

export interface SaveMapPackPayload {
  ID?: number;
  name: string;
  levels: [number, number, number];
  stars: number;
  coins: number;
  difficulty: number;
  rgbcolors: string;
  colors2: string;
}

export interface SaveGauntletPayload {
  ID: number;
  level1: number;
  level2: number;
  level3: number;
  level4: number;
  level5: number;
}

export interface EasyGdpsBridge {
  getAppInfo: () => Promise<{ version: string; appPath: string; userDataPath: string }>;
  getRuntimeStatus: () => Promise<RuntimeStatus>;
  getTemplateMatrix: () => Promise<TemplateAvailability[]>;
  getNetworkInterfaces: () => Promise<NetworkInterfaceInfo[]>;
  listServers: () => Promise<GdpsServerConfig[]>;
  getServerLiveState: (serverId: string) => Promise<ServerLiveState>;
  createServer: (input: CreateServerInput) => Promise<{
    server: GdpsServerConfig;
    liveState: ServerLiveState;
  }>;
  deleteServer: (serverId: string) => Promise<void>;
  startServer: (serverId: string) => Promise<ServerLiveState>;
  stopServer: (serverId: string) => Promise<ServerLiveState>;
  updateServerNetwork: (
    serverId: string,
    networkMode: NetworkMode,
    lanHost?: string,
    vpsUrl?: string
  ) => Promise<{ server: GdpsServerConfig; liveState: ServerLiveState }>;
  rebuildClients: (
    serverId: string,
    options?: {
      buildWindows?: boolean;
      buildAndroid?: boolean;
      customWindowsBasePath?: string;
      customAndroidBasePath?: string;
      saveCustomWindowsToTemplate?: boolean;
      saveCustomAndroidToTemplate?: boolean;
    }
  ) => Promise<GdpsServerConfig>;
  pickBaseClientFile: (kind: 'windows' | 'android') => Promise<string | null>;
  openPathInShell: (targetPath: string) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;
  // Admin API proxies
  adminGetOverview: (serverId: string) => Promise<{
    stats: GdpsStats;
    levels: GdpsLevelRecord[];
    users: GdpsUserRecord[];
    comments: GdpsCommentRecord[];
    mapPacks: GdpsMapPackRecord[];
    gauntlets: GdpsGauntletRecord[];
  }>;
  adminRateLevel: (
    serverId: string,
    payload: {
      levelID: number;
      stars: number;
      featured: number;
      epic: number;
      demon: number;
      auto: number;
    }
  ) => Promise<void>;
  adminDeleteLevel: (serverId: string, levelID: number) => Promise<void>;
  adminDeleteComment: (serverId: string, commentID: number) => Promise<void>;
  adminToggleUserBan: (serverId: string, userID: number, isBanned: number) => Promise<void>;
  adminSaveMapPack: (serverId: string, payload: SaveMapPackPayload) => Promise<void>;
  adminDeleteMapPack: (serverId: string, packID: number) => Promise<void>;
  adminSaveGauntlet: (serverId: string, payload: SaveGauntletPayload) => Promise<void>;
  adminDeleteGauntlet: (serverId: string, gauntletID: number) => Promise<void>;
  onServerUpdate: (callback: (state: ServerLiveState) => void) => () => void;
}
