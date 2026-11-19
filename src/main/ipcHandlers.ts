import fs from 'node:fs';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron';
import type {
  CreateServerInput,
  NetworkMode,
  SaveGauntletPayload,
  SaveMapPackPayload,
  ServerLiveState,
} from '../shared/types';
import { getTemplateMatrix } from './clientBuilder';
import { getRuntimeStatus } from './paths';
import {
  adminDeleteComment,
  adminDeleteGauntlet,
  adminDeleteLevel,
  adminDeleteMapPack,
  adminGetOverview,
  adminRateLevel,
  adminSaveGauntlet,
  adminSaveMapPack,
  adminToggleUserBan,
  createServerInstance,
  deleteServerInstance,
  getNetworkInterfaces,
  getServerLiveState,
  onServerStateUpdate,
  rebuildServerClients,
  startServer,
  stopServer,
  updateServerNetwork,
  type AdminRateLevelPayload,
  type RebuildClientsOptions,
} from './serverManager';
import { loadServers } from './store';

let handlersRegistered = false;

/**
 * Registers all Electron IPC handlers backing `EasyGdpsBridge` and forwards
 * live server state updates to active renderer windows.
 */
export function registerIpcHandlers(): () => void {
  if (handlersRegistered) {
    return () => {};
  }
  handlersRegistered = true;

  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    appPath: app.getAppPath(),
    userDataPath: app.getPath('userData'),
  }));

  ipcMain.handle('runtime:getStatus', () => getRuntimeStatus());

  ipcMain.handle('templates:getMatrix', () => getTemplateMatrix());

  ipcMain.handle('network:getInterfaces', () => getNetworkInterfaces());

  ipcMain.handle('servers:list', () => loadServers());

  ipcMain.handle('servers:getLiveState', (_event, serverId: string) =>
    getServerLiveState(serverId)
  );

  ipcMain.handle('servers:create', (_event, input: CreateServerInput) =>
    createServerInstance(input)
  );

  ipcMain.handle('servers:delete', (_event, serverId: string) =>
    deleteServerInstance(serverId)
  );

  ipcMain.handle('servers:start', (_event, serverId: string) => startServer(serverId));

  ipcMain.handle('servers:stop', (_event, serverId: string) => stopServer(serverId));

  ipcMain.handle(
    'servers:updateNetwork',
    (_event, serverId: string, networkMode: NetworkMode, lanHost?: string, vpsUrl?: string) =>
      updateServerNetwork(serverId, networkMode, lanHost, vpsUrl)
  );

  ipcMain.handle(
    'servers:rebuildClients',
    (_event, serverId: string, options?: RebuildClientsOptions) =>
      rebuildServerClients(serverId, options)
  );

  ipcMain.handle(
    'dialog:pickBaseClientFile',
    async (event, kind: 'windows' | 'android'): Promise<string | null> => {
      const ownerWindow = BrowserWindow.fromWebContents(event.sender);
      const isWindows = kind === 'windows';
      const dialogOptions: Electron.OpenDialogOptions = {
        title: isWindows
          ? 'Select Base Geometry Dash Windows Executable (.exe)'
          : 'Select Base Geometry Dash Android Package (.apk)',
        properties: ['openFile'],
        filters: isWindows
          ? [{ name: 'Windows Executable', extensions: ['exe'] }]
          : [{ name: 'Android APK Package', extensions: ['apk'] }],
      };

      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0];
    }
  );

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    if (!targetPath || !fs.existsSync(targetPath)) {
      throw new Error(`Target path does not exist: ${targetPath}`);
    }
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const openError = await shell.openPath(targetPath);
      if (openError) {
        throw new Error(`Failed to open directory: ${openError}`);
      }
    } else {
      shell.showItemInFolder(targetPath);
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Blocked external URL with unsupported protocol: ${parsed.protocol}`);
    }
    await shell.openExternal(parsed.toString());
  });

  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('admin:getOverview', (_event, serverId: string) => adminGetOverview(serverId));

  ipcMain.handle(
    'admin:rateLevel',
    (_event, serverId: string, payload: AdminRateLevelPayload) => adminRateLevel(serverId, payload)
  );

  ipcMain.handle('admin:deleteLevel', (_event, serverId: string, levelID: number) =>
    adminDeleteLevel(serverId, levelID)
  );

  ipcMain.handle('admin:deleteComment', (_event, serverId: string, commentID: number) =>
    adminDeleteComment(serverId, commentID)
  );

  ipcMain.handle(
    'admin:toggleUserBan',
    (_event, serverId: string, userID: number, isBanned: number) =>
      adminToggleUserBan(serverId, userID, isBanned)
  );

  ipcMain.handle(
    'admin:saveMapPack',
    (_event, serverId: string, payload: SaveMapPackPayload) => adminSaveMapPack(serverId, payload)
  );

  ipcMain.handle('admin:deleteMapPack', (_event, serverId: string, packID: number) =>
    adminDeleteMapPack(serverId, packID)
  );

  ipcMain.handle(
    'admin:saveGauntlet',
    (_event, serverId: string, payload: SaveGauntletPayload) => adminSaveGauntlet(serverId, payload)
  );

  ipcMain.handle('admin:deleteGauntlet', (_event, serverId: string, gauntletID: number) =>
    adminDeleteGauntlet(serverId, gauntletID)
  );

  const unsubscribe = onServerStateUpdate((state: ServerLiveState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('server:update', state);
      }
    }
  });

  return unsubscribe;
}
