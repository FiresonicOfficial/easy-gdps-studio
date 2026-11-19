import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { EasyGdpsBridge, ServerLiveState } from '../shared/types';

const bridge: EasyGdpsBridge = {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),

  getRuntimeStatus: () => ipcRenderer.invoke('runtime:getStatus'),

  getTemplateMatrix: () => ipcRenderer.invoke('templates:getMatrix'),

  getNetworkInterfaces: () => ipcRenderer.invoke('network:getInterfaces'),

  listServers: () => ipcRenderer.invoke('servers:list'),

  getServerLiveState: (serverId) => ipcRenderer.invoke('servers:getLiveState', serverId),

  createServer: (input) => ipcRenderer.invoke('servers:create', input),

  deleteServer: (serverId) => ipcRenderer.invoke('servers:delete', serverId),

  startServer: (serverId) => ipcRenderer.invoke('servers:start', serverId),

  stopServer: (serverId) => ipcRenderer.invoke('servers:stop', serverId),

  updateServerNetwork: (serverId, networkMode, lanHost, vpsUrl) =>
    ipcRenderer.invoke('servers:updateNetwork', serverId, networkMode, lanHost, vpsUrl),

  rebuildClients: (serverId, options) =>
    ipcRenderer.invoke('servers:rebuildClients', serverId, options),

  pickBaseClientFile: (kind) => ipcRenderer.invoke('dialog:pickBaseClientFile', kind),

  openPathInShell: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),

  openExternalUrl: (url) => ipcRenderer.invoke('shell:openExternal', url),

  copyToClipboard: (text) => ipcRenderer.invoke('clipboard:writeText', text),

  adminGetOverview: (serverId) => ipcRenderer.invoke('admin:getOverview', serverId),

  adminRateLevel: (serverId, payload) => ipcRenderer.invoke('admin:rateLevel', serverId, payload),

  adminDeleteLevel: (serverId, levelID) =>
    ipcRenderer.invoke('admin:deleteLevel', serverId, levelID),

  adminDeleteComment: (serverId, commentID) =>
    ipcRenderer.invoke('admin:deleteComment', serverId, commentID),

  adminToggleUserBan: (serverId, userID, isBanned) =>
    ipcRenderer.invoke('admin:toggleUserBan', serverId, userID, isBanned),

  adminSaveMapPack: (serverId, payload) =>
    ipcRenderer.invoke('admin:saveMapPack', serverId, payload),

  adminDeleteMapPack: (serverId, packID) =>
    ipcRenderer.invoke('admin:deleteMapPack', serverId, packID),

  adminSaveGauntlet: (serverId, payload) =>
    ipcRenderer.invoke('admin:saveGauntlet', serverId, payload),

  adminDeleteGauntlet: (serverId, gauntletID) =>
    ipcRenderer.invoke('admin:deleteGauntlet', serverId, gauntletID),

  onServerUpdate: (callback) => {
    const listener = (_event: IpcRendererEvent, state: ServerLiveState) => {
      callback(state);
    };
    ipcRenderer.on('server:update', listener);
    return () => {
      ipcRenderer.removeListener('server:update', listener);
    };
  },
};

contextBridge.exposeInMainWorld('easyGdps', bridge);
