import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  Ban,
  CheckCircle2,
  Crown,
  Download,
  ExternalLink,
  Flame,
  FolderOpen,
  Globe,
  Hammer,
  Heart,
  Laptop,
  Layers,
  Loader2,
  Map as MapIcon,
  MessageSquare,
  Monitor,
  Music,
  Play,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  Skull,
  Smartphone,
  Sparkles,
  Square,
  Star,
  Swords,
  Terminal,
  Trash2,
  UserCheck,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { getGauntletNameById, getGdVersionSpec } from '@shared/gdVersions';
import type {
  GdpsCommentRecord,
  GdpsGauntletRecord,
  GdpsLevelRecord,
  GdpsMapPackRecord,
  GdpsServerConfig,
  GdpsStats,
  GdpsUserRecord,
  NetworkInterfaceInfo,
  NetworkMode,
  RuntimeStatus,
  ServerLiveState,
  TemplateAvailability,
} from '@shared/types';
import { GauntletManagerSection } from './GauntletManagerSection';
import { MapPackManagerSection } from './MapPackManagerSection';
import {
  CopyButton,
  NetworkModeBadge,
  ServerStatusBadge,
  classifyInterfaceKind,
  formatUnixTimestamp,
  getFriendDownloadUrl,
  getVpsPatchByteInfo,
} from './uiHelpers';

type ControlTab = 'overview' | 'community';
type CommunitySubTab = 'moderation' | 'mappacks' | 'gauntlets';

type PendingDeleteTarget =
  | { kind: 'level'; record: GdpsLevelRecord }
  | { kind: 'mappack'; record: GdpsMapPackRecord }
  | { kind: 'gauntlet'; record: GdpsGauntletRecord };

interface ServerControlPanelProps {
  server: GdpsServerConfig;
  liveState: ServerLiveState;
  runtimeStatus: RuntimeStatus | null;
  templates: TemplateAvailability[];
  onBack: () => void;
  onStartServer: (serverId: string) => Promise<void>;
  onStopServer: (serverId: string) => Promise<void>;
  onServerUpdated: (server: GdpsServerConfig, liveState?: ServerLiveState) => void;
}

interface LevelDraftRating {
  stars: number;
  featured: boolean;
  epic: boolean;
  demon: boolean;
  auto: boolean;
}

