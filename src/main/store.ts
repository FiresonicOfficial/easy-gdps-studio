import fs from 'node:fs';
import path from 'node:path';
import type { GdpsServerConfig } from '../shared/types';
import { getServersStorePath } from './paths';

/**
 * Reads the persisted list of GDPS server configurations from `servers.json`.
 */
export function loadServers(): GdpsServerConfig[] {
  const storePath = getServersStorePath();
  if (!fs.existsSync(storePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(storePath, 'utf8').trim();
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as GdpsServerConfig[];
  } catch (err) {
    console.error('[Store] Failed to parse servers.json:', err);
    return [];
  }
}

/**
 * Atomically persists the full GDPS server configuration list to `servers.json`.
 */
export function saveServers(servers: GdpsServerConfig[]): void {
  const storePath = getServersStorePath();
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = `${storePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(servers, null, 2), 'utf8');
  fs.renameSync(tempPath, storePath);
}

/**
 * Looks up a single GDPS server configuration by its ID.
 */
export function getServerById(id: string): GdpsServerConfig | undefined {
  return loadServers().find((server) => server.id === id);
}

/**
 * Inserts a new server configuration or replaces an existing entry with the same ID.
 */
export function upsertServer(config: GdpsServerConfig): GdpsServerConfig {
  const servers = loadServers();
  const index = servers.findIndex((server) => server.id === config.id);
  if (index >= 0) {
    servers[index] = config;
  } else {
    servers.push(config);
  }
  saveServers(servers);
  return config;
}

/**
 * Removes a server configuration by ID from `servers.json`.
 */
export function removeServer(id: string): void {
  const servers = loadServers();
  const filtered = servers.filter((server) => server.id !== id);
  if (filtered.length !== servers.length) {
    saveServers(filtered);
  }
}
