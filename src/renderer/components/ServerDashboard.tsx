import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Info,
  Play,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  Smartphone,
  Square,
  Trash2,
  XCircle,
} from 'lucide-react';
import { getGdVersionSpec } from '@shared/gdVersions';
import type {
  GdpsServerConfig,
  RuntimeStatus,
  ServerLiveState,
} from '@shared/types';
import { CopyButton, NetworkModeBadge, ServerStatusBadge } from './uiHelpers';

interface ServerDashboardProps {
  servers: GdpsServerConfig[];
  liveStates: Record<string, ServerLiveState>;
  runtimeStatus: RuntimeStatus | null;
  onRefreshRuntime: () => Promise<void>;
  onCreateNew: () => void;
  onManageServer: (serverId: string) => void;
  onStartServer: (serverId: string) => Promise<void>;
  onStopServer: (serverId: string) => Promise<void>;
  onDeleteServer: (serverId: string) => Promise<void>;
}

interface RuntimeItem {
  key: string;
  label: string;
  ready: boolean;
  path: string | null;
  requiredFor: string;
  optional?: boolean;
}

export const ServerDashboard: React.FC<ServerDashboardProps> = ({
  servers,
  liveStates,
  runtimeStatus,
  onRefreshRuntime,
  onCreateNew,
  onManageServer,
  onStartServer,
  onStopServer,
  onDeleteServer,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [refreshingRuntime, setRefreshingRuntime] = useState(false);
  const [pendingDeleteServer, setPendingDeleteServer] = useState<GdpsServerConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteTitleId = useId();
  const searchInputId = useId();

  const runtimeItems: RuntimeItem[] = useMemo(() => {
    if (!runtimeStatus) return [];
    return [
      {
        key: 'php',
        label: 'PHP 8.2+',
        ready: runtimeStatus.phpReady,
        path: runtimeStatus.phpPath,
        requiredFor: 'GDPS Server Core',
      },
      {
        key: 'zipalign',
        label: 'zipalign',
        ready: runtimeStatus.zipalignReady,
        path: runtimeStatus.zipalignPath,
        requiredFor: 'APK Alignment',
        optional: true,
      },
      {
        key: 'signer',
        label: 'uber-apk-signer',
        ready: runtimeStatus.uberApkSignerReady,
        path: runtimeStatus.uberApkSignerPath,
        requiredFor: 'APK Signing',
        optional: true,
      },
      {
        key: 'java',
        label: 'Java (JRE)',
        ready: runtimeStatus.javaReady,
        path: runtimeStatus.javaPath,
        requiredFor: 'APK Signing Runtime',
        optional: true,
      },
      {
        key: 'cloudflared',
        label: 'cloudflared',
        ready: runtimeStatus.cloudflaredReady,
        path: runtimeStatus.cloudflaredPath,
        requiredFor: 'Public Share Quick Tunnel',
        optional: true,
      },
    ];
  }, [runtimeStatus]);

  const missingAndroidTools = useMemo(() => {
    if (!runtimeStatus) return false;
    return !(
      runtimeStatus.javaReady &&
      runtimeStatus.zipalignReady &&
      runtimeStatus.uberApkSignerReady
    );
  }, [runtimeStatus]);

  const filteredServers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return servers;
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.version.toLowerCase().includes(q) ||
        s.networkMode.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q)
    );
  }, [servers, searchQuery]);

  // Open native modal dialog when pendingDeleteServer is set
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    if (pendingDeleteServer && !dialog.open) {
      dialog.showModal();
    }
  }, [pendingDeleteServer]);

  // Light-dismiss fallback for browsers lacking closedBy support
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close('cancel');
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const handleDialogClose = () => {
    const dialog = deleteDialogRef.current;
    if (dialog) {
      dialog.returnValue = '';
    }
    if (!deleting) {
      setPendingDeleteServer(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDeleteServer) return;
    setDeleting(true);
    try {
      await onDeleteServer(pendingDeleteServer.id);
      deleteDialogRef.current?.close('delete');
      setPendingDeleteServer(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleRefreshRuntime = async () => {
    setRefreshingRuntime(true);
    try {
      await onRefreshRuntime();
    } finally {
      setRefreshingRuntime(false);
    }
  };

  const handleToggleServer = async (serverId: string, isRunning: boolean) => {
    setBusyServerId(serverId);
    try {
      if (isRunning) {
        await onStopServer(serverId);
      } else {
        await onStartServer(serverId);
      }
    } finally {
      setBusyServerId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Runtime Readiness Bar */}
      <section
        aria-label="Runtime Environment Readiness"
        className="rounded-2xl border border-gd-border bg-gd-panel/90 p-4 shadow-lg shadow-black/25"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-gd-cyan/30 bg-gd-cyan/10 text-gd-cyan">
              <Cpu className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Runtime Readiness</h2>
              <p className="text-xs text-slate-400">
                Bundled server &amp; client patching toolchain status
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRefreshRuntime}
            disabled={refreshingRuntime}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gd-border bg-gd-card px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-gd-cyan/50 hover:text-white disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-gd-cyan ${refreshingRuntime ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Re-check Runtimes</span>
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {!runtimeStatus ? (
            <span className="text-xs text-slate-400">Checking runtime tools...</span>
          ) : (
            runtimeItems.map((item) => (
              <div
                key={item.key}
                title={item.path ? `Detected: ${item.path}` : `Not found (${item.requiredFor})`}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium ${
                  item.ready
                    ? 'border-gd-green/35 bg-gd-green/10 text-emerald-200'
                    : item.optional
                      ? 'border-amber-400/35 bg-amber-400/10 text-amber-200'
                      : 'border-rose-500/45 bg-rose-500/10 text-rose-200'
                }`}
              >
                {item.ready ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-gd-green" aria-hidden="true" />
                ) : item.optional ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden="true" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />
                )}
                <span>{item.label}</span>
                <span className="text-[11px] opacity-75">
                  {item.ready ? 'Ready' : item.optional ? 'Optional' : 'Missing'}
                </span>
              </div>
            ))
          )}
        </div>

        {runtimeStatus && (!runtimeStatus.phpReady || !runtimeStatus.cloudflaredReady || missingAndroidTools) && (
          <div className="mt-3 space-y-1.5 rounded-xl border border-gd-border/80 bg-gd-bg/70 p-3 text-xs text-slate-300">
            {!runtimeStatus.phpReady && (
              <p className="flex items-start gap-2 text-rose-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  <strong>PHP 8.2+ is missing:</strong> Run{' '}
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-rose-200">
                    npm run fetch-runtimes
                  </code>{' '}
                  or place PHP binaries in <code className="font-mono">resources/runtime/php/</code>{' '}
                  to launch local GDPS servers.
                </span>
              </p>
            )}
            {!runtimeStatus.cloudflaredReady && (
              <p className="flex items-start gap-2 text-amber-200/90">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                <span>
                  <strong>Optional tool missing — cloudflared:</strong> Localhost and LAN / Radmin /
                  Hamachi modes work normally without it. To enable one-click{' '}
                  <em>Public Share Mode (Cloudflare Quick Tunnel)</em>, run{' '}
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-amber-100">
                    npm run fetch-runtimes
                  </code>{' '}
                  or drop <code className="font-mono">cloudflared.exe</code> into{' '}
                  <code className="font-mono">resources/runtime/cloudflared/</code>.
                </span>
              </p>
            )}
            {missingAndroidTools && (
              <p className="flex items-start gap-2 text-slate-300">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gd-cyan" aria-hidden="true" />
                <span>
                  <strong>Android APK Signing:</strong> Building signed Android{' '}
                  <code className="font-mono">.apk</code> clients requires Java,{' '}
                  <code className="font-mono">zipalign</code>, and{' '}
                  <code className="font-mono">uber-apk-signer</code>. Windows{' '}
                  <code className="font-mono">.exe</code> client building still works without them.
                </span>
              </p>
            )}
          </div>
        )}
      </section>

      {/* My Servers Header & Actions */}
      <section aria-labelledby="my-servers-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 id="my-servers-heading" className="text-2xl font-bold tracking-tight text-white">
              My GDPS Servers
            </h1>
            <p className="mt-0.5 text-sm text-slate-400">
              Launch, share, and moderate Geometry Dash private servers from 1.0 to 2.2.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {servers.length > 0 && (
              <search>
                <form
                  onSubmit={(e) => e.preventDefault()}
                  className="relative"
                >
                  <label htmlFor={searchInputId} className="visually-hidden">
                    Filter servers by name or version
                  </label>
                  <input
                    id={searchInputId}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter servers..."
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-52 rounded-xl border border-gd-border bg-gd-panel px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-gd-cyan focus:outline-none"
                  />
                </form>
              </search>
            )}

            <button
              type="button"
              onClick={onCreateNew}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gd-cyan to-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-gd-cyan/20 transition hover:brightness-110 active:translate-y-px"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
              <span>+ Create New GDPS Server</span>
            </button>
          </div>
        </div>

        {/* Empty State */}
        {servers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gd-border bg-gd-panel/60 px-6 py-14 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-gd-cyan/40 bg-gd-cyan/10 text-gd-cyan shadow-lg shadow-gd-cyan/10">
              <Server className="h-7 w-7" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-white">No GDPS Servers Yet</h2>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-400">
              Create your first Geometry Dash Private Server for any era from 1.0 to 2.2 with
              automatic Windows <code className="font-mono text-slate-200">.exe</code> and Android{' '}
              <code className="font-mono text-slate-200">.apk</code> client generation.
            </p>
            <button
              type="button"
              onClick={onCreateNew}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gd-cyan to-gd-green px-5 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-gd-cyan/20 transition hover:brightness-110"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
              <span>+ Create New GDPS Server</span>
            </button>
          </div>
        ) : filteredServers.length === 0 ? (
          <div className="rounded-2xl border border-gd-border bg-gd-panel/60 p-8 text-center text-sm text-slate-400">
            No servers match &ldquo;{searchQuery}&rdquo;.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {filteredServers.map((server) => {
              const live = liveStates[server.id];
              const status = live?.status ?? 'stopped';
              const isRunning = status === 'running';
              const isStarting = status === 'starting';
              const isBusy = busyServerId === server.id || isStarting;
              const versionSpec = getGdVersionSpec(server.version);
              const activeUrl =
                live?.tunnelUrl || live?.publicUrl || live?.localUrl || `http://127.0.0.1:${server.port}`;

              return (
                <article
                  key={server.id}
                  className="group flex flex-col justify-between rounded-2xl border border-gd-border bg-gd-card/90 p-5 shadow-lg shadow-black/25 transition hover:border-gd-cyan/50"
                >
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-lg font-bold text-white">{server.name}</h3>
                          <span className="rounded-md border border-gd-gold/40 bg-gd-gold/10 px-2 py-0.5 font-mono text-xs font-bold text-gd-gold">
                            v{server.version}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {versionSpec.era} &bull; Port <span className="font-mono">{server.port}</span>
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <NetworkModeBadge mode={server.networkMode} />
                        <ServerStatusBadge status={status} />
                      </div>
                    </div>

                    {/* URL Bar */}
                    <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-gd-border/90 bg-gd-bg/80 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {live?.tunnelUrl || server.networkMode === 'tunnel'
                            ? 'Public Tunnel URL'
                            : server.networkMode === 'vps'
                              ? 'VPS / Custom Domain URL'
                              : server.networkMode === 'vpn'
                                ? 'VPN URL'
                                : server.networkMode === 'lan'
                                  ? 'LAN / Wi-Fi URL'
                                  : 'Local Server URL'}
                        </div>
                        <div className="truncate font-mono text-xs text-gd-cyan">{activeUrl}</div>
                      </div>
                      <CopyButton text={activeUrl} label="Copy URL" />
                    </div>

                    {/* Client Badges */}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      {server.artifacts.windowsExePath ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                          <CheckCircle2 className="h-3 w-3 text-gd-green" aria-hidden="true" />
                          <span>Windows .exe Ready</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-slate-400">
                          <span>No .exe built</span>
                        </span>
                      )}

                      {server.artifacts.androidApkPath ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
                          <Smartphone className="h-3 w-3 text-gd-green" aria-hidden="true" />
                          <span>Android .apk Ready</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-slate-400">
                          <span>No .apk built</span>
                        </span>
                      )}

                      {server.artifacts.warnings.length > 0 && (
                        <span
                          title={server.artifacts.warnings.join('\n')}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-amber-200"
                        >
                          <AlertTriangle className="h-3 w-3 text-amber-300" aria-hidden="true" />
                          <span>{server.artifacts.warnings.length} Build Warning(s)</span>
                        </span>
                      )}
                    </div>

                    {live?.lastError && status === 'error' && (
                      <p className="mt-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-200">
                        {live.lastError}
                      </p>
                    )}
                  </div>

                  {/* Quick Actions */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-gd-border/70 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleToggleServer(server.id, isRunning)}
                        className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:opacity-50 ${
                          isRunning
                            ? 'border border-rose-500/45 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                            : 'bg-gd-green text-slate-950 shadow-md shadow-gd-green/20 hover:brightness-110'
                        }`}
                      >
                        {isRunning ? (
                          <>
                            <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                            <span>Stop</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                            <span>{isStarting ? 'Starting...' : 'Start'}</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onManageServer(server.id)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-gd-cyan/45 bg-gd-cyan/10 px-3.5 py-2 text-xs font-semibold text-gd-cyan transition hover:bg-gd-cyan/20"
                      >
                        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Manage</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setPendingDeleteServer(server)}
                      aria-label={`Delete ${server.name}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-gd-border bg-gd-panel px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Delete</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Accessible Native Confirmation Dialog (showModal) */}
      <dialog
        ref={deleteDialogRef}
        aria-labelledby={deleteTitleId}
        onClose={handleDialogClose}
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div className="rounded-2xl border border-gd-border bg-gd-panel p-6 shadow-2xl shadow-black/70">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/40 bg-rose-500/15 text-rose-300">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id={deleteTitleId} className="text-lg font-bold text-white">
                Delete GDPS Server?
              </h2>
              <p className="mt-1.5 text-sm text-slate-300">
                Are you sure you want to permanently delete{' '}
                <strong className="text-white">{pendingDeleteServer?.name}</strong> (v
                {pendingDeleteServer?.version})? This removes its SQLite database, uploaded levels,
                and generated Windows/Android clients.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-end gap-2.5">
            <button
              type="button"
              autoFocus
              disabled={deleting}
              onClick={() => deleteDialogRef.current?.close('cancel')}
              className="rounded-xl border border-gd-border bg-gd-card px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={confirmDelete}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>{deleting ? 'Deleting...' : 'Delete Server'}</span>
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
};
