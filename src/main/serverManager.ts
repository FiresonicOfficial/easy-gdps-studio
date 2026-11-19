import { execFile, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { getGdVersionSpec } from '../shared/gdVersions';
import type {
  ClientBuildArtifacts,
  CreateServerInput,
  GdpsCommentRecord,
  GdpsGauntletRecord,
  GdpsLevelRecord,
  GdpsMapPackRecord,
  GdpsServerConfig,
  GdpsStats,
  GdpsUserRecord,
  NetworkInterfaceInfo,
  NetworkMode,
  SaveGauntletPayload,
  SaveMapPackPayload,
  ServerLiveState,
} from '../shared/types';
import {
  buildClientsForServer,
  canFitDirectUrl,
  saveBaseClientToTemplate,
} from './clientBuilder';
import {
  getCloudflaredPath,
  getInstancesDir,
  getPhpExePath,
  getPhpIniPath,
  getServerTemplatesDir,
} from './paths';
import { getServerById, loadServers, removeServer, upsertServer } from './store';

const execFileAsync = promisify(execFile);

const MAX_LOG_LINES = 300;
const TUNNEL_URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const liveStates = new Map<string, ServerLiveState>();
const phpProcesses = new Map<string, ChildProcess>();
const tunnelProcesses = new Map<string, ChildProcess>();
const updateListeners = new Set<(state: ServerLiveState) => void>();

export interface RebuildClientsOptions {
  buildWindows?: boolean;
  buildAndroid?: boolean;
  customWindowsBasePath?: string;
  customAndroidBasePath?: string;
  saveCustomWindowsToTemplate?: boolean;
  saveCustomAndroidToTemplate?: boolean;
}

export interface AdminOverviewResponse {
  stats: GdpsStats;
  levels: GdpsLevelRecord[];
  users: GdpsUserRecord[];
  comments: GdpsCommentRecord[];
  mapPacks: GdpsMapPackRecord[];
  gauntlets: GdpsGauntletRecord[];
}

export interface AdminRateLevelPayload {
  levelID: number;
  stars: number;
  featured: number;
  epic: number;
  demon: number;
  auto: number;
}

/**
 * Registers a callback invoked whenever any server's live state or logs change.
 */
export function onServerStateUpdate(listener: (state: ServerLiveState) => void): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

function emitLiveState(state: ServerLiveState): void {
  const snapshot: ServerLiveState = {
    ...state,
    logs: [...state.logs],
  };
  for (const listener of updateListeners) {
    listener(snapshot);
  }
}

function getServerDir(serverId: string): string {
  return path.join(getInstancesDir(), serverId, 'server');
}

function getPublicDownloadsDir(serverId: string): string {
  return path.join(getInstancesDir(), serverId, 'public', 'downloads');
}

/**
 * Normalizes a user-supplied VPS / custom domain URL: trims whitespace and trailing
 * slashes, prepending `http://` when no explicit `http://` or `https://` protocol is given.
 */
function normalizeVpsUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) {
    return undefined;
  }
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return undefined;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

function computePublicUrl(server: GdpsServerConfig, tunnelUrl?: string): string {
  if (server.networkMode === 'tunnel') {
    return tunnelUrl ?? server.tunnelUrl ?? `http://127.0.0.1:${server.port}`;
  }
  if (server.networkMode === 'vps') {
    const normalizedVps = normalizeVpsUrl(server.vpsUrl);
    return normalizedVps ?? `http://${server.lanHost || '127.0.0.1'}:${server.port}`;
  }
  if (server.networkMode === 'lan' || server.networkMode === 'vpn') {
    return `http://${server.lanHost || '127.0.0.1'}:${server.port}`;
  }
  return `http://127.0.0.1:${server.port}`;
}

function getOrInitLiveState(server: GdpsServerConfig): ServerLiveState {
  const existing = liveStates.get(server.id);
  if (existing) {
    return existing;
  }

  const initial: ServerLiveState = {
    id: server.id,
    status: 'stopped',
    localUrl: `http://127.0.0.1:${server.port}`,
    publicUrl: computePublicUrl(server),
    tunnelUrl: server.tunnelUrl,
    tunnelStatus: 'inactive',
    logs: [],
  };
  liveStates.set(server.id, initial);
  return initial;
}

function appendLog(serverId: string, source: 'php' | 'tunnel' | 'system', rawText: string): void {
  const server = getServerById(serverId);
  const state = liveStates.get(serverId) ?? (server ? getOrInitLiveState(server) : null);
  if (!state) {
    return;
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return;
  }

  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  for (const line of lines) {
    state.logs.push(`[${timestamp}] [${source}] ${line}`);
  }
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs = state.logs.slice(state.logs.length - MAX_LOG_LINES);
  }
  emitLiveState(state);
}