export const ServerControlPanel: React.FC<ServerControlPanelProps> = ({
  server,
  liveState,
  runtimeStatus,
  templates,
  onBack,
  onStartServer,
  onStopServer,
  onServerUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<ControlTab>('overview');
  const [communitySubTab, setCommunitySubTab] = useState<CommunitySubTab>('moderation');
  const [togglingPower, setTogglingPower] = useState(false);

  // Network Switcher State
  const [networkModeDraft, setNetworkModeDraft] = useState<NetworkMode>(server.networkMode);
  const [lanHostDraft, setLanHostDraft] = useState<string>(server.lanHost || '');
  const [vpsUrlDraft, setVpsUrlDraft] = useState<string>(server.vpsUrl || '');
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [applyingNetwork, setApplyingNetwork] = useState(false);
  const [networkMessage, setNetworkMessage] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);

  // Rebuild Clients Drawer State
  const [showRebuildPanel, setShowRebuildPanel] = useState(false);
  const [rebuildWindows, setRebuildWindows] = useState(server.buildWindows);
  const [rebuildAndroid, setRebuildAndroid] = useState(server.buildAndroid);
  const [customWinPath, setCustomWinPath] = useState(server.customWindowsBasePath || '');
  const [customApkPath, setCustomApkPath] = useState(server.customAndroidBasePath || '');
  const [saveWinTemplate, setSaveWinTemplate] = useState(true);
  const [saveApkTemplate, setSaveApkTemplate] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildNotice, setRebuildNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Logs State
  const [autoScrollLogs, setAutoScrollLogs] = useState(true);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // Community / Admin State
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [stats, setStats] = useState<GdpsStats | null>(null);
  const [levels, setLevels] = useState<GdpsLevelRecord[]>([]);
  const [users, setUsers] = useState<GdpsUserRecord[]>([]);
  const [comments, setComments] = useState<GdpsCommentRecord[]>([]);
  const [mapPacks, setMapPacks] = useState<GdpsMapPackRecord[]>([]);
  const [gauntlets, setGauntlets] = useState<GdpsGauntletRecord[]>([]);
  const [communitySearch, setCommunitySearch] = useState('');
  const [levelDrafts, setLevelDrafts] = useState<Record<number, LevelDraftRating>>({});
  const [savingLevelId, setSavingLevelId] = useState<number | null>(null);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [busyCommentId, setBusyCommentId] = useState<number | null>(null);

  // Native Confirmation Dialog for Delete (Level / Map Pack / Gauntlet)
  const [deleteTarget, setDeleteTarget] = useState<PendingDeleteTarget | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteDialogTitleId = useId();

  const tabRefs = useRef<Record<ControlTab, HTMLButtonElement | null>>({
    overview: null,
    community: null,
  });
  const subTabRefs = useRef<Record<CommunitySubTab, HTMLButtonElement | null>>({
    moderation: null,
    mappacks: null,
    gauntlets: null,
  });
  const overviewTabId = useId();
  const communityTabId = useId();
  const subModTabId = useId();
  const subMapPacksTabId = useId();
  const subGauntletsTabId = useId();
  const lanSelectId = useId();
  const lanInputId = useId();
  const vpsInputId = useId();
  const communitySearchId = useId();

  const versionSpec = useMemo(() => getGdVersionSpec(server.version), [server.version]);
  const templateInfo = useMemo(
    () => templates.find((t) => t.version === server.version),
    [templates, server.version]
  );

  const lanInterfaces = useMemo(
    () => interfaces.filter((i) => classifyInterfaceKind(i) === 'lan'),
    [interfaces]
  );
  const vpnInterfaces = useMemo(
    () => interfaces.filter((i) => classifyInterfaceKind(i) === 'vpn'),
    [interfaces]
  );
  const otherInterfaces = useMemo(
    () => interfaces.filter((i) => classifyInterfaceKind(i) === 'virtual'),
    [interfaces]
  );
  const primaryLanInterface = lanInterfaces[0] ?? interfaces[0] ?? null;
  const vpsDraftByteInfo = useMemo(() => getVpsPatchByteInfo(vpsUrlDraft), [vpsUrlDraft]);

  const isRunning = liveState.status === 'running';
  const isStarting = liveState.status === 'starting';

  const activeBaseUrl = liveState.tunnelUrl || liveState.publicUrl || liveState.localUrl;
  const friendDownloadUrl = getFriendDownloadUrl(activeBaseUrl);

  // Sync drafts if server changes & ensure communitySubTab respects version capability
  useEffect(() => {
    setNetworkModeDraft(server.networkMode);
    setLanHostDraft(server.lanHost || '');
    setVpsUrlDraft(server.vpsUrl || '');
    setRebuildWindows(server.buildWindows);
    setRebuildAndroid(server.buildAndroid);
    setCustomWinPath(server.customWindowsBasePath || '');
    setCustomApkPath(server.customAndroidBasePath || '');
  }, [server]);

  useEffect(() => {
    if (communitySubTab === 'mappacks' && !versionSpec.supportsMapPacks) {
      setCommunitySubTab('moderation');
    } else if (communitySubTab === 'gauntlets' && !versionSpec.supportsGauntlets) {
      setCommunitySubTab('moderation');
    }
  }, [communitySubTab, versionSpec.supportsGauntlets, versionSpec.supportsMapPacks]);

  // Load network interfaces for LAN / VPN mode switcher
  useEffect(() => {
    window.easyGdps
      .getNetworkInterfaces()
      .then((list) => {
        setInterfaces(list);
        const preferredLan = list.find((i) => classifyInterfaceKind(i) === 'lan') ?? list[0];
        if (!lanHostDraft && preferredLan) {
          setLanHostDraft(preferredLan.address);
        }
      })
      .catch(() => setInterfaces([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScrollLogs && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [liveState.logs, autoScrollLogs]);

  // Fetch Admin overview
  const fetchAdminOverview = useCallback(async () => {
    if (!isRunning) return;
    setAdminLoading(true);
    setAdminError(null);
    try {
      const data = await window.easyGdps.adminGetOverview(server.id);
      setStats(data.stats);
      setLevels(data.levels);
      setUsers(data.users);
      setComments(data.comments);
      setMapPacks(data.mapPacks ?? []);
      setGauntlets(data.gauntlets ?? []);

      const drafts: Record<number, LevelDraftRating> = {};
      for (const lvl of data.levels) {
        drafts[lvl.levelID] = {
          stars: lvl.starStars,
          featured: lvl.starFeatured > 0,
          epic: lvl.starEpic > 0,
          demon: lvl.starDemon > 0,
          auto: lvl.starAuto > 0,
        };
      }
      setLevelDrafts(drafts);
    } catch (err) {
      setAdminError(
        err instanceof Error
          ? err.message
          : 'Unable to connect to the server Admin API. Ensure the server is running.'
      );
    } finally {
      setAdminLoading(false);
    }
  }, [isRunning, server.id]);

  useEffect(() => {
    if (activeTab === 'community' && isRunning) {
      fetchAdminOverview();
    }
  }, [activeTab, isRunning, fetchAdminOverview]);

  // Native delete confirmation dialog control
  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog) return;
    if (deleteTarget && !dialog.open) {
      dialog.showModal();
    }
  }, [deleteTarget]);

  useEffect(() => {
    const dialog = deleteDialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    let pressedOutside = false;
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) dialog.close('cancel');
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, []);

  const handleTogglePower = async () => {
    setTogglingPower(true);
    try {
      if (isRunning) {
        await onStopServer(server.id);
      } else {
        await onStartServer(server.id);
      }
    } finally {
      setTogglingPower(false);
    }
  };

  const handleSelectNetworkModeDraft = (mode: NetworkMode) => {
    setNetworkModeDraft(mode);
    setNetworkError(null);
    setNetworkMessage(null);
    if (mode === 'lan') {
      const bestLan = lanInterfaces[0] ?? interfaces[0];
      if (bestLan && (!lanHostDraft || vpnInterfaces.some((v) => v.address === lanHostDraft))) {
        setLanHostDraft(bestLan.address);
      }
    } else if (mode === 'vpn') {
      const bestVpn = vpnInterfaces[0];
      if (bestVpn && (!lanHostDraft || lanInterfaces.some((l) => l.address === lanHostDraft))) {
        setLanHostDraft(bestVpn.address);
      }
    }
  };

  const handleApplyNetworkMode = async (e: React.FormEvent) => {
    e.preventDefault();
    setNetworkMessage(null);
    setNetworkError(null);

    if ((networkModeDraft === 'lan' || networkModeDraft === 'vpn') && !lanHostDraft.trim()) {
      setNetworkError(
        networkModeDraft === 'vpn'
          ? 'Please select or enter your VPN IP address (Radmin VPN, Hamachi, or Tailscale).'
          : 'Please select or enter a LAN / Wi-Fi IP address.'
      );
      return;
    }

    if (networkModeDraft === 'vps') {
      const trimmedVps = vpsUrlDraft.trim();
      if (!trimmedVps) {
        setNetworkError('Please enter your VPS or custom domain URL (e.g. https://gd.myvps.com).');
        return;
      }
      if (!/^https?:\/\/.+/i.test(trimmedVps) || /\s/.test(trimmedVps)) {
        setNetworkError('VPS URL must begin with http:// or https:// and contain no spaces.');
        return;
      }
    }

    setApplyingNetwork(true);
    try {
      const res = await window.easyGdps.updateServerNetwork(
        server.id,
        networkModeDraft,
        networkModeDraft === 'lan' || networkModeDraft === 'vpn'
          ? lanHostDraft.trim()
          : undefined,
        networkModeDraft === 'vps' ? vpsUrlDraft.trim() : undefined
      );
      onServerUpdated(res.server, res.liveState);
      setNetworkMessage(
        'Network mode updated and clients automatically rebuilt for the active server endpoint.'
      );
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : 'Failed to update network mode.');
    } finally {
      setApplyingNetwork(false);
    }
  };

  const handlePickCustomFile = async (kind: 'windows' | 'android') => {
    const picked = await window.easyGdps.pickBaseClientFile(kind);
    if (!picked) return;
    if (kind === 'windows') {
      setCustomWinPath(picked);
      setRebuildWindows(true);
    } else {
      setCustomApkPath(picked);
      setRebuildAndroid(true);
    }
  };

  const handleRebuildClients = async (e: React.FormEvent) => {
    e.preventDefault();
    setRebuildNotice(null);
    setRebuilding(true);
    try {
      const updated = await window.easyGdps.rebuildClients(server.id, {
        buildWindows: rebuildWindows,
        buildAndroid: rebuildAndroid,
        customWindowsBasePath: customWinPath || undefined,
        customAndroidBasePath: customApkPath || undefined,
        saveCustomWindowsToTemplate: Boolean(customWinPath) && saveWinTemplate,
        saveCustomAndroidToTemplate: Boolean(customApkPath) && saveApkTemplate,
      });
      onServerUpdated(updated);
      setRebuildNotice({ type: 'ok', text: 'Clients rebuilt successfully!' });
      setShowRebuildPanel(false);
    } catch (err) {
      setRebuildNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Client rebuild failed.',
      });
    } finally {
      setRebuilding(false);
    }
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, current: ControlTab) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next: ControlTab =
        e.key === 'Home'
          ? 'overview'
          : e.key === 'End'
            ? 'community'
            : current === 'overview'
              ? 'community'
              : 'overview';
      setActiveTab(next);
      tabRefs.current[next]?.focus();
    }
  };

  const availableCommunitySubTabs = useMemo<CommunitySubTab[]>(() => {
    const list: CommunitySubTab[] = ['moderation'];
    if (versionSpec.supportsMapPacks) list.push('mappacks');
    if (versionSpec.supportsGauntlets) list.push('gauntlets');
    return list;
  }, [versionSpec.supportsGauntlets, versionSpec.supportsMapPacks]);

  const handleCommunitySubTabKeyDown = (e: React.KeyboardEvent, current: CommunitySubTab) => {
    const idx = availableCommunitySubTabs.indexOf(current);
    let next: CommunitySubTab | null = null;
    if (e.key === 'ArrowRight') {
      next = availableCommunitySubTabs[(idx + 1) % availableCommunitySubTabs.length];
    } else if (e.key === 'ArrowLeft') {
      next =
        availableCommunitySubTabs[
          (idx - 1 + availableCommunitySubTabs.length) % availableCommunitySubTabs.length
        ];
    } else if (e.key === 'Home') {
      next = availableCommunitySubTabs[0];
    } else if (e.key === 'End') {
      next = availableCommunitySubTabs[availableCommunitySubTabs.length - 1];
    }

    if (next) {
      e.preventDefault();
      setCommunitySubTab(next);
      subTabRefs.current[next]?.focus();
    }
  };

  const updateLevelDraft = (levelID: number, patch: Partial<LevelDraftRating>) => {
    setLevelDrafts((prev) => ({
      ...prev,
      [levelID]: {
        ...(prev[levelID] ?? {
          stars: 0,
          featured: false,
          epic: false,
          demon: false,
          auto: false,
        }),
        ...patch,
      },
    }));
  };

  const handleSaveLevelRating = async (levelID: number) => {
    const draft = levelDrafts[levelID];
    if (!draft) return;
    setSavingLevelId(levelID);
    setAdminError(null);
    try {
      await window.easyGdps.adminRateLevel(server.id, {
        levelID,
        stars: draft.stars,
        featured: draft.featured ? 1 : 0,
        epic: draft.epic ? 1 : 0,
        demon: draft.demon ? 1 : 0,
        auto: draft.auto ? 1 : 0,
      });
      await fetchAdminOverview();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to update level rating.');
    } finally {
      setSavingLevelId(null);
    }
  };

  const confirmDeleteTarget = async () => {
    if (!deleteTarget) return;
    setDeletingTarget(true);
    setAdminError(null);
    try {
      if (deleteTarget.kind === 'level') {
        await window.easyGdps.adminDeleteLevel(server.id, deleteTarget.record.levelID);
      } else if (deleteTarget.kind === 'mappack') {
        await window.easyGdps.adminDeleteMapPack(server.id, deleteTarget.record.ID);
      } else {
        await window.easyGdps.adminDeleteGauntlet(server.id, deleteTarget.record.ID);
      }
      deleteDialogRef.current?.close('delete');
      setDeleteTarget(null);
      await fetchAdminOverview();
    } catch (err) {
      setAdminError(
        err instanceof Error ? err.message : `Failed to delete ${deleteTarget.kind}.`
      );
    } finally {
      setDeletingTarget(false);
    }
  };

  const handleToggleUserBan = async (user: GdpsUserRecord) => {
    setBusyUserId(user.userID);
    setAdminError(null);
    try {
      await window.easyGdps.adminToggleUserBan(server.id, user.userID, user.isBanned ? 0 : 1);
      await fetchAdminOverview();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to update user ban status.');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDeleteComment = async (commentID: number) => {
    setBusyCommentId(commentID);
    setAdminError(null);
    try {
      await window.easyGdps.adminDeleteComment(server.id, commentID);
      await fetchAdminOverview();
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Failed to delete comment.');
    } finally {
      setBusyCommentId(null);
    }
  };

  const normalizedQuery = communitySearch.trim().toLowerCase();
  const filteredLevels = useMemo(() => {
    if (!normalizedQuery) return levels;
    return levels.filter(
      (l) =>
        l.levelName.toLowerCase().includes(normalizedQuery) ||
        l.userName.toLowerCase().includes(normalizedQuery) ||
        String(l.levelID).includes(normalizedQuery)
    );
  }, [levels, normalizedQuery]);

  const filteredUsers = useMemo(() => {
    if (!normalizedQuery) return users;
    return users.filter(
      (u) =>
        u.userName.toLowerCase().includes(normalizedQuery) ||
        String(u.userID).includes(normalizedQuery) ||
        String(u.accountID).includes(normalizedQuery)
    );
  }, [users, normalizedQuery]);

  const filteredComments = useMemo(() => {
    if (!normalizedQuery) return comments;
    return comments.filter(
      (c) =>
        c.comment.toLowerCase().includes(normalizedQuery) ||
        c.userName.toLowerCase().includes(normalizedQuery) ||
        String(c.levelID).includes(normalizedQuery)
    );
  }, [comments, normalizedQuery]);

  const tunnelStatusColor =
    liveState.tunnelStatus === 'active'
      ? 'border-gd-green/40 bg-gd-green/10 text-gd-green'
      : liveState.tunnelStatus === 'starting'
        ? 'border-gd-gold/40 bg-gd-gold/10 text-gd-gold'
        : liveState.tunnelStatus === 'error'
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          : 'border-slate-700 bg-slate-800/80 text-slate-400';

  return (
    <div className="space-y-6">
      {/* Step 3 Top Control Header */}
      <section
        aria-label="Server Control Header"
        className="rounded-2xl border border-gd-border bg-gd-panel/95 p-5 shadow-xl shadow-black/30"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gd-border bg-gd-card px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-gd-cyan/50 hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>My Servers</span>
              </button>

              <h1 className="text-2xl font-extrabold tracking-tight text-white">{server.name}</h1>

              <span className="rounded-md border border-gd-gold/40 bg-gd-gold/10 px-2 py-0.5 font-mono text-xs font-bold text-gd-gold">
                v{server.version}
              </span>

              <span className="rounded-md border border-gd-border bg-gd-bg px-2 py-0.5 font-mono text-[11px] text-slate-300">
                {versionSpec.usesBase64Url ? 'Base64 44B' : 'ASCII 33B'}
              </span>

              <NetworkModeBadge mode={server.networkMode} />
              <ServerStatusBadge status={liveState.status} />
            </div>

            <p className="text-xs text-slate-400">
              {versionSpec.label} &bull; {versionSpec.era} &bull; Port{' '}
              <span className="font-mono text-slate-300">{server.port}</span>
              {liveState.pid ? (
                <>
                  {' '}
                  &bull; PID <span className="font-mono text-slate-300">{liveState.pid}</span>
                </>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={!isRunning}
              onClick={() => window.easyGdps.openExternalUrl(friendDownloadUrl)}
              title={
                isRunning
                  ? `Open ${friendDownloadUrl}`
                  : 'Start the server first to open the Friend Download Page'
              }
              className="inline-flex items-center gap-2 rounded-xl border border-gd-cyan/45 bg-gd-cyan/10 px-4 py-2.5 text-xs font-bold text-gd-cyan transition hover:bg-gd-cyan/20 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              <span>Open Friend Download Page</span>
            </button>

            <button
              type="button"
              disabled={togglingPower || isStarting}
              onClick={handleTogglePower}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition disabled:opacity-50 ${
                isRunning
                  ? 'border border-rose-500/50 bg-rose-500/20 text-rose-100 hover:bg-rose-500/30'
                  : 'bg-gradient-to-r from-gd-green to-emerald-400 text-slate-950 shadow-lg shadow-gd-green/20 hover:brightness-110'
              }`}
            >
              {togglingPower || isStarting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>{isRunning ? 'Stopping...' : 'Starting...'}</span>
                </>
              ) : isRunning ? (
                <>
                  <Square className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>Stop Server</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>Start Server</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Active URLs & Network Mode Switcher */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Active URL Cards */}
          <div className="space-y-2.5 lg:col-span-6">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-gd-border bg-gd-bg/85 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Local Endpoint URL
                </div>
                <div className="truncate font-mono text-xs text-slate-100">
                  {liveState.localUrl}
                </div>
              </div>
              <CopyButton text={liveState.localUrl} label="Copy Local" />
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-gd-border bg-gd-bg/85 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>
                    {liveState.tunnelUrl || server.networkMode === 'tunnel'
                      ? 'Cloudflare Tunnel URL'
                      : server.networkMode === 'vps'
                        ? 'VPS / Custom Domain URL'
                        : server.networkMode === 'vpn'
                          ? 'VPN Share URL'
                          : server.networkMode === 'lan'
                            ? 'LAN / Wi-Fi Share URL'
                            : 'Public / Share URL'}
                  </span>
                  {server.networkMode === 'tunnel' && (
                    <span className={`rounded border px-1.5 py-0.2 text-[10px] ${tunnelStatusColor}`}>
                      Tunnel: {liveState.tunnelStatus}
                    </span>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-gd-cyan">
                  {liveState.tunnelUrl || liveState.publicUrl}
                </div>
              </div>
              <CopyButton
                text={liveState.tunnelUrl || liveState.publicUrl}
                label="Copy Share URL"
              />
            </div>
          </div>

          {/* Inline Network Mode Switcher */}
          <form
            onSubmit={handleApplyNetworkMode}
            className="flex flex-col justify-between rounded-xl border border-gd-border bg-gd-bg/65 p-3.5 lg:col-span-6"
          >
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Network Mode Switcher
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: 'localhost', label: 'Localhost', icon: Laptop, activeClass: 'border-gd-cyan bg-gd-cyan/15 text-gd-cyan' },
                      { id: 'lan', label: 'LAN', icon: Wifi, activeClass: 'border-gd-cyan bg-gd-cyan/15 text-gd-cyan' },
                      { id: 'vpn', label: 'VPN', icon: Shield, activeClass: 'border-gd-green bg-gd-green/15 text-gd-green' },
                      { id: 'vps', label: 'VPS', icon: Server, activeClass: 'border-gd-gold bg-gd-gold/15 text-gd-gold' },
                      { id: 'tunnel', label: 'Cloudflare', icon: Globe, activeClass: 'border-gd-purple bg-gd-purple/20 text-purple-200' },
                    ] as const
                  ).map((item) => {
                    const Icon = item.icon;
                    const active = networkModeDraft === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleSelectNetworkModeDraft(item.id)}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                          active
                            ? item.activeClass
                            : 'border-gd-border bg-gd-panel text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {networkModeDraft === 'lan' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={lanSelectId} className="visually-hidden">
                      Select LAN network interface
                    </label>
                    <select
                      id={lanSelectId}
                      value={interfaces.some((i) => i.address === lanHostDraft) ? lanHostDraft : ''}
                      onChange={(e) => {
                        if (e.target.value) setLanHostDraft(e.target.value);
                      }}
                      className="w-full rounded-lg border border-gd-border bg-gd-panel px-2.5 py-1.5 text-xs text-white focus:border-gd-cyan focus:outline-none"
                    >
                      <option value="">Select LAN interface...</option>
                      {lanInterfaces.length > 0 && (
                        <optgroup label="LAN / Wi-Fi">
                          {lanInterfaces.map((iface) => (
                            <option key={`lan-${iface.name}-${iface.address}`} value={iface.address}>
                              [LAN] {iface.name} ({iface.address})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {vpnInterfaces.length > 0 && (
                        <optgroup label="VPN">
                          {vpnInterfaces.map((iface) => (
                            <option key={`vpn-${iface.name}-${iface.address}`} value={iface.address}>
                              [VPN] {iface.name} ({iface.address})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {otherInterfaces.length > 0 && (
                        <optgroup label="Virtual">
                          {otherInterfaces.map((iface) => (
                            <option key={`virt-${iface.name}-${iface.address}`} value={iface.address}>
                              [Virtual] {iface.name} ({iface.address})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  <div>
                    <label htmlFor={lanInputId} className="visually-hidden">
                      LAN IP Address
                    </label>
                    <input
                      id={lanInputId}
                      type="text"
                      value={lanHostDraft}
                      onChange={(e) => setLanHostDraft(e.target.value)}
                      placeholder="LAN / Wi-Fi IP (e.g. 192.168.1.42)"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="w-full rounded-lg border border-gd-border bg-gd-panel px-2.5 py-1.5 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-gd-cyan focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {networkModeDraft === 'vpn' && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label htmlFor={lanSelectId} className="visually-hidden">
                      Select VPN network interface
                    </label>
                    <select
                      id={lanSelectId}
                      value={interfaces.some((i) => i.address === lanHostDraft) ? lanHostDraft : ''}
                      onChange={(e) => {
                        if (e.target.value) setLanHostDraft(e.target.value);
                      }}
                      className="w-full rounded-lg border border-gd-border bg-gd-panel px-2.5 py-1.5 text-xs text-white focus:border-gd-green focus:outline-none"
                    >
                      <option value="">Select VPN interface...</option>
                      {vpnInterfaces.length > 0 && (
                        <optgroup label="Detected VPN (Radmin / Hamachi / Tailscale)">
                          {vpnInterfaces.map((iface) => (
                            <option key={`vpn-${iface.name}-${iface.address}`} value={iface.address}>
                              [VPN] {iface.name} ({iface.address})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {lanInterfaces.length > 0 && (
                        <optgroup label="Other Interfaces">
                          {lanInterfaces.map((iface) => (
                            <option key={`lan-${iface.name}-${iface.address}`} value={iface.address}>
                              [LAN] {iface.name} ({iface.address})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  <div>
                    <label htmlFor={lanInputId} className="visually-hidden">
                      VPN IP Address
                    </label>
                    <input
                      id={lanInputId}
                      type="text"
                      value={lanHostDraft}
                      onChange={(e) => setLanHostDraft(e.target.value)}
                      placeholder="Radmin / Hamachi / Tailscale IP (e.g. 26.x.x.x)"
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="w-full rounded-lg border border-gd-border bg-gd-panel px-2.5 py-1.5 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-gd-green focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {networkModeDraft === 'vps' && (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor={vpsInputId} className="text-[11px] font-semibold text-slate-300">
                      VPS / Custom Domain URL
                    </label>
                    <span
                      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                        !vpsUrlDraft.trim()
                          ? 'border-slate-700 bg-slate-800/80 text-slate-400'
                          : vpsDraftByteInfo.withinDirectPatchLimit
                            ? 'border-gd-green/45 bg-gd-green/15 text-gd-green'
                            : 'border-amber-400/50 bg-amber-400/15 text-amber-200'
                      }`}
                    >
                      <span>{vpsDraftByteInfo.patchedBytes} / 33 bytes</span>
                      {vpsUrlDraft.trim() && (
                        <span>
                          {vpsDraftByteInfo.withinDirectPatchLimit
                            ? '• Direct Binary Patch Ready!'
                            : '• Exceeds 33B limit'}
                        </span>
                      )}
                    </span>
                  </div>
                  <input
                    id={vpsInputId}
                    type="url"
                    value={vpsUrlDraft}
                    onChange={(e) => setVpsUrlDraft(e.target.value)}
                    placeholder="http://203.0.113.10:8080 or https://gd.myvps.com"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full rounded-lg border border-gd-border bg-gd-panel px-2.5 py-1.5 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-gd-gold focus:outline-none"
                  />
                  {vpsDraftByteInfo.patchedEndpoint && (
                    <p className="truncate font-mono text-[10px] text-slate-400">
                      Endpoint: {vpsDraftByteInfo.patchedEndpoint}
                    </p>
                  )}
                </div>
              )}

              {networkModeDraft === 'tunnel' && (
                <div className="space-y-1 text-[11px]">
                  {!runtimeStatus?.cloudflaredReady && (
                    <p className="text-amber-300">
                      Warning: <code className="font-mono">cloudflared</code> was not detected.
                      Tunnel startup may fail until installed.
                    </p>
                  )}
                  <p className="text-slate-400">
                    Note: Quick Tunnel URLs (<code className="font-mono">*.trycloudflare.com</code>)
                    typically exceed the 33-byte in-binary URL limit; use VPN or a short VPS domain
                    for guaranteed direct binary patching.
                  </p>
                </div>
              )}

              {networkError && (
                <p role="alert" className="text-xs text-rose-400">
                  {networkError}
                </p>
              )}
              {networkMessage && (
                <p role="status" className="text-xs text-gd-green">
                  {networkMessage}
                </p>
              )}
            </div>

            <div className="mt-2.5 flex justify-end">
              <button
                type="submit"
                disabled={applyingNetwork}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gd-cyan/45 bg-gd-cyan/15 px-3 py-1.5 text-xs font-bold text-gd-cyan transition hover:bg-gd-cyan/25 disabled:opacity-50"
              >
                {applyingNetwork && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Apply Network Mode</span>
              </button>
            </div>
          </form>
        </div>

        {liveState.lastError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-3.5 py-2.5 text-xs text-rose-200"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
            <span>{liveState.lastError}</span>
          </div>
        )}
      </section>

      {/* Main Two-Tab Workspace */}
      <div>
        <div
          role="tablist"
          aria-label="Server Control Panel Sections"
          className="flex flex-nowrap gap-1 overflow-x-auto border-b border-gd-border"
        >
          <button
            ref={(el) => {
              tabRefs.current.overview = el;
            }}
            id={overviewTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            tabIndex={activeTab === 'overview' ? 0 : -1}
            onClick={() => setActiveTab('overview')}
            onKeyDown={(e) => handleTabKeyDown(e, 'overview')}
            className={`inline-flex flex-none items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-bold transition ${
              activeTab === 'overview'
                ? 'text-gd-cyan'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="h-4 w-4" aria-hidden="true" />
            <span>Overview &amp; Clients</span>
          </button>

          <button
            ref={(el) => {
              tabRefs.current.community = el;
            }}
            id={communityTabId}
            type="button"
            role="tab"
            aria-selected={activeTab === 'community'}
            tabIndex={activeTab === 'community' ? 0 : -1}
            onClick={() => setActiveTab('community')}
            onKeyDown={(e) => handleTabKeyDown(e, 'community')}
            className={`inline-flex flex-none items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-bold transition ${
              activeTab === 'community'
                ? 'text-gd-cyan'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            <span>Level &amp; Community Manager</span>
          </button>
        </div>

        {/* TAB 1: Overview & Clients */}
        <div
          role="tabpanel"
          aria-labelledby={overviewTabId}
          hidden={activeTab !== 'overview'}
          className="pt-5"
        >
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
            {/* Generated Clients Card */}
            <section
              aria-labelledby="generated-clients-heading"
              className="flex flex-col justify-between rounded-2xl border border-gd-border bg-gd-panel/90 p-5 shadow-lg shadow-black/25 xl:col-span-5"
            >
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 id="generated-clients-heading" className="text-lg font-bold text-white">
                      Generated Clients
                    </h2>
                    <p className="text-xs text-slate-400">
                      Ready-to-play patched Windows &amp; Android game builds
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRebuildPanel((v) => !v);
                      setRebuildNotice(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gd-border bg-gd-card px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-gd-cyan/60 hover:text-white"
                  >
                    <Hammer className="h-3.5 w-3.5 text-gd-cyan" aria-hidden="true" />
                    <span>{showRebuildPanel ? 'Hide Rebuild' : 'Rebuild Clients'}</span>
                  </button>
                </div>

                {/* Patched Endpoint Metadata */}
                <div className="space-y-1.5 rounded-xl border border-gd-border/90 bg-gd-bg/75 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Patched Endpoint:</span>
                    <span className="truncate font-mono text-gd-cyan">
                      {server.artifacts.patchedUrl || activeBaseUrl}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Last Built:</span>
                    <span className="text-slate-200">
                      {server.artifacts.builtAt
                        ? new Date(server.artifacts.builtAt).toLocaleString()
                        : 'Not built yet'}
                    </span>
                  </div>
                  {server.artifacts.usedRedirector && (
                    <div className="flex items-center justify-between gap-2 text-amber-200">
                      <span>URL Length Guard:</span>
                      <span className="font-semibold">Smart Redirector Active</span>
                    </div>
                  )}
                </div>

                {/* Localhost + Android Reachability Warning */}
                {server.buildAndroid &&
                  (server.networkMode === 'localhost' ||
                    server.artifacts.patchedUrl?.includes('127.0.0.1')) && (
                    <div className="space-y-2 rounded-xl border border-rose-500/45 bg-rose-500/10 p-3 text-xs text-rose-100">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
                        <span>
                          This APK points to <code className="font-mono">127.0.0.1</code> (Localhost),
                          so an Android phone cannot connect to your PC. Switch to{' '}
                          <strong>LAN / Wi-Fi</strong> to automatically rebuild the APK with your PC&apos;s
                          LAN IP.
                        </span>
                      </div>
                      {primaryLanInterface && (
                        <button
                          type="button"
                          disabled={applyingNetwork}
                          onClick={async () => {
                            setApplyingNetwork(true);
                            setNetworkError(null);
                            try {
                              const targetIp = primaryLanInterface.address;
                              const res = await window.easyGdps.updateServerNetwork(
                                server.id,
                                'lan',
                                targetIp
                              );
                              onServerUpdated(res.server, res.liveState);
                              setNetworkMessage(
                                `Switched to LAN (${targetIp}) and rebuilt Android APK!`
                              );
                            } catch (err) {
                              setNetworkError(
                                err instanceof Error ? err.message : 'Failed to switch to LAN.'
                              );
                            } finally {
                              setApplyingNetwork(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/50 bg-rose-500/20 px-3 py-1.5 font-bold text-white transition hover:bg-rose-500/30 disabled:opacity-50"
                        >
                          <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Switch to LAN ({primaryLanInterface.address}) &amp; Rebuild APK</span>
                        </button>
                      )}
                    </div>
                  )}

                {/* Build Warnings (e.g. URL exceeded 33 chars) */}
                {server.artifacts.warnings.length > 0 && (
                  <div className="space-y-1.5 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-100">
                    <div className="flex items-center gap-1.5 font-bold text-amber-300">
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      <span>Client Build Warnings</span>
                    </div>
                    <ul className="list-disc space-y-1 pl-4">
                      {server.artifacts.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {rebuildNotice && (
                  <div
                    role="status"
                    className={`rounded-xl border px-3 py-2 text-xs ${
                      rebuildNotice.type === 'ok'
                        ? 'border-gd-green/40 bg-gd-green/10 text-emerald-200'
                        : 'border-rose-500/45 bg-rose-500/15 text-rose-200'
                    }`}
                  >
                    {rebuildNotice.text}
                  </div>
                )}

                {/* One-Click Client Open & Share Buttons */}
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <button
                    type="button"
                    disabled={!server.artifacts.windowsExePath}
                    onClick={() =>
                      server.artifacts.windowsExePath &&
                      window.easyGdps.openPathInShell(server.artifacts.windowsExePath)
                    }
                    title={
                      server.artifacts.windowsExePath ||
                      'Windows .exe has not been built yet'
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gd-cyan/40 bg-gd-cyan/10 px-3.5 py-2.5 text-xs font-bold text-gd-cyan transition hover:bg-gd-cyan/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900/60 disabled:text-slate-500"
                  >
                    <Monitor className="h-4 w-4" aria-hidden="true" />
                    <span>Open .exe</span>
                  </button>

                  <button
                    type="button"
                    disabled={!server.artifacts.windowsZipPath}
                    onClick={() =>
                      server.artifacts.windowsZipPath &&
                      window.easyGdps.openPathInShell(server.artifacts.windowsZipPath)
                    }
                    title={
                      server.artifacts.windowsZipPath ||
                      'Windows .zip package has not been built yet'
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gd-border bg-gd-card px-3.5 py-2.5 text-xs font-bold text-slate-100 transition hover:border-gd-cyan/50 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Download className="h-4 w-4 text-gd-cyan" aria-hidden="true" />
                    <span>Open .zip</span>
                  </button>

                  <button
                    type="button"
                    disabled={!server.artifacts.androidApkPath}
                    onClick={() =>
                      server.artifacts.androidApkPath &&
                      window.easyGdps.openPathInShell(server.artifacts.androidApkPath)
                    }
                    title={
                      server.artifacts.androidApkPath ||
                      'Android .apk has not been built yet'
                    }
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-gd-green/40 bg-gd-green/10 px-3.5 py-2.5 text-xs font-bold text-gd-green transition hover:bg-gd-green/20 disabled:cursor-not-allowed disabled:border-slate-800 disabled:bg-slate-900/60 disabled:text-slate-500"
                  >
                    <Smartphone className="h-4 w-4" aria-hidden="true" />
                    <span>Open .apk</span>
                  </button>

                  <CopyButton
                    text={friendDownloadUrl}
                    label="Copy Friend Download Page Link"
                    copiedLabel="Download Link Copied!"
                    className="justify-center py-2.5 font-bold"
                  />
                </div>

                {/* Inline Rebuild Clients Form */}
                {showRebuildPanel && (
                  <form
                    onSubmit={handleRebuildClients}
                    className="space-y-3 rounded-xl border border-gd-cyan/35 bg-gd-bg/85 p-4"
                  >
                    <div className="text-xs font-bold uppercase tracking-wider text-gd-cyan">
                      Rebuild Clients for Active Endpoint
                    </div>

                    <div className="space-y-2.5 text-xs">
                      <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-200">
                        <input
                          type="checkbox"
                          checked={rebuildWindows}
                          onChange={(e) => setRebuildWindows(e.target.checked)}
                          className="h-4 w-4 rounded"
                        />
                        <span>Rebuild Windows Client (.exe &amp; .zip)</span>
                      </label>

                      {rebuildWindows && (
                        <div className="space-y-1.5 pl-6">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handlePickCustomFile('windows')}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gd-border bg-gd-card px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-gd-cyan/60"
                            >
                              <FolderOpen className="h-3.5 w-3.5 text-gd-cyan" aria-hidden="true" />
                              <span>Pick Custom Base .exe</span>
                            </button>
                            {customWinPath && (
                              <button
                                type="button"
                                onClick={() => setCustomWinPath('')}
                                className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                                <span>Reset</span>
                              </button>
                            )}
                          </div>
                          {customWinPath && (
                            <div className="truncate font-mono text-[11px] text-gd-cyan">
                              {customWinPath}
                            </div>
                          )}
                          {(!templateInfo?.windowsReady || customWinPath) && (
                            <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                              <input
                                type="checkbox"
                                checked={saveWinTemplate}
                                onChange={(e) => setSaveWinTemplate(e.target.checked)}
                                className="h-3.5 w-3.5 rounded"
                              />
                              <span>Save custom .exe to template library</span>
                            </label>
                          )}
                        </div>
                      )}

                      <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-200">
                        <input
                          type="checkbox"
                          checked={rebuildAndroid}
                          onChange={(e) => setRebuildAndroid(e.target.checked)}
                          className="h-4 w-4 rounded"
                        />
                        <span>Rebuild Android Client (.apk)</span>
                      </label>

                      {rebuildAndroid && (
                        <div className="space-y-1.5 pl-6">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handlePickCustomFile('android')}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gd-border bg-gd-card px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-gd-cyan/60"
                            >
                              <FolderOpen className="h-3.5 w-3.5 text-gd-green" aria-hidden="true" />
                              <span>Pick Custom Base .apk</span>
                            </button>
                            {customApkPath && (
                              <button
                                type="button"
                                onClick={() => setCustomApkPath('')}
                                className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
                              >
                                <X className="h-3 w-3" aria-hidden="true" />
                                <span>Reset</span>
                              </button>
                            )}
                          </div>
                          {customApkPath && (
                            <div className="truncate font-mono text-[11px] text-gd-green">
                              {customApkPath}
                            </div>
                          )}
                          {(!templateInfo?.androidReady || customApkPath) && (
                            <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                              <input
                                type="checkbox"
                                checked={saveApkTemplate}
                                onChange={(e) => setSaveApkTemplate(e.target.checked)}
                                className="h-3.5 w-3.5 rounded"
                              />
                              <span>Save custom .apk to template library</span>
                            </label>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowRebuildPanel(false)}
                        className="rounded-lg border border-gd-border px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={rebuilding || (!rebuildWindows && !rebuildAndroid)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gd-cyan px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:brightness-110 disabled:opacity-50"
                      >
                        {rebuilding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        <span>{rebuilding ? 'Building...' : 'Build Now'}</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </section>

            {/* Live Server & Request Logs */}
            <section
              aria-labelledby="live-logs-heading"
              className="flex flex-col rounded-2xl border border-gd-border bg-gd-panel/90 p-5 shadow-lg shadow-black/25 xl:col-span-7"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-gd-cyan" aria-hidden="true" />
                  <h2 id="live-logs-heading" className="text-lg font-bold text-white">
                    Live Server &amp; Request Logs
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={autoScrollLogs}
                      onChange={(e) => setAutoScrollLogs(e.target.checked)}
                      className="h-3.5 w-3.5 rounded"
                    />
                    <span>Auto-scroll</span>
                  </label>

                  <CopyButton
                    text={liveState.logs.join('\n')}
                    label="Copy Logs"
                    copiedLabel="Copied"
                  />
                </div>
              </div>

              <div
                ref={logsContainerRef}
                tabIndex={0}
                aria-label="Live server log output"
                className="gd-scroll mt-3 h-[22rem] overflow-y-auto rounded-xl border border-gd-border bg-[#060913] p-3.5 font-mono text-xs leading-relaxed text-slate-300"
              >
                {liveState.logs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-slate-500">
                    No server logs yet. Start the server to see PHP &amp; tunnel output.
                  </div>
                ) : (
                  liveState.logs.map((line, i) => (
                    <div
                      key={i}
                      className={`whitespace-pre-wrap break-all py-0.5 ${
                        line.toLowerCase().includes('error') ||
                        line.toLowerCase().includes('failed')
                          ? 'text-rose-300'
                          : line.includes('trycloudflare.com') || line.includes('listening')
                            ? 'text-gd-green'
                            : 'text-slate-300'
                      }`}
                    >
                      {line}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>

        {/* TAB 2: Level & Community Manager */}
        <div
          role="tabpanel"
          aria-labelledby={communityTabId}
          hidden={activeTab !== 'community'}
          className="pt-5"
        >
          {!isRunning ? (
            <div className="rounded-2xl border border-gd-border bg-gd-panel/80 p-10 text-center">
              <ShieldAlert className="mx-auto h-10 w-10 text-gd-gold" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-bold text-white">
                Start Server to Manage Levels &amp; Community
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
                The Level &amp; Community Manager connects directly to the live GDPS Admin API so
                you can rate levels, feature/epic creations, delete comments, and moderate users
                without touching SQL.
              </p>
              <button
                type="button"
                disabled={togglingPower || isStarting}
                onClick={handleTogglePower}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gd-green px-5 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-gd-green/20 hover:brightness-110 disabled:opacity-50"
              >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                <span>{isStarting ? 'Starting Server...' : 'Start Server Now'}</span>
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <search>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <label htmlFor={communitySearchId} className="visually-hidden">
                      Search levels, users, or comments
                    </label>
                    <input
                      id={communitySearchId}
                      type="search"
                      value={communitySearch}
                      onChange={(e) => setCommunitySearch(e.target.value)}
                      placeholder="Filter levels, users, or comments..."
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      className="w-72 rounded-xl border border-gd-border bg-gd-panel px-3.5 py-2 text-sm text-white placeholder:text-slate-500 focus:border-gd-cyan focus:outline-none"
                    />
                  </form>
                </search>

                <button
                  type="button"
                  onClick={fetchAdminOverview}
                  disabled={adminLoading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gd-border bg-gd-card px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-gd-cyan/50 hover:text-white disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 text-gd-cyan ${adminLoading ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Refresh Community Data</span>
                </button>
              </div>

              {adminError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-4 py-3 text-xs text-rose-200"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
                  <span>{adminError}</span>
                </div>
              )}

              {/* Summary Stat Cards */}
              <div
                className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${
                  versionSpec.supportsGauntlets
                    ? 'lg:grid-cols-7'
                    : versionSpec.supportsMapPacks
                      ? 'lg:grid-cols-6'
                      : 'lg:grid-cols-5'
                }`}
              >
                {[
                  {
                    label: 'Accounts',
                    value: stats?.accountsCount ?? 0,
                    icon: Users,
                    color: 'text-gd-cyan',
                  },
                  {
                    label: 'Users',
                    value: stats?.usersCount ?? 0,
                    icon: UserCheck,
                    color: 'text-gd-green',
                  },
                  {
                    label: 'Levels',
                    value: stats?.levelsCount ?? 0,
                    icon: Layers,
                    color: 'text-gd-gold',
                  },
                  {
                    label: 'Comments',
                    value: stats?.commentsCount ?? 0,
                    icon: MessageSquare,
                    color: 'text-gd-purple',
                  },
                  {
                    label: 'Songs',
                    value: stats?.songsCount ?? 0,
                    icon: Music,
                    color: 'text-gd-pink',
                  },
                  ...(versionSpec.supportsMapPacks
                    ? [
                        {
                          label: 'Map Packs',
                          value: stats?.mapPacksCount ?? mapPacks.length,
                          icon: MapIcon,
                          color: 'text-gd-green',
                        },
                      ]
                    : []),
                  ...(versionSpec.supportsGauntlets
                    ? [
                        {
                          label: 'Gauntlets',
                          value: stats?.gauntletsCount ?? gauntlets.length,
                          icon: Swords,
                          color: 'text-gd-gold',
                        },
                      ]
                    : []),
                ].map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.label}
                      className="rounded-2xl border border-gd-border bg-gd-panel/90 p-4 shadow-md shadow-black/20"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-semibold text-slate-400">
                          {card.label}
                        </span>
                        <Icon className={`h-4 w-4 shrink-0 ${card.color}`} aria-hidden="true" />
                      </div>
                      <div className="mt-2 font-mono text-2xl font-extrabold text-white">
                        {card.value}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Version-Gated Community Sub-Navigation (1.6+ Map Packs / 2.1+ Gauntlets) */}
              {(versionSpec.supportsMapPacks || versionSpec.supportsGauntlets) && (
                <div
                  role="tablist"
                  aria-label="Community Manager Sections"
                  className="flex flex-nowrap gap-1 overflow-x-auto rounded-xl border border-gd-border bg-gd-panel/90 p-1"
                >
                  <button
                    ref={(el) => {
                      subTabRefs.current.moderation = el;
                    }}
                    id={subModTabId}
                    type="button"
                    role="tab"
                    aria-selected={communitySubTab === 'moderation'}
                    tabIndex={communitySubTab === 'moderation' ? 0 : -1}
                    onClick={() => setCommunitySubTab('moderation')}
                    onKeyDown={(e) => handleCommunitySubTabKeyDown(e, 'moderation')}
                    className={`inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                      communitySubTab === 'moderation'
                        ? 'bg-gd-card text-gd-cyan'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Levels, Players &amp; Comments</span>
                  </button>

                  {versionSpec.supportsMapPacks && (
                    <button
                      ref={(el) => {
                        subTabRefs.current.mappacks = el;
                      }}
                      id={subMapPacksTabId}
                      type="button"
                      role="tab"
                      aria-selected={communitySubTab === 'mappacks'}
                      tabIndex={communitySubTab === 'mappacks' ? 0 : -1}
                      onClick={() => setCommunitySubTab('mappacks')}
                      onKeyDown={(e) => handleCommunitySubTabKeyDown(e, 'mappacks')}
                      className={`inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                        communitySubTab === 'mappacks'
                          ? 'bg-gd-card text-gd-green'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Map Packs Manager ({mapPacks.length})</span>
                    </button>
                  )}

                  {versionSpec.supportsGauntlets && (
                    <button
                      ref={(el) => {
                        subTabRefs.current.gauntlets = el;
                      }}
                      id={subGauntletsTabId}
                      type="button"
                      role="tab"
                      aria-selected={communitySubTab === 'gauntlets'}
                      tabIndex={communitySubTab === 'gauntlets' ? 0 : -1}
                      onClick={() => setCommunitySubTab('gauntlets')}
                      onKeyDown={(e) => handleCommunitySubTabKeyDown(e, 'gauntlets')}
                      className={`inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                        communitySubTab === 'gauntlets'
                          ? 'bg-gd-card text-gd-gold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Swords className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        Gauntlets Manager ({gauntlets.length} / {versionSpec.maxGauntletId})
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Moderation Sub-Panel (Always available: Levels, Players, Comments) */}
              <div
                role={versionSpec.supportsMapPacks || versionSpec.supportsGauntlets ? 'tabpanel' : undefined}
                aria-labelledby={
                  versionSpec.supportsMapPacks || versionSpec.supportsGauntlets
                    ? subModTabId
                    : undefined
                }
                hidden={communitySubTab !== 'moderation'}
                className="space-y-6"
              >
              {/* Levels Table */}
              <section
                aria-labelledby="levels-manager-heading"
                className="rounded-2xl border border-gd-border bg-gd-panel/90 p-5 shadow-lg shadow-black/25"
              >
                <div className="mb-4 flex items-center justify-between gap-2">
                  <div>
                    <h2 id="levels-manager-heading" className="text-lg font-bold text-white">
                      Uploaded Levels ({filteredLevels.length})
                    </h2>
                    <p className="text-xs text-slate-400">
                      Set star ratings (0–10), toggle Featured / Epic / Demon / Auto, or remove
                      levels.
                    </p>
                  </div>
                </div>

                {filteredLevels.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gd-border p-8 text-center text-sm text-slate-400">
                    No uploaded levels found. Upload a level from your GDPS client to see it here.
                  </div>
                ) : (
                  <div className="gd-scroll overflow-x-auto">
                    <table className="w-full min-w-[780px] border-collapse text-left text-xs">
                      <thead>
                        <tr className="border-b border-gd-border text-[11px] uppercase tracking-wider text-slate-400">
                          <th className="py-2.5 pr-3">Level</th>
                          <th className="px-3 py-2.5">Creator</th>
                          <th className="px-3 py-2.5">Engagement</th>
                          <th className="px-3 py-2.5">Current Rating</th>
                          <th className="px-3 py-2.5">Moderation Controls</th>
                          <th className="py-2.5 pl-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gd-border/60">
                        {filteredLevels.map((lvl) => {
                          const draft = levelDrafts[lvl.levelID] ?? {
                            stars: lvl.starStars,
                            featured: lvl.starFeatured > 0,
                            epic: lvl.starEpic > 0,
                            demon: lvl.starDemon > 0,
                            auto: lvl.starAuto > 0,
                          };
                          const isSaving = savingLevelId === lvl.levelID;

                          return (
                            <tr key={lvl.levelID} className="align-middle hover:bg-gd-card/40">
                              <td className="py-3 pr-3">
                                <div className="font-bold text-white">
                                  {lvl.levelName}{' '}
                                  <span className="font-mono text-[11px] font-normal text-slate-400">
                                    #{lvl.levelID}
                                  </span>
                                </div>
                                {lvl.levelDesc && (
                                  <div className="mt-0.5 max-w-xs truncate text-[11px] text-slate-400">
                                    {lvl.levelDesc}
                                  </div>
                                )}
                                <div className="mt-0.5 text-[10px] text-slate-500">
                                  {formatUnixTimestamp(lvl.uploadDate)}
                                </div>
                              </td>

                              <td className="px-3 py-3 font-medium text-slate-200">
                                {lvl.userName || `User #${lvl.userID}`}
                              </td>

                              <td className="px-3 py-3 font-mono text-slate-300">
                                <div className="flex items-center gap-3">
                                  <span title="Downloads" className="inline-flex items-center gap-1">
                                    <Download className="h-3 w-3 text-gd-cyan" aria-hidden="true" />
                                    {lvl.downloads}
                                  </span>
                                  <span title="Likes" className="inline-flex items-center gap-1">
                                    <Heart className="h-3 w-3 text-gd-pink" aria-hidden="true" />
                                    {lvl.likes}
                                  </span>
                                </div>
                              </td>

                              <td className="px-3 py-3">
                                <div className="flex flex-wrap gap-1">
                                  <span className="inline-flex items-center gap-1 rounded border border-gd-gold/40 bg-gd-gold/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-gd-gold">
                                    <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                                    {lvl.starStars}
                                  </span>
                                  {lvl.starFeatured > 0 && (
                                    <span className="rounded border border-amber-400/40 bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-200">
                                      Featured
                                    </span>
                                  )}
                                  {lvl.starEpic > 0 && (
                                    <span className="rounded border border-gd-purple/45 bg-gd-purple/20 px-1.5 py-0.5 text-[10px] font-semibold text-purple-200">
                                      Epic
                                    </span>
                                  )}
                                  {lvl.starDemon > 0 && (
                                    <span className="rounded border border-rose-500/45 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
                                      Demon
                                    </span>
                                  )}
                                  {lvl.starAuto > 0 && (
                                    <span className="rounded border border-gd-cyan/40 bg-gd-cyan/15 px-1.5 py-0.5 text-[10px] font-semibold text-gd-cyan">
                                      Auto
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td className="px-3 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="inline-flex items-center gap-1 text-[11px] text-slate-300">
                                    <span>Stars:</span>
                                    <select
                                      aria-label={`Stars for ${lvl.levelName}`}
                                      value={draft.stars}
                                      onChange={(e) =>
                                        updateLevelDraft(lvl.levelID, {
                                          stars: Number(e.target.value),
                                        })
                                      }
                                      className="rounded-lg border border-gd-border bg-gd-bg px-2 py-1 font-mono text-xs text-white focus:border-gd-cyan focus:outline-none"
                                    >
                                      {Array.from({ length: 11 }, (_, n) => (
                                        <option key={n} value={n}>
                                          {n} ★
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <button
                                    type="button"
                                    aria-pressed={draft.featured}
                                    onClick={() =>
                                      updateLevelDraft(lvl.levelID, { featured: !draft.featured })
                                    }
                                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                                      draft.featured
                                        ? 'border-amber-400 bg-amber-400/20 text-amber-200'
                                        : 'border-gd-border bg-gd-bg text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    <Award className="h-3 w-3" aria-hidden="true" />
                                    <span>Featured</span>
                                  </button>

                                  <button
                                    type="button"
                                    aria-pressed={draft.epic}
                                    onClick={() =>
                                      updateLevelDraft(lvl.levelID, { epic: !draft.epic })
                                    }
                                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                                      draft.epic
                                        ? 'border-gd-purple bg-gd-purple/25 text-purple-200'
                                        : 'border-gd-border bg-gd-bg text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    <Flame className="h-3 w-3" aria-hidden="true" />
                                    <span>Epic</span>
                                  </button>

                                  <button
                                    type="button"
                                    aria-pressed={draft.demon}
                                    onClick={() =>
                                      updateLevelDraft(lvl.levelID, { demon: !draft.demon })
                                    }
                                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                                      draft.demon
                                        ? 'border-rose-500 bg-rose-500/20 text-rose-200'
                                        : 'border-gd-border bg-gd-bg text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    <Skull className="h-3 w-3" aria-hidden="true" />
                                    <span>Demon</span>
                                  </button>

                                  <button
                                    type="button"
                                    aria-pressed={draft.auto}
                                    onClick={() =>
                                      updateLevelDraft(lvl.levelID, { auto: !draft.auto })
                                    }
                                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${
                                      draft.auto
                                        ? 'border-gd-cyan bg-gd-cyan/20 text-gd-cyan'
                                        : 'border-gd-border bg-gd-bg text-slate-400 hover:text-slate-200'
                                    }`}
                                  >
                                    <Sparkles className="h-3 w-3" aria-hidden="true" />
                                    <span>Auto</span>
                                  </button>
                                </div>
                              </td>

                              <td className="py-3 pl-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={isSaving}
                                    onClick={() => handleSaveLevelRating(lvl.levelID)}
                                    className="inline-flex items-center gap-1 rounded-lg bg-gd-cyan px-2.5 py-1.5 text-[11px] font-bold text-slate-950 transition hover:brightness-110 disabled:opacity-50"
                                  >
                                    {isSaving ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                    )}
                                    <span>Apply Rate</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setDeleteTarget({ kind: 'level', record: lvl })}
                                    aria-label={`Delete level ${lvl.levelName}`}
                                    className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/25"
                                  >
                                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                                    <span>Delete</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Users & Comments Sub-sections */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {/* Users Moderation */}
                <section
                  aria-labelledby="users-manager-heading"
                  className="rounded-2xl border border-gd-border bg-gd-panel/90 p-5 shadow-lg shadow-black/25"
                >
                  <h2 id="users-manager-heading" className="text-lg font-bold text-white">
                    Players &amp; Accounts ({filteredUsers.length})
                  </h2>
                  <p className="mb-4 text-xs text-slate-400">
                    Inspect player stats and ban or unban accounts instantaneously.
                  </p>

                  {filteredUsers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gd-border p-6 text-center text-xs text-slate-400">
                      No registered players found.
                    </div>
                  ) : (
                    <div className="gd-scroll max-h-96 space-y-2.5 overflow-y-auto pr-1">
                      {filteredUsers.map((user) => {
                        const isBusy = busyUserId === user.userID;
                        return (
                          <div
                            key={user.userID}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gd-border/80 bg-gd-bg/75 px-3.5 py-2.5"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-bold text-white">
                                  {user.userName}
                                </span>
                                <span className="font-mono text-[11px] text-slate-400">
                                  UID {user.userID}
                                </span>
                                {user.isMod > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded border border-gd-cyan/40 bg-gd-cyan/15 px-1.5 py-0.5 text-[10px] font-bold text-gd-cyan">
                                    <Crown className="h-2.5 w-2.5" aria-hidden="true" />
                                    <span>MOD</span>
                                  </span>
                                )}
                                {user.isBanned > 0 && (
                                  <span className="rounded border border-rose-500/45 bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-200">
                                    BANNED
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                                {user.stars} ★ &bull; {user.demons} Demons &bull;{' '}
                                {user.creatorPoints} CP
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleToggleUserBan(user)}
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                                user.isBanned > 0
                                  ? 'border-gd-green/40 bg-gd-green/15 text-gd-green hover:bg-gd-green/25'
                                  : 'border-rose-500/45 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                              }`}
                            >
                              {isBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>{user.isBanned > 0 ? 'Unban User' : 'Ban User'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Comments Moderation */}
                <section
                  aria-labelledby="comments-manager-heading"
                  className="rounded-2xl border border-gd-border bg-gd-panel/90 p-5 shadow-lg shadow-black/25"
                >
                  <h2 id="comments-manager-heading" className="text-lg font-bold text-white">
                    Recent Comments ({filteredComments.length})
                  </h2>
                  <p className="mb-4 text-xs text-slate-400">
                    Review level comments and delete spam or inappropriate posts in one click.
                  </p>

                  {filteredComments.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gd-border p-6 text-center text-xs text-slate-400">
                      No comments found.
                    </div>
                  ) : (
                    <div className="gd-scroll max-h-96 space-y-2.5 overflow-y-auto pr-1">
                      {filteredComments.map((c) => {
                        const isBusy = busyCommentId === c.commentID;
                        return (
                          <div
                            key={c.commentID}
                            className="flex items-start justify-between gap-3 rounded-xl border border-gd-border/80 bg-gd-bg/75 px-3.5 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-bold text-white">
                                  {c.userName || `User #${c.userID}`}
                                </span>
                                <span className="font-mono text-[11px] text-gd-cyan">
                                  Level #{c.levelID}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  {formatUnixTimestamp(c.timestamp)}
                                </span>
                              </div>
                              <p className="mt-1 break-words text-xs text-slate-200">{c.comment}</p>
                            </div>

                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDeleteComment(c.commentID)}
                              aria-label={`Delete comment #${c.commentID}`}
                              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-50"
                            >
                              {isBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              <span>Delete</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
              </div>

              {/* Strictly Version-Gated Map Packs Manager (GD 1.6 – 2.2 ONLY) */}
              {versionSpec.supportsMapPacks && (
                <div
                  role="tabpanel"
                  aria-labelledby={subMapPacksTabId}
                  hidden={communitySubTab !== 'mappacks'}
                >
                  <MapPackManagerSection
                    serverId={server.id}
                    levels={levels}
                    mapPacks={mapPacks}
                    onChanged={fetchAdminOverview}
                    onRequestDelete={(pack) => setDeleteTarget({ kind: 'mappack', record: pack })}
                  />
                </div>
              )}

              {/* Strictly Version-Gated Gauntlets Manager (GD 2.1 – 2.2 ONLY) */}
              {versionSpec.supportsGauntlets && (
                <div
                  role="tabpanel"
                  aria-labelledby={subGauntletsTabId}
                  hidden={communitySubTab !== 'gauntlets'}
                >
                  <GauntletManagerSection
                    serverId={server.id}
                    version={server.version}
                    levels={levels}
                    gauntlets={gauntlets}
                    onChanged={fetchAdminOverview}
                    onRequestDelete={(gauntlet) =>
                      setDeleteTarget({ kind: 'gauntlet', record: gauntlet })
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Native Confirmation Dialog for Level / Map Pack / Gauntlet Deletion */}
      <dialog
        ref={deleteDialogRef}
        aria-labelledby={deleteDialogTitleId}
        onClose={() => {
          if (deleteDialogRef.current) {
            deleteDialogRef.current.returnValue = '';
          }
          if (!deletingTarget) setDeleteTarget(null);
        }}
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div className="rounded-2xl border border-gd-border bg-gd-panel p-6 shadow-2xl shadow-black/75">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-500/40 bg-rose-500/15 text-rose-300">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id={deleteDialogTitleId} className="text-lg font-bold text-white">
                {deleteTarget?.kind === 'mappack'
                  ? 'Delete Map Pack?'
                  : deleteTarget?.kind === 'gauntlet'
                    ? 'Delete Gauntlet?'
                    : 'Delete Level?'}
              </h2>
              <p className="mt-1.5 text-sm text-slate-300">
                {deleteTarget?.kind === 'mappack' ? (
                  <>
                    Permanently remove Map Pack{' '}
                    <strong className="text-white">{deleteTarget.record.name}</strong> (#
                    {deleteTarget.record.ID})? The underlying levels will not be deleted.
                  </>
                ) : deleteTarget?.kind === 'gauntlet' ? (
                  <>
                    Remove{' '}
                    <strong className="text-white">
                      {getGauntletNameById(deleteTarget.record.ID)}
                    </strong>{' '}
                    (#{deleteTarget.record.ID}) from your GDPS? The 5 levels themselves will stay on
                    the server.
                  </>
                ) : deleteTarget?.kind === 'level' ? (
                  <>
                    Permanently remove{' '}
                    <strong className="text-white">{deleteTarget.record.levelName}</strong> (#
                    {deleteTarget.record.levelID}) by{' '}
                    <span className="text-slate-100">{deleteTarget.record.userName}</span> from your
                    GDPS?
                  </>
                ) : null}
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2.5">
            <button
              type="button"
              autoFocus
              disabled={deletingTarget}
              onClick={() => deleteDialogRef.current?.close('cancel')}
              className="rounded-xl border border-gd-border bg-gd-card px-4 py-2 text-sm font-semibold text-slate-200 hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deletingTarget}
              onClick={confirmDeleteTarget}
              className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>
                {deletingTarget
                  ? 'Deleting...'
                  : deleteTarget?.kind === 'mappack'
                    ? 'Delete Map Pack'
                    : deleteTarget?.kind === 'gauntlet'
                      ? 'Delete Gauntlet'
                      : 'Delete Level'}
              </span>
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
};
