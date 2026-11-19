import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Box, Loader2, RefreshCw, X } from 'lucide-react';
import type {
  GdpsServerConfig,
  RuntimeStatus,
  ServerLiveState,
  TemplateAvailability,
} from '@shared/types';
import { CreateServerWizard } from './components/CreateServerWizard';
import { ServerControlPanel } from './components/ServerControlPanel';
import { ServerDashboard } from './components/ServerDashboard';

type AppView = 'dashboard' | 'create' | 'control';

export const App: React.FC = () => {
  const [view, setView] = useState<AppView>('dashboard');
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  const [appVersion, setAppVersion] = useState<string>('1.0.0');
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [templates, setTemplates] = useState<TemplateAvailability[]>([]);
  const [servers, setServers] = useState<GdpsServerConfig[]>([]);
  const [liveStates, setLiveStates] = useState<Record<string, ServerLiveState>>({});

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const hasBridge = typeof window !== 'undefined' && Boolean(window.easyGdps);

  const loadAll = useCallback(async () => {
    if (!window.easyGdps) {
      setLoadingInitial(false);
      return;
    }

    setGlobalError(null);
    try {
      const [info, runtime, matrix, serverList] = await Promise.all([
        window.easyGdps.getAppInfo(),
        window.easyGdps.getRuntimeStatus(),
        window.easyGdps.getTemplateMatrix(),
        window.easyGdps.listServers(),
      ]);

      setAppVersion(info.version);
      setRuntimeStatus(runtime);
      setTemplates(matrix);
      setServers(serverList);

      const statesEntries = await Promise.all(
        serverList.map(async (srv) => {
          try {
            const st = await window.easyGdps.getServerLiveState(srv.id);
            return [srv.id, st] as const;
          } catch {
            return [
              srv.id,
              {
                id: srv.id,
                status: 'stopped' as const,
                localUrl: `http://127.0.0.1:${srv.port}`,
                publicUrl: `http://127.0.0.1:${srv.port}`,
                tunnelStatus: 'inactive' as const,
                logs: [],
              },
            ] as const;
          }
        })
      );

      setLiveStates(Object.fromEntries(statesEntries));
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Failed to initialize EasyGDPS Studio data.'
      );
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!hasBridge) return;
    const unsubscribe = window.easyGdps.onServerUpdate((state) => {
      setLiveStates((prev) => ({
        ...prev,
        [state.id]: state,
      }));
    });
    return () => {
      unsubscribe();
    };
  }, [hasBridge]);

  const refreshRuntimeAndTemplates = async () => {
    if (!window.easyGdps) return;
    try {
      const [runtime, matrix] = await Promise.all([
        window.easyGdps.getRuntimeStatus(),
        window.easyGdps.getTemplateMatrix(),
      ]);
      setRuntimeStatus(runtime);
      setTemplates(matrix);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to refresh runtime status.');
    }
  };

  const handleStartServer = async (serverId: string) => {
    setGlobalError(null);
    try {
      const nextState = await window.easyGdps.startServer(serverId);
      setLiveStates((prev) => ({ ...prev, [serverId]: nextState }));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to start GDPS server.');
    }
  };

  const handleStopServer = async (serverId: string) => {
    setGlobalError(null);
    try {
      const nextState = await window.easyGdps.stopServer(serverId);
      setLiveStates((prev) => ({ ...prev, [serverId]: nextState }));
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to stop GDPS server.');
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    setGlobalError(null);
    try {
      await window.easyGdps.deleteServer(serverId);
      setServers((prev) => prev.filter((s) => s.id !== serverId));
      setLiveStates((prev) => {
        const copy = { ...prev };
        delete copy[serverId];
        return copy;
      });
      if (selectedServerId === serverId) {
        setSelectedServerId(null);
        setView('dashboard');
      }
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : 'Failed to delete GDPS server.');
      throw err;
    }
  };

  const handleCreatedServer = async (result: {
    server: GdpsServerConfig;
    liveState: ServerLiveState;
  }) => {
    setServers((prev) => [result.server, ...prev.filter((s) => s.id !== result.server.id)]);
    setLiveStates((prev) => ({ ...prev, [result.server.id]: result.liveState }));
    setSelectedServerId(result.server.id);
    setView('control');
    await refreshRuntimeAndTemplates();
  };

  const handleServerUpdated = (updated: GdpsServerConfig, updatedLive?: ServerLiveState) => {
    setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    if (updatedLive) {
      setLiveStates((prev) => ({ ...prev, [updated.id]: updatedLive }));
    }
    refreshRuntimeAndTemplates();
  };

  const activeServer = useMemo(
    () => servers.find((s) => s.id === selectedServerId) ?? null,
    [servers, selectedServerId]
  );

  const activeLiveState: ServerLiveState | null = useMemo(() => {
    if (!activeServer) return null;
    return (
      liveStates[activeServer.id] ?? {
        id: activeServer.id,
        status: 'stopped',
        localUrl: `http://127.0.0.1:${activeServer.port}`,
        publicUrl: `http://127.0.0.1:${activeServer.port}`,
        tunnelStatus: 'inactive',
        logs: [],
      }
    );
  }, [activeServer, liveStates]);

  const runningCount = useMemo(
    () => Object.values(liveStates).filter((s) => s.status === 'running').length,
    [liveStates]
  );

  if (!hasBridge) {
    return (
      <main className="gd-grid-bg flex min-h-screen items-center justify-center p-6">
        <div className="max-w-lg rounded-2xl border border-amber-400/40 bg-gd-panel p-6 text-center shadow-2xl">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-300" aria-hidden="true" />
          <h1 className="mt-3 text-xl font-bold text-white">Electron Bridge Unavailable</h1>
          <p className="mt-2 text-sm text-slate-300">
            <code className="font-mono text-gd-cyan">window.easyGdps</code> is only available inside
            the EasyGDPS Studio desktop window. Please launch the Electron app via{' '}
            <code className="font-mono text-slate-100">npm run dev</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="gd-grid-bg flex min-h-screen flex-col">
      {/* Top Studio Header */}
      <header className="sticky top-0 z-20 border-b border-gd-border/90 bg-gd-bg/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-3.5">
          <button
            type="button"
            onClick={() => {
              setView('dashboard');
              setSelectedServerId(null);
            }}
            className="flex items-center gap-3 rounded-xl text-left transition hover:opacity-90"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-gd-cyan/60 bg-gradient-to-br from-gd-cyan/25 to-gd-purple/25 shadow-[0_0_16px_rgb(0_229_255/0.25)]">
              <Box className="h-5 w-5 text-gd-cyan" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-white">
                  EasyGDPS <span className="text-gd-cyan">Studio</span>
                </span>
                <span className="rounded-md border border-gd-border bg-gd-panel px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300">
                  v{appVersion}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                1.0 – 2.2 Geometry Dash Private Server &amp; Dual EXE/APK Builder
              </p>
            </div>
          </button>

          <div className="flex items-center gap-3 text-xs">
            <div className="hidden items-center gap-2 rounded-xl border border-gd-border bg-gd-panel px-3 py-1.5 sm:inline-flex">
              <span
                className={`h-2 w-2 rounded-full ${
                  runningCount > 0 ? 'bg-gd-green shadow-[0_0_8px_#38f26e]' : 'bg-slate-500'
                }`}
                aria-hidden="true"
              />
              <span className="text-slate-300">
                <strong className="font-mono text-white">{runningCount}</strong> /{' '}
                <span className="font-mono">{servers.length}</span> Active
              </span>
            </div>

            <button
              type="button"
              onClick={loadAll}
              title="Reload servers and runtime state"
              className="inline-flex items-center gap-1.5 rounded-xl border border-gd-border bg-gd-panel px-3 py-1.5 font-medium text-slate-300 transition hover:border-gd-cyan/50 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5 text-gd-cyan" aria-hidden="true" />
              <span>Sync</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-6">
        {globalError && (
          <div
            role="alert"
            className="mb-5 flex items-start justify-between gap-3 rounded-2xl border border-rose-500/45 bg-rose-500/15 px-4 py-3 text-sm text-rose-100"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
              <span>{globalError}</span>
            </div>
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              aria-label="Dismiss error"
              className="rounded-lg p-1 text-rose-200 hover:bg-rose-500/20 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {loadingInitial ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-slate-300">
            <Loader2 className="h-8 w-8 animate-spin text-gd-cyan" aria-hidden="true" />
            <p className="text-sm font-medium">Loading EasyGDPS Studio workspace...</p>
          </div>
        ) : view === 'create' ? (
          <CreateServerWizard
            templates={templates}
            runtimeStatus={runtimeStatus}
            onCancel={() => setView('dashboard')}
            onCreated={handleCreatedServer}
          />
        ) : view === 'control' && activeServer && activeLiveState ? (
          <ServerControlPanel
            server={activeServer}
            liveState={activeLiveState}
            runtimeStatus={runtimeStatus}
            templates={templates}
            onBack={() => {
              setView('dashboard');
              setSelectedServerId(null);
            }}
            onStartServer={handleStartServer}
            onStopServer={handleStopServer}
            onServerUpdated={handleServerUpdated}
          />
        ) : (
          <ServerDashboard
            servers={servers}
            liveStates={liveStates}
            runtimeStatus={runtimeStatus}
            onRefreshRuntime={refreshRuntimeAndTemplates}
            onCreateNew={() => setView('create')}
            onManageServer={(serverId) => {
              setSelectedServerId(serverId);
              setView('control');
            }}
            onStartServer={handleStartServer}
            onStopServer={handleStopServer}
            onDeleteServer={handleDeleteServer}
          />
        )}
      </main>
    </div>
  );
};

export default App;