function isCgnatAddress(address: string): boolean {
  const octets = address.split('.').map((part) => Number(part));
  return (
    octets.length === 4 &&
    octets[0] === 100 &&
    Number.isInteger(octets[1]) &&
    octets[1] >= 64 &&
    octets[1] <= 127
  );
}

function classifyNetworkInterface(
  name: string,
  address: string
): { kind: 'lan' | 'vpn' | 'virtual'; score: number } {
  const lower = name.toLowerCase();
  if (
    lower.includes('virtualbox') ||
    lower.includes('vmware') ||
    lower.includes('vethernet') ||
    lower.includes('hyper-v') ||
    lower.includes('vbox') ||
    address.startsWith('192.168.56.')
  ) {
    return { kind: 'virtual', score: 90 };
  }
  if (
    lower.includes('radmin') ||
    lower.includes('hamachi') ||
    lower.includes('zerotier') ||
    lower.includes('tailscale') ||
    lower.includes('wireguard') ||
    lower.includes('openvpn') ||
    lower.includes('nordlynx') ||
    lower.includes('protonvpn') ||
    address.startsWith('25.') ||
    address.startsWith('26.') ||
    isCgnatAddress(address)
  ) {
    return { kind: 'vpn', score: 40 };
  }
  if (lower.includes('wi-fi') || lower.includes('wifi') || lower.includes('wlan')) {
    return { kind: 'lan', score: 0 };
  }
  if (lower.includes('ethernet')) {
    return { kind: 'lan', score: 10 };
  }
  return { kind: 'lan', score: 25 };
}

/**
 * Lists usable non-internal IPv4 network interfaces classified as `lan`, `vpn`, or `virtual`,
 * ordered by LAN reachability (Wi-Fi / physical Ethernet first, VPNs next, virtual adapters last).
 */
export function getNetworkInterfaces(): NetworkInterfaceInfo[] {
  const interfaces = os.networkInterfaces();
  const results: Array<{
    name: string;
    address: string;
    kind: 'lan' | 'vpn' | 'virtual';
    score: number;
  }> = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) {
      continue;
    }
    for (const info of addresses) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
        const classified = classifyNetworkInterface(name, info.address);
        results.push({
          name,
          address: info.address,
          kind: classified.kind,
          score: classified.score,
        });
      }
    }
  }

  results.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return results.map(({ name, address, kind }) => ({ name, address, kind }));
}

function getPrimaryLanAddress(): string {
  const ifaces = getNetworkInterfaces();
  const lan = ifaces.find((iface) => iface.kind === 'lan');
  return lan?.address ?? ifaces[0]?.address ?? '127.0.0.1';
}

function getPrimaryVpnAddress(): string {
  const ifaces = getNetworkInterfaces();
  const vpn = ifaces.find((iface) => iface.kind === 'vpn');
  return vpn?.address ?? getPrimaryLanAddress();
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.unref();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, '0.0.0.0');
  });
}

/**
 * Finds the first available TCP port in `[8080..8999]` not used by another GDPS instance.
 */
async function findFreePort(startPort = 8080, endPort = 8999): Promise<number> {
  const reservedPorts = new Set(loadServers().map((server) => server.port));

  for (let port = startPort; port <= endPort; port += 1) {
    if (reservedPorts.has(port)) {
      continue;
    }
    if (await isPortFree(port)) {
      return port;
    }
  }

  throw new Error(`No available TCP port found in range ${startPort}-${endPort}.`);
}

const PROTECTED_SERVER_ROOT_ENTRIES = new Set([
  'server_config.json',
  'data',
  'public',
  'database.sqlite',
  'database.sqlite-wal',
  'database.sqlite-shm',
  'database.sqlite-journal',
]);

function copyDirectoryRecursive(
  srcDir: string,
  destDir: string,
  skipRootNames?: ReadonlySet<string>
): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') {
      continue;
    }
    if (skipRootNames && skipRootNames.has(entry.name.toLowerCase())) {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Synchronizes updated PHP core files and SQLite schema files from `server-templates/`
 * into an existing server instance without touching `server_config.json`, `data/`,
 * `public/`, or the instance's SQLite database.
 */
export function syncServerCoreFiles(serverId: string): void {
  const templatesDir = getServerTemplatesDir();
  const coreTemplateDir = path.join(templatesDir, 'core');
  const schemaTemplateDir = path.join(templatesDir, 'schema');
  const instanceDir = path.join(getInstancesDir(), serverId);
  const serverDir = getServerDir(serverId);

  if (fs.existsSync(coreTemplateDir)) {
    copyDirectoryRecursive(coreTemplateDir, serverDir, PROTECTED_SERVER_ROOT_ENTRIES);
  }
  if (fs.existsSync(schemaTemplateDir)) {
    copyDirectoryRecursive(schemaTemplateDir, path.join(instanceDir, 'schema'));
    copyDirectoryRecursive(schemaTemplateDir, path.join(serverDir, 'schema'));
  }
}

function generateAdminToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

function ensureAdminToken(config: GdpsServerConfig): string {
  if (!config.adminToken || !config.adminToken.trim()) {
    config.adminToken = generateAdminToken();
    if (getServerById(config.id)) {
      upsertServer(config);
    }
  }
  return config.adminToken;
}

function resolveClientTargetUrl(
  server: GdpsServerConfig,
  live?: ServerLiveState
): { targetUrl: string; fallbackLocalUrl: string } {
  const fallbackLocalUrl =
    server.lanHost && server.lanHost !== '127.0.0.1'
      ? `http://${server.lanHost}:${server.port}/db`
      : `http://127.0.0.1:${server.port}/db`;

  switch (server.networkMode) {
    case 'localhost':
      return {
        targetUrl: `http://127.0.0.1:${server.port}/db`,
        fallbackLocalUrl: `http://127.0.0.1:${server.port}/db`,
      };
    case 'lan':
      return {
        targetUrl: `http://${server.lanHost || getPrimaryLanAddress()}:${server.port}/db`,
        fallbackLocalUrl,
      };
    case 'vpn':
      return {
        targetUrl: `http://${server.lanHost || getPrimaryVpnAddress()}:${server.port}/db`,
        fallbackLocalUrl,
      };
    case 'vps':
      return {
        targetUrl: normalizeVpsUrl(server.vpsUrl) ?? fallbackLocalUrl,
        fallbackLocalUrl,
      };
    case 'tunnel':
      return {
        targetUrl: live?.tunnelUrl ?? server.tunnelUrl ?? fallbackLocalUrl,
        fallbackLocalUrl,
      };
  }
}

function sanitizeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'gdps';
}

function writeServerConfigJson(config: GdpsServerConfig): void {
  const serverDir = getServerDir(config.id);
  const downloadsDir = getPublicDownloadsDir(config.id);
  const spec = getGdVersionSpec(config.version);
  const adminToken = ensureAdminToken(config);
  const normalizedVpsUrl = normalizeVpsUrl(config.vpsUrl);

  fs.mkdirSync(serverDir, { recursive: true });
  const serverConfigPayload = {
    id: config.id,
    name: config.name,
    slug: config.slug,
    version: config.version,
    gameVersion: spec.gameVersionInt,
    binaryVersion: spec.binaryVersionInt,
    endpointSuffix: spec.endpointSuffix,
    supportsAccounts: spec.supportsAccounts,
    supportsCustomSongs: spec.supportsCustomSongs,
    supportsMapPacks: spec.supportsMapPacks,
    supportsGauntlets: spec.supportsGauntlets,
    maxGauntletId: spec.maxGauntletId,
    port: config.port,
    networkMode: config.networkMode,
    lanHost: config.lanHost,
    vpsUrl: normalizedVpsUrl ?? null,
    tunnelUrl: config.tunnelUrl ?? null,
    publicUrl: computePublicUrl(config),
    adminToken,
    publicDownloadsDir: downloadsDir,
    downloadsDir,
    dbPath: path.join(serverDir, 'database.sqlite'),
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };

  fs.writeFileSync(
    path.join(serverDir, 'server_config.json'),
    JSON.stringify(serverConfigPayload, null, 2),
    'utf8'
  );
}

/**
 * Creates a new isolated GDPS instance, initializes its SQLite database, builds
 * selected game clients, and persists the configuration.
 */
export async function createServerInstance(
  input: CreateServerInput
): Promise<{ server: GdpsServerConfig; liveState: ServerLiveState }> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error('Server name cannot be empty.');
  }

  getGdVersionSpec(input.version);

  const templatesDir = getServerTemplatesDir();
  const coreTemplateDir = path.join(templatesDir, 'core');
  const schemaTemplateDir = path.join(templatesDir, 'schema');

  if (!fs.existsSync(coreTemplateDir)) {
    throw new Error(
      `Server template core directory not found at "${coreTemplateDir}". Ensure server-templates/core/ is present.`
    );
  }

  const phpExe = getPhpExePath();
  if (!phpExe) {
    throw new Error(
      'Portable PHP runtime (php.exe) was not found. Run "npm run fetch-runtimes" or place PHP under resources/runtime/php/.'
    );
  }

  const slug = sanitizeSlug(trimmedName);
  const id = `${slug.slice(0, 20)}-${crypto.randomBytes(3).toString('hex')}`;
  const port = input.port ?? (await findFreePort(8080, 8999));
  const lanHost =
    input.lanHost?.trim() ||
    (input.networkMode === 'vpn' ? getPrimaryVpnAddress() : getPrimaryLanAddress());
  const vpsUrl = normalizeVpsUrl(input.vpsUrl);
  const adminToken = generateAdminToken();
  const now = new Date().toISOString();

  const instanceDir = path.join(getInstancesDir(), id);
  const serverDir = getServerDir(id);
  const downloadsDir = getPublicDownloadsDir(id);

  fs.mkdirSync(downloadsDir, { recursive: true });
  copyDirectoryRecursive(coreTemplateDir, serverDir);
  if (fs.existsSync(schemaTemplateDir)) {
    copyDirectoryRecursive(schemaTemplateDir, path.join(serverDir, 'schema'));
    copyDirectoryRecursive(schemaTemplateDir, path.join(instanceDir, 'schema'));
  }
  fs.mkdirSync(path.join(serverDir, 'data', 'levels'), { recursive: true });

  const serverConfig: GdpsServerConfig = {
    id,
    name: trimmedName,
    slug,
    version: input.version,
    port,
    networkMode: input.networkMode,
    lanHost,
    vpsUrl,
    adminToken,
    buildWindows: input.buildWindows,
    buildAndroid: input.buildAndroid,
    customWindowsBasePath: input.customWindowsBasePath,
    customAndroidBasePath: input.customAndroidBasePath,
    createdAt: now,
    updatedAt: now,
    artifacts: { warnings: [] },
  };

  writeServerConfigJson(serverConfig);

  const initDbPath = path.join(serverDir, 'init_db.php');
  if (fs.existsSync(initDbPath)) {
    const phpIni = getPhpIniPath();
    const phpArgs = phpIni
      ? ['-c', phpIni, '-r', "require 'init_db.php';"]
      : ['-r', "require 'init_db.php';"];

    await execFileAsync(phpExe, phpArgs, {
      cwd: serverDir,
      windowsHide: true,
    });
  }

  if (input.saveCustomWindowsToTemplate && input.customWindowsBasePath) {
    try {
      saveBaseClientToTemplate('windows', input.version, input.customWindowsBasePath);
    } catch (err) {
      serverConfig.artifacts.warnings.push(
        `Could not save Windows base file to templates: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (input.saveCustomAndroidToTemplate && input.customAndroidBasePath) {
    try {
      saveBaseClientToTemplate('android', input.version, input.customAndroidBasePath);
    } catch (err) {
      serverConfig.artifacts.warnings.push(
        `Could not save Android base APK to templates: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  if (input.buildWindows || input.buildAndroid) {
    const { targetUrl, fallbackLocalUrl } = resolveClientTargetUrl(serverConfig);

    const buildWarnings = [...serverConfig.artifacts.warnings];
    try {
      const built = await buildClientsForServer({
        serverId: id,
        version: input.version,
        serverBaseUrl: targetUrl,
        fallbackLocalUrl,
        buildWindows: input.buildWindows,
        buildAndroid: input.buildAndroid,
        customWindowsBasePath: input.customWindowsBasePath,
        customAndroidBasePath: input.customAndroidBasePath,
      });
      serverConfig.artifacts = {
        ...built,
        warnings: [...buildWarnings, ...built.warnings],
      };
    } catch (err) {
      serverConfig.artifacts = {
        warnings: [
          ...buildWarnings,
          `Client build skipped: ${err instanceof Error ? err.message : String(err)}`,
        ],
      };
    }
  }

  upsertServer(serverConfig);
  const liveState = getOrInitLiveState(serverConfig);
  appendLog(id, 'system', `Created EasyGDPS instance "${trimmedName}" (v${input.version}) on port ${port}.`);

  return { server: serverConfig, liveState: { ...liveState, logs: [...liveState.logs] } };
}

/**
 * Returns the current live runtime state for a server.
 */
export function getServerLiveState(serverId: string): ServerLiveState {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }
  const state = getOrInitLiveState(server);
  return { ...state, logs: [...state.logs] };
}

function waitForPortOpen(host: string, port: number, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          resolve(false);
        } else {
          setTimeout(attempt, 100);
        }
      });
    };
    attempt();
  });
}

function terminateChildProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.killed) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    proc.once('exit', finish);
    proc.kill();

    const forceTimer = setTimeout(() => {
      if (!settled && proc.pid) {
        if (process.platform === 'win32') {
          execFile('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {
            finish();
          });
        } else {
          proc.kill('SIGKILL');
          finish();
        }
      }
    }, 1500);

    proc.once('exit', () => clearTimeout(forceTimer));
  });
}

function startCloudflareTunnel(server: GdpsServerConfig, state: ServerLiveState): void {
  const cloudflaredExe = getCloudflaredPath();
  if (!cloudflaredExe) {
    state.tunnelStatus = 'error';
    appendLog(
      server.id,
      'tunnel',
      'cloudflared.exe was not found under resources/runtime/cloudflared/. Server is running locally without a public tunnel.'
    );
    emitLiveState(state);
    return;
  }

  state.tunnelStatus = 'starting';
  emitLiveState(state);
  appendLog(server.id, 'tunnel', `Starting Cloudflare Quick Tunnel for http://127.0.0.1:${server.port}...`);

  const tunnelProc = spawn(
    cloudflaredExe,
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${server.port}`],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  tunnelProcesses.set(server.id, tunnelProc);

  const handleOutput = (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    appendLog(server.id, 'tunnel', text);

    const match = text.match(TUNNEL_URL_REGEX);
    if (match) {
      const discoveredUrl = match[0];
      const isNewDiscovery = state.tunnelUrl !== discoveredUrl || state.tunnelStatus !== 'active';

      state.tunnelUrl = discoveredUrl;
      state.tunnelStatus = 'active';
      state.publicUrl = discoveredUrl;
      emitLiveState(state);

      const latest = getServerById(server.id);
      if (latest) {
        latest.tunnelUrl = discoveredUrl;
        latest.updatedAt = new Date().toISOString();
        upsertServer(latest);
        writeServerConfigJson(latest);
      }

      if (isNewDiscovery) {
        if (canFitDirectUrl(discoveredUrl)) {
          if (latest && (latest.buildWindows || latest.buildAndroid)) {
            appendLog(
              server.id,
              'tunnel',
              `Cloudflare Tunnel URL "${discoveredUrl}" fits within 33 bytes. Automatically rebuilding clients...`
            );
            void rebuildServerClients(server.id).catch((err) => {
              appendLog(
                server.id,
                'tunnel',
                `Automatic client rebuild for tunnel URL failed: ${err instanceof Error ? err.message : String(err)}`
              );
            });
          }
        } else {
          const byteLen = Buffer.byteLength(discoveredUrl, 'utf8');
          appendLog(
            server.id,
            'tunnel',
            `Cloudflare Quick Tunnel URL "${discoveredUrl}" is ${byteLen} bytes, which exceeds the 33-byte Geometry Dash binary URL slot. Use LAN, VPN (Radmin/Tailscale/ZeroTier), or a VPS/short domain (<= 33 chars) for direct EXE/APK patching — the tunnel still serves the Friend Download Portal.`
          );
        }
      }
    }
  };

  tunnelProc.stdout?.on('data', handleOutput);
  tunnelProc.stderr?.on('data', handleOutput);

  tunnelProc.once('error', (err) => {
    state.tunnelStatus = 'error';
    appendLog(server.id, 'tunnel', `Cloudflare tunnel error: ${err.message}`);
    emitLiveState(state);
  });

  tunnelProc.once('exit', (code) => {
    tunnelProcesses.delete(server.id);
    if (state.status === 'running' && state.tunnelStatus !== 'error') {
      state.tunnelStatus = 'inactive';
      appendLog(server.id, 'tunnel', `Cloudflare tunnel exited (code ${code ?? 'unknown'}).`);
      emitLiveState(state);
    }
  });
}

/**
 * Starts the embedded PHP built-in web server (and Cloudflare tunnel if enabled)
 * for the specified GDPS server instance.
 */
export async function startServer(serverId: string): Promise<ServerLiveState> {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const state = getOrInitLiveState(server);
  if (state.status === 'running' || state.status === 'starting') {
    return { ...state, logs: [...state.logs] };
  }

  const phpExe = getPhpExePath();
  if (!phpExe) {
    state.status = 'error';
    state.lastError =
      'Portable PHP executable (php.exe) was not found. Run "npm run fetch-runtimes" or place PHP in resources/runtime/php/.';
    emitLiveState(state);
    throw new Error(state.lastError);
  }

  const serverDir = getServerDir(server.id);
  if (!fs.existsSync(serverDir)) {
    state.status = 'error';
    state.lastError = `Server directory is missing: ${serverDir}`;
    emitLiveState(state);
    throw new Error(state.lastError);
  }

  // Synchronize PHP core and schema updates into the instance without touching config, data, or public.
  syncServerCoreFiles(server.id);
  if (!server.adminToken || !server.adminToken.trim()) {
    server.adminToken = generateAdminToken();
    server.updatedAt = new Date().toISOString();
    upsertServer(server);
  }
  writeServerConfigJson(server);

  const bindHost = server.networkMode === 'localhost' ? '127.0.0.1' : '0.0.0.0';
  const phpIni = getPhpIniPath();
  const routerPath = path.join(serverDir, 'router.php');

  const phpArgs: string[] = [];
  if (phpIni) {
    phpArgs.push('-c', phpIni);
  }
  phpArgs.push('-S', `${bindHost}:${server.port}`, '-t', serverDir);
  if (fs.existsSync(routerPath)) {
    phpArgs.push(routerPath);
  }

  state.status = 'starting';
  state.lastError = undefined;
  state.localUrl = `http://127.0.0.1:${server.port}`;
  state.publicUrl = computePublicUrl(server);
  state.tunnelStatus = 'inactive';
  emitLiveState(state);

  appendLog(server.id, 'system', `Starting PHP server on ${bindHost}:${server.port}...`);

  const phpProc = spawn(phpExe, phpArgs, {
    cwd: serverDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  phpProcesses.set(server.id, phpProc);
  state.pid = phpProc.pid;

  phpProc.stdout?.on('data', (chunk: Buffer) => {
    appendLog(server.id, 'php', chunk.toString('utf8'));
  });
  phpProc.stderr?.on('data', (chunk: Buffer) => {
    appendLog(server.id, 'php', chunk.toString('utf8'));
  });

  let earlyError: string | null = null;
  phpProc.once('error', (err) => {
    earlyError = err.message;
    state.status = 'error';
    state.pid = undefined;
    state.lastError = `Failed to start PHP server: ${err.message}`;
    appendLog(server.id, 'system', state.lastError);
    emitLiveState(state);
  });

  phpProc.once('exit', (code) => {
    phpProcesses.delete(server.id);
    if (state.status !== 'stopped') {
      const wasRunning = state.status === 'running';
      state.status = code === 0 || !wasRunning ? 'stopped' : 'error';
      state.pid = undefined;
      if (code && code !== 0) {
        state.lastError = `PHP server exited unexpectedly with code ${code}.`;
      }
      appendLog(server.id, 'system', `PHP server stopped (exit code ${code ?? 'unknown'}).`);
      emitLiveState(state);
    }
  });

  const reachable = await waitForPortOpen('127.0.0.1', server.port, 3000);
  if (earlyError || phpProc.exitCode !== null) {
    throw new Error(state.lastError ?? earlyError ?? 'PHP server exited immediately after launch.');
  }

  if (!reachable) {
    await stopServer(server.id);
    state.status = 'error';
    state.lastError = `PHP server did not respond on 127.0.0.1:${server.port} within 3 seconds.`;
    emitLiveState(state);
    throw new Error(state.lastError);
  }

  state.status = 'running';
  emitLiveState(state);
  appendLog(server.id, 'system', `Server is live at ${state.localUrl}`);

  if (server.networkMode === 'tunnel') {
    startCloudflareTunnel(server, state);
  }

  return { ...state, logs: [...state.logs] };
}

/**
 * Stops the running PHP server and any active Cloudflare tunnel for an instance.
 */
export async function stopServer(serverId: string): Promise<ServerLiveState> {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const state = getOrInitLiveState(server);
  state.status = 'stopped';
  state.tunnelStatus = 'inactive';

  const tunnelProc = tunnelProcesses.get(serverId);
  if (tunnelProc) {
    tunnelProcesses.delete(serverId);
    await terminateChildProcess(tunnelProc);
  }

  const phpProc = phpProcesses.get(serverId);
  if (phpProc) {
    phpProcesses.delete(serverId);
    await terminateChildProcess(phpProc);
  }

  state.pid = undefined;
  state.publicUrl = computePublicUrl(server);
  appendLog(serverId, 'system', 'Server stopped.');
  emitLiveState(state);

  return { ...state, logs: [...state.logs] };
}

/**
 * Stops all active PHP and Cloudflare tunnel child processes prior to app quit.
 */
export async function stopAllServers(): Promise<void> {
  const ids = new Set<string>([...phpProcesses.keys(), ...tunnelProcesses.keys()]);
  await Promise.all(
    Array.from(ids).map(async (id) => {
      try {
        await stopServer(id);
      } catch {
        // Best-effort cleanup during shutdown.
      }
    })
  );
}

/**
 * Stops, deletes files, and removes a GDPS instance from the persistent store.
 */
export async function deleteServerInstance(serverId: string): Promise<void> {
  if (phpProcesses.has(serverId) || tunnelProcesses.has(serverId)) {
    await stopServer(serverId);
  }

  const instanceDir = path.join(getInstancesDir(), serverId);
  if (fs.existsSync(instanceDir)) {
    fs.rmSync(instanceDir, { recursive: true, force: true });
  }

  liveStates.delete(serverId);
  removeServer(serverId);
}

/**
 * Updates a server's network mode (`localhost`, `lan`, `vpn`, `vps`, or `tunnel`),
 * rebuilds enabled game clients, and restarts the server if it is currently running.
 */
export async function updateServerNetwork(
  serverId: string,
  networkMode: NetworkMode,
  lanHost?: string,
  vpsUrl?: string
): Promise<{ server: GdpsServerConfig; liveState: ServerLiveState }> {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const currentStatus = liveStates.get(serverId)?.status;
  const wasRunning = currentStatus === 'running' || currentStatus === 'starting';
  if (wasRunning) {
    await stopServer(serverId);
  }

  server.networkMode = networkMode;
  if (lanHost !== undefined && lanHost.trim()) {
    server.lanHost = lanHost.trim();
  } else if (networkMode === 'vpn') {
    const vpnInterfaces = getNetworkInterfaces().filter((iface) => iface.kind === 'vpn');
    if (
      vpnInterfaces.length > 0 &&
      !vpnInterfaces.some((iface) => iface.address === server.lanHost)
    ) {
      server.lanHost = vpnInterfaces[0].address;
    } else if (!server.lanHost) {
      server.lanHost = getPrimaryVpnAddress();
    }
  } else if (!server.lanHost) {
    server.lanHost = getPrimaryLanAddress();
  }

  if (vpsUrl !== undefined) {
    server.vpsUrl = normalizeVpsUrl(vpsUrl);
  }

  if (networkMode !== 'tunnel') {
    server.tunnelUrl = undefined;
  }
  ensureAdminToken(server);
  server.updatedAt = new Date().toISOString();

  upsertServer(server);
  writeServerConfigJson(server);

  if (server.buildWindows || server.buildAndroid) {
    try {
      await rebuildServerClients(serverId);
    } catch (err) {
      appendLog(
        serverId,
        'system',
        `Network changed, but automatic client rebuild failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const updatedServer = getServerById(serverId) ?? server;
  const state = getOrInitLiveState(updatedServer);
  state.tunnelUrl = updatedServer.tunnelUrl;
  state.publicUrl = computePublicUrl(updatedServer);
  emitLiveState(state);

  const finalState = wasRunning ? await startServer(serverId) : getServerLiveState(serverId);
  return { server: updatedServer, liveState: finalState };
}

/**
 * Rebuilds Windows and/or Android game clients for an existing GDPS server instance.
 */
export async function rebuildServerClients(
  serverId: string,
  options?: RebuildClientsOptions
): Promise<GdpsServerConfig> {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const buildWindows = options?.buildWindows ?? server.buildWindows;
  const buildAndroid = options?.buildAndroid ?? server.buildAndroid;
  const customWindowsBasePath = options?.customWindowsBasePath ?? server.customWindowsBasePath;
  const customAndroidBasePath = options?.customAndroidBasePath ?? server.customAndroidBasePath;

  if (options?.saveCustomWindowsToTemplate && customWindowsBasePath) {
    saveBaseClientToTemplate('windows', server.version, customWindowsBasePath);
  }
  if (options?.saveCustomAndroidToTemplate && customAndroidBasePath) {
    saveBaseClientToTemplate('android', server.version, customAndroidBasePath);
  }

  const live = liveStates.get(serverId);
  const { targetUrl, fallbackLocalUrl } = resolveClientTargetUrl(server, live);

  const artifacts: ClientBuildArtifacts = await buildClientsForServer({
    serverId: server.id,
    version: server.version,
    serverBaseUrl: targetUrl,
    fallbackLocalUrl,
    buildWindows,
    buildAndroid,
    customWindowsBasePath,
    customAndroidBasePath,
  });

  server.buildWindows = buildWindows;
  server.buildAndroid = buildAndroid;
  server.customWindowsBasePath = customWindowsBasePath;
  server.customAndroidBasePath = customAndroidBasePath;
  server.artifacts = artifacts;
  server.updatedAt = new Date().toISOString();

  upsertServer(server);
  appendLog(server.id, 'system', 'Rebuilt client packages.');
  return server;
}

/**
 * Sends an authenticated localhost HTTP request to the server's `admin_api.php` endpoint.
 */
export async function adminRequest<TResponse = unknown>(
  serverId: string,
  method: 'GET' | 'POST',
  action: string,
  body?: Record<string, unknown>
): Promise<TResponse> {
  const server = getServerById(serverId);
  if (!server) {
    throw new Error(`Server not found: ${serverId}`);
  }

  const state = getOrInitLiveState(server);
  if (state.status !== 'running') {
    throw new Error(
      'Server is currently stopped. Start the server before accessing the Admin Manager.'
    );
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (server.adminToken) {
    headers['X-EasyGDPS-Admin-Token'] = server.adminToken;
  }

  const endpoint = `http://127.0.0.1:${server.port}/admin_api.php?action=${encodeURIComponent(action)}`;
  const response = await fetch(endpoint, {
    method,
    headers,
    body: method === 'POST' && body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Admin API returned invalid JSON (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }

  if (!response.ok || parsed.ok === false || typeof parsed.error === 'string') {
    const message =
      typeof parsed.error === 'string'
        ? parsed.error
        : `Admin API request "${action}" failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const payload =
    'data' in parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
  return payload as TResponse;
}

/**
 * Fetches server statistics, levels, users, comments, map packs, and gauntlets from `admin_api.php`.
 */
export async function adminGetOverview(serverId: string): Promise<AdminOverviewResponse> {
  const raw = await adminRequest<Partial<AdminOverviewResponse>>(serverId, 'GET', 'overview');
  return {
    stats: raw.stats ?? {
      accountsCount: 0,
      usersCount: 0,
      levelsCount: 0,
      commentsCount: 0,
      songsCount: 0,
      mapPacksCount: 0,
      gauntletsCount: 0,
    },
    levels: Array.isArray(raw.levels) ? raw.levels : [],
    users: Array.isArray(raw.users) ? raw.users : [],
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    mapPacks: Array.isArray(raw.mapPacks) ? raw.mapPacks : [],
    gauntlets: Array.isArray(raw.gauntlets) ? raw.gauntlets : [],
  };
}

/**
 * Updates star rating and featured/epic flags for a level via `admin_api.php`.
 */
export async function adminRateLevel(
  serverId: string,
  payload: AdminRateLevelPayload
): Promise<void> {
  await adminRequest(serverId, 'POST', 'rateLevel', { ...payload });
}

/**
 * Deletes a level via `admin_api.php`.
 */
export async function adminDeleteLevel(serverId: string, levelID: number): Promise<void> {
  await adminRequest(serverId, 'POST', 'deleteLevel', { levelID });
}

/**
 * Deletes a level comment via `admin_api.php`.
 */
export async function adminDeleteComment(serverId: string, commentID: number): Promise<void> {
  await adminRequest(serverId, 'POST', 'deleteComment', { commentID });
}

/**
 * Toggles a user's ban state via `admin_api.php`.
 */
export async function adminToggleUserBan(
  serverId: string,
  userID: number,
  isBanned: number
): Promise<void> {
  await adminRequest(serverId, 'POST', 'toggleUserBan', { userID, isBanned });
}

/**
 * Creates or updates a Map Pack via `admin_api.php`.
 */
export async function adminSaveMapPack(
  serverId: string,
  payload: SaveMapPackPayload
): Promise<void> {
  await adminRequest(serverId, 'POST', 'saveMapPack', { ...payload });
}

/**
 * Deletes a Map Pack via `admin_api.php`.
 */
export async function adminDeleteMapPack(serverId: string, packID: number): Promise<void> {
  await adminRequest(serverId, 'POST', 'deleteMapPack', { packID });
}

/**
 * Creates or updates a Gauntlet slot via `admin_api.php`.
 */
export async function adminSaveGauntlet(
  serverId: string,
  payload: SaveGauntletPayload
): Promise<void> {
  await adminRequest(serverId, 'POST', 'saveGauntlet', { ...payload });
}

/**
 * Deletes a Gauntlet slot via `admin_api.php`.
 */
export async function adminDeleteGauntlet(serverId: string, gauntletID: number): Promise<void> {
  await adminRequest(serverId, 'POST', 'deleteGauntlet', { gauntletID });
}
