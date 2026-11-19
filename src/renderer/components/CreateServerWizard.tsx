import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
  Globe,
  Info,
  Laptop,
  Loader2,
  Map as MapIcon,
  Monitor,
  Music,
  RefreshCw,
  Rocket,
  Server,
  Shield,
  Smartphone,
  Swords,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { GD_VERSIONS, getGdVersionSpec, type GdVersionId, type GdVersionSpec } from '@shared/gdVersions';
import type {
  CreateServerInput,
  GdpsServerConfig,
  NetworkInterfaceInfo,
  NetworkMode,
  RuntimeStatus,
  ServerLiveState,
  TemplateAvailability,
} from '@shared/types';
import { classifyInterfaceKind, getVpsPatchByteInfo } from './uiHelpers';

type VersionFilterTab = 'all' | 'retro' | 'modern';

interface CreateServerWizardProps {
  templates: TemplateAvailability[];
  runtimeStatus: RuntimeStatus | null;
  onCancel: () => void;
  onCreated: (result: { server: GdpsServerConfig; liveState: ServerLiveState }) => void;
}

const RETRO_IDS = new Set<GdVersionId>([
  '1.0',
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '1.7',
  '1.8',
  '1.9',
]);

export const CreateServerWizard: React.FC<CreateServerWizardProps> = ({
  templates,
  runtimeStatus,
  onCancel,
  onCreated,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [versionTab, setVersionTab] = useState<VersionFilterTab>('all');
  const [selectedVersion, setSelectedVersion] = useState<GdVersionId>('2.2');

  // Step 2 Form State
  const [serverName, setServerName] = useState('NovaGDPS 2.2');
  const [nameEditedManually, setNameEditedManually] = useState(false);
  const [portInput, setPortInput] = useState('');
  const [networkMode, setNetworkMode] = useState<NetworkMode>('localhost');
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const [lanHost, setLanHost] = useState('');
  const [vpsUrl, setVpsUrl] = useState('');

  const [buildWindows, setBuildWindows] = useState(true);
  const [buildAndroid, setBuildAndroid] = useState(true);
  const [customWindowsBasePath, setCustomWindowsBasePath] = useState<string>('');
  const [customAndroidBasePath, setCustomAndroidBasePath] = useState<string>('');
  const [saveCustomWindowsToTemplate, setSaveCustomWindowsToTemplate] = useState(true);
  const [saveCustomAndroidToTemplate, setSaveCustomAndroidToTemplate] = useState(true);

  // Validation & Submit state
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    port?: string;
    lanHost?: string;
    vpsUrl?: string;
  }>({});
  const [touched, setTouched] = useState<{
    name?: boolean;
    port?: boolean;
    lanHost?: boolean;
    vpsUrl?: boolean;
  }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const step1HeadingRef = useRef<HTMLHeadingElement | null>(null);
  const step2HeadingRef = useRef<HTMLHeadingElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const portInputRef = useRef<HTMLInputElement | null>(null);
  const lanInputRef = useRef<HTMLInputElement | null>(null);
  const vpsInputRef = useRef<HTMLInputElement | null>(null);
  const tabRefs = useRef<Record<VersionFilterTab, HTMLButtonElement | null>>({
    all: null,
    retro: null,
    modern: null,
  });

  const nameId = useId();
  const nameHelpId = useId();
  const nameErrId = useId();
  const portId = useId();
  const portHelpId = useId();
  const portErrId = useId();
  const lanSelectId = useId();
  const lanInputId = useId();
  const lanErrId = useId();
  const vpsInputId = useId();
  const vpsHelpId = useId();
  const vpsErrId = useId();
  const formTitleId = useId();

  const templateMap = useMemo(() => {
    const map = new Map<GdVersionId, TemplateAvailability>();
    for (const item of templates) {
      map.set(item.version, item);
    }
    return map;
  }, [templates]);

  const filteredVersions: GdVersionSpec[] = useMemo(() => {
    if (versionTab === 'retro') {
      return GD_VERSIONS.filter((v) => RETRO_IDS.has(v.id));
    }
    if (versionTab === 'modern') {
      return GD_VERSIONS.filter((v) => !RETRO_IDS.has(v.id));
    }
    return GD_VERSIONS;
  }, [versionTab]);

  const selectedSpec = useMemo(() => getGdVersionSpec(selectedVersion), [selectedVersion]);
  const selectedTemplate = templateMap.get(selectedVersion);

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

  const vpsByteInfo = useMemo(() => getVpsPatchByteInfo(vpsUrl), [vpsUrl]);

  const loadNetworkInterfaces = async () => {
    setLoadingInterfaces(true);
    try {
      const list = await window.easyGdps.getNetworkInterfaces();
      setInterfaces(list);
      const preferredLan = list.find((i) => classifyInterfaceKind(i) === 'lan') ?? list[0];
      if (preferredLan) {
        if (!lanHost) {
          setLanHost(preferredLan.address);
        }
        // Default to LAN mode when building an Android APK so phones/emulators can reach this PC
        if (buildAndroid && networkMode === 'localhost' && classifyInterfaceKind(preferredLan) === 'lan') {
          setNetworkMode('lan');
        }
      }
    } catch {
      setInterfaces([]);
    } finally {
      setLoadingInterfaces(false);
    }
  };

  useEffect(() => {
    loadNetworkInterfaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectNetworkMode = (mode: NetworkMode) => {
    setNetworkMode(mode);
    setFieldErrors((prev) => ({ ...prev, lanHost: undefined, vpsUrl: undefined }));
    if (mode === 'lan') {
      const bestLan = lanInterfaces[0] ?? interfaces[0];
      if (bestLan && (!lanHost || vpnInterfaces.some((v) => v.address === lanHost))) {
        setLanHost(bestLan.address);
      }
    } else if (mode === 'vpn') {
      const bestVpn = vpnInterfaces[0];
      if (bestVpn && (!lanHost || lanInterfaces.some((l) => l.address === lanHost))) {
        setLanHost(bestVpn.address);
      } else if (!bestVpn && lanInterfaces.some((l) => l.address === lanHost)) {
        setLanHost('');
      }
    }
  };

  const handleSelectVersion = (ver: GdVersionId) => {
    setSelectedVersion(ver);
    if (!nameEditedManually) {
      setServerName(`NovaGDPS ${ver}`);
    }
  };

  const goToStep = (nextStep: 1 | 2) => {
    setStep(nextStep);
    window.requestAnimationFrame(() => {
      if (nextStep === 1) {
        step1HeadingRef.current?.focus();
      } else {
        step2HeadingRef.current?.focus();
      }
    });
  };

  const handleTabKeyDown = (e: React.KeyboardEvent, current: VersionFilterTab) => {
    const order: VersionFilterTab[] = ['all', 'retro', 'modern'];
    const idx = order.indexOf(current);
    let next: VersionFilterTab | null = null;
    if (e.key === 'ArrowRight') next = order[(idx + 1) % order.length];
    else if (e.key === 'ArrowLeft') next = order[(idx - 1 + order.length) % order.length];
    else if (e.key === 'Home') next = order[0];
    else if (e.key === 'End') next = order[order.length - 1];

    if (next) {
      e.preventDefault();
      setVersionTab(next);
      tabRefs.current[next]?.focus();
    }
  };

  const validateName = (val: string): string | undefined => {
    const trimmed = val.trim();
    if (!trimmed) return 'Please enter a server name (e.g. NovaGDPS 2.2).';
    if (trimmed.length < 2) return 'Server name must be at least 2 characters.';
    if (trimmed.length > 48) return 'Server name must be 48 characters or fewer.';
    return undefined;
  };

  const validatePort = (val: string): string | undefined => {
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    if (!/^\d+$/.test(trimmed)) return 'Port must be a whole number between 1024 and 65535.';
    const num = Number(trimmed);
    if (num < 1024 || num > 65535) return 'Port must be between 1024 and 65535.';
    return undefined;
  };

  const validateLanHost = (val: string, mode: NetworkMode): string | undefined => {
    if (mode !== 'lan' && mode !== 'vpn') return undefined;
    const trimmed = val.trim();
    if (!trimmed) {
      return mode === 'vpn'
        ? 'Enter or select your VPN IP address (Radmin VPN, Hamachi, Tailscale, or ZeroTier).'
        : 'Enter or select a local LAN / Wi-Fi IP address or hostname.';
    }
    if (/\s/.test(trimmed)) return 'IP address or hostname cannot contain spaces.';
    return undefined;
  };

  const validateVpsUrl = (val: string, mode: NetworkMode): string | undefined => {
    if (mode !== 'vps') return undefined;
    const trimmed = val.trim();
    if (!trimmed) {
      return 'Enter your VPS or custom domain URL (e.g. http://203.0.113.10:8080 or https://gd.myvps.com).';
    }
    if (/\s/.test(trimmed)) return 'VPS URL cannot contain spaces.';
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      return 'VPS URL must begin with http:// or https://.';
    }
    return undefined;
  };

  const handlePickBaseFile = async (kind: 'windows' | 'android') => {
    try {
      const picked = await window.easyGdps.pickBaseClientFile(kind);
      if (!picked) return;
      if (kind === 'windows') {
        setCustomWindowsBasePath(picked);
        setBuildWindows(true);
      } else {
        setCustomAndroidBasePath(picked);
        setBuildAndroid(true);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to open file picker.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const nameErr = validateName(serverName);
    const portErr = validatePort(portInput);
    const lanErr = validateLanHost(lanHost, networkMode);
    const vpsErr = validateVpsUrl(vpsUrl, networkMode);

    setTouched({ name: true, port: true, lanHost: true, vpsUrl: true });
    setFieldErrors({ name: nameErr, port: portErr, lanHost: lanErr, vpsUrl: vpsErr });

    if (nameErr) {
      nameInputRef.current?.focus();
      return;
    }
    if (portErr) {
      portInputRef.current?.focus();
      return;
    }
    if (lanErr) {
      lanInputRef.current?.focus();
      return;
    }
    if (vpsErr) {
      vpsInputRef.current?.focus();
      return;
    }

    const payload: CreateServerInput = {
      name: serverName.trim(),
      version: selectedVersion,
      port: portInput.trim() ? Number(portInput.trim()) : undefined,
      networkMode,
      lanHost: networkMode === 'lan' || networkMode === 'vpn' ? lanHost.trim() : undefined,
      vpsUrl: networkMode === 'vps' ? vpsUrl.trim() : undefined,
      buildWindows,
      buildAndroid,
      customWindowsBasePath: customWindowsBasePath || undefined,
      customAndroidBasePath: customAndroidBasePath || undefined,
      saveCustomWindowsToTemplate:
        Boolean(customWindowsBasePath) && saveCustomWindowsToTemplate,
      saveCustomAndroidToTemplate:
        Boolean(customAndroidBasePath) && saveCustomAndroidToTemplate,
    };

    setSubmitting(true);
    try {
      const result = await window.easyGdps.createServer(payload);
      onCreated(result);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to create GDPS server. Please check logs.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const androidSigningToolsReady = Boolean(
    runtimeStatus?.javaReady &&
      runtimeStatus?.zipalignReady &&
      runtimeStatus?.uberApkSignerReady
  );

  return (
    <div className="space-y-6">
      {/* Top Wizard Navigation & Step Progress */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gd-border bg-gd-panel/90 px-5 py-4 shadow-lg shadow-black/25">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gd-border bg-gd-card px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-gd-cyan/50 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to Dashboard</span>
          </button>
          <div>
            <h1 className="text-lg font-bold text-white">Create New GDPS Server</h1>
            <p className="text-xs text-slate-400">
              Choose any Geometry Dash era (1.0 – 2.2) and configure dual EXE/APK builds.
            </p>
          </div>
        </div>

        <nav aria-label="Setup progress">
          <ol className="flex items-center gap-2 text-xs font-semibold">
            <li>
              <button
                type="button"
                onClick={() => goToStep(1)}
                aria-current={step === 1 ? 'step' : undefined}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 transition ${
                  step === 1
                    ? 'border-gd-cyan bg-gd-cyan/15 text-gd-cyan'
                    : 'border-gd-green/40 bg-gd-green/10 text-gd-green hover:bg-gd-green/20'
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/15 font-mono text-[11px]">
                  1
                </span>
                <span>Select Version</span>
              </button>
            </li>
            <li aria-hidden="true" className="text-slate-600">
              &rarr;
            </li>
            <li>
              <button
                type="button"
                onClick={() => goToStep(2)}
                aria-current={step === 2 ? 'step' : undefined}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 transition ${
                  step === 2
                    ? 'border-gd-cyan bg-gd-cyan/15 text-gd-cyan'
                    : 'border-gd-border bg-gd-card text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/15 font-mono text-[11px]">
                  2
                </span>
                <span>Server &amp; Client Setup</span>
              </button>
            </li>
          </ol>
        </nav>
      </div>

      {/* STEP 1: Select Geometry Dash Version */}
      {step === 1 && (
        <section aria-labelledby="step1-heading" className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2
                id="step1-heading"
                ref={step1HeadingRef}
                tabIndex={-1}
                className="text-xl font-bold text-white focus:outline-none"
              >
                Step 1 — Select Geometry Dash Version (1.0 – 2.2)
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Each version configures accurate protocol responses, URL byte limits (ASCII 33B vs
                Base64 44B), and client templates.
              </p>
            </div>

            {/* Filter Tabs */}
            <div
              role="tablist"
              aria-label="Filter Geometry Dash versions by era"
              className="flex flex-nowrap overflow-x-auto rounded-xl border border-gd-border bg-gd-panel p-1"
            >
              {(
                [
                  { id: 'all', label: `All Versions (${GD_VERSIONS.length})` },
                  { id: 'retro', label: '1.0 – 1.9 Retro (10)' },
                  { id: 'modern', label: '2.0 – 2.2 Modern (4)' },
                ] as const
              ).map((tab) => {
                const isSelected = versionTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      tabRefs.current[tab.id] = el;
                    }}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => setVersionTab(tab.id)}
                    onKeyDown={(e) => handleTabKeyDown(e, tab.id)}
                    className={`flex-none whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                      isSelected
                        ? 'bg-gd-card text-gd-cyan'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 14-Version Interactive Grid */}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {filteredVersions.map((spec) => {
              const isSelected = selectedVersion === spec.id;
              const tpl = templateMap.get(spec.id);
              const winReady = Boolean(tpl?.windowsReady);
              const apkReady = Boolean(tpl?.androidReady);

              return (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => handleSelectVersion(spec.id)}
                  onDoubleClick={() => {
                    handleSelectVersion(spec.id);
                    goToStep(2);
                  }}
                  aria-pressed={isSelected}
                  className={`flex flex-col justify-between rounded-2xl border p-4 text-left transition ${
                    isSelected
                      ? 'border-gd-cyan bg-gd-card shadow-[0_0_24px_rgb(0_229_255/0.16)] ring-1 ring-gd-cyan/50'
                      : 'border-gd-border bg-gd-panel/85 hover:border-gd-cyan/45 hover:bg-gd-card/70'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`flex h-10 w-12 items-center justify-center rounded-xl border font-mono text-sm font-extrabold ${
                            isSelected
                              ? 'border-gd-cyan bg-gd-cyan/20 text-gd-cyan'
                              : 'border-gd-border bg-gd-bg text-gd-gold'
                          }`}
                        >
                          {spec.id}
                        </span>
                        <div>
                          <div className="text-sm font-bold text-white">{spec.label}</div>
                          <div className="text-[11px] font-medium text-slate-400">{spec.era}</div>
                        </div>
                      </div>

                      {isSelected && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gd-cyan/20 px-2 py-0.5 text-[11px] font-bold text-gd-cyan">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          <span>Selected</span>
                        </span>
                      )}
                    </div>

                    <p className="mt-3 text-xs leading-relaxed text-slate-300">{spec.highlights}</p>

                    {/* Protocol & Capabilities */}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span
                        className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                          spec.usesBase64Url
                            ? 'border-gd-purple/40 bg-gd-purple/15 text-purple-200'
                            : 'border-amber-400/35 bg-amber-400/10 text-amber-200'
                        }`}
                      >
                        {spec.usesBase64Url ? 'Base64 44B' : 'ASCII 33B'}
                      </span>

                      {spec.supportsAccounts && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-300">
                          <Users className="h-3 w-3 text-gd-cyan" aria-hidden="true" />
                          <span>Accounts</span>
                        </span>
                      )}

                      {spec.supportsCustomSongs && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-300">
                          <Music className="h-3 w-3 text-gd-pink" aria-hidden="true" />
                          <span>Custom Songs</span>
                        </span>
                      )}

                      {spec.supportsMapPacks && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-gd-green/35 bg-gd-green/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                          <MapIcon className="h-3 w-3 text-gd-green" aria-hidden="true" />
                          <span>Map Packs</span>
                        </span>
                      )}

                      {spec.supportsGauntlets && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-gd-gold/40 bg-gd-gold/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                          <Swords className="h-3 w-3 text-gd-gold" aria-hidden="true" />
                          <span>Gauntlets (1–{spec.maxGauntletId})</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Template Readiness Pills */}
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gd-border/60 pt-3 text-[11px]">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium ${
                        winReady
                          ? 'border-gd-green/35 bg-gd-green/10 text-emerald-200'
                          : 'border-slate-700 bg-slate-900/70 text-slate-400'
                      }`}
                    >
                      <Monitor className="h-3 w-3" aria-hidden="true" />
                      <span>
                        EXE: {winReady ? `Ready (${tpl?.windowsFileCount ?? 1})` : 'Custom Needed'}
                      </span>
                    </span>

                    <span
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium ${
                        apkReady
                          ? 'border-gd-green/35 bg-gd-green/10 text-emerald-200'
                          : 'border-slate-700 bg-slate-900/70 text-slate-400'
                      }`}
                    >
                      <Smartphone className="h-3 w-3" aria-hidden="true" />
                      <span>APK: {apkReady ? 'Ready' : 'Custom Needed'}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Sticky Step 1 Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gd-border bg-gd-panel/95 p-4">
            <div className="text-sm text-slate-300">
              Selected version:{' '}
              <strong className="text-gd-cyan">{selectedSpec.label}</strong>{' '}
              <span className="font-mono text-xs text-slate-400">
                ({selectedSpec.usesBase64Url ? 'Base64 44B URL' : 'ASCII 33B URL'})
              </span>
            </div>

            <button
              type="button"
              onClick={() => goToStep(2)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gd-cyan to-gd-green px-5 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-gd-cyan/20 transition hover:brightness-110"
            >
              <span>Continue to Server &amp; Client Setup</span>
              <ArrowRight className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
            </button>
          </div>
        </section>
      )}

      {/* STEP 2: Server & Client Configuration */}
      {step === 2 && (
        <section aria-labelledby={formTitleId} className="space-y-5">
          {/* Selected Version Summary Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gd-cyan/35 bg-gd-card/85 px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-12 items-center justify-center rounded-xl border border-gd-cyan/50 bg-gd-cyan/15 font-mono text-sm font-extrabold text-gd-cyan">
                {selectedSpec.id}
              </span>
              <div>
                <div className="text-sm font-bold text-white">{selectedSpec.label}</div>
                <div className="text-xs text-slate-400">
                  {selectedSpec.era} &bull;{' '}
                  {selectedSpec.usesBase64Url
                    ? 'Base64 44-byte URL Patching'
                    : 'ASCII 33-byte URL Patching (Smart Redirector supported)'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => goToStep(1)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gd-border bg-gd-panel px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-gd-cyan/50 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Change Version</span>
            </button>
          </div>

          <form
            noValidate
            aria-labelledby={formTitleId}
            onSubmit={handleSubmit}
            className="space-y-6 rounded-2xl border border-gd-border bg-gd-panel/90 p-6 shadow-xl shadow-black/30"
          >
            <h2
              id={formTitleId}
              ref={step2HeadingRef}
              tabIndex={-1}
              className="text-xl font-bold text-white focus:outline-none"
            >
              Step 2 — Server &amp; Client Configuration
            </h2>

            {submitError && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-rose-500/50 bg-rose-500/15 p-3.5 text-sm text-rose-200"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
                <span>{submitError}</span>
              </div>
            )}

            {/* Server Name & Port */}
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={nameId} className="text-sm font-semibold text-slate-200">
                  Server Name <span aria-hidden="true" className="text-gd-cyan">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  id={nameId}
                  name="serverName"
                  type="text"
                  required
                  minLength={2}
                  maxLength={48}
                  value={serverName}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={`${nameHelpId}${fieldErrors.name ? ` ${nameErrId}` : ''}`}
                  onChange={(e) => {
                    const val = e.target.value;
                    setServerName(val);
                    setNameEditedManually(true);
                    if (fieldErrors.name && !validateName(val)) {
                      setFieldErrors((prev) => ({ ...prev, name: undefined }));
                    }
                  }}
                  onBlur={() => {
                    setTouched((prev) => ({ ...prev, name: true }));
                    setFieldErrors((prev) => ({ ...prev, name: validateName(serverName) }));
                  }}
                  placeholder="e.g. NovaGDPS 2.2"
                  className="rounded-xl border border-gd-border bg-gd-bg px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-gd-cyan focus:outline-none"
                />
                <span id={nameHelpId} className="text-xs text-slate-400">
                  2–48 characters. Used for folder slug, download page title, and client labels.
                </span>
                {touched.name && fieldErrors.name && (
                  <span id={nameErrId} role="alert" className="text-xs font-medium text-rose-400">
                    {fieldErrors.name}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor={portId} className="text-sm font-semibold text-slate-200">
                  Custom Port <span className="text-xs font-normal text-slate-400">(Optional)</span>
                </label>
                <input
                  ref={portInputRef}
                  id={portId}
                  name="port"
                  type="text"
                  inputMode="numeric"
                  value={portInput}
                  aria-invalid={Boolean(fieldErrors.port)}
                  aria-describedby={`${portHelpId}${fieldErrors.port ? ` ${portErrId}` : ''}`}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPortInput(val);
                    if (fieldErrors.port && !validatePort(val)) {
                      setFieldErrors((prev) => ({ ...prev, port: undefined }));
                    }
                  }}
                  onBlur={() => {
                    setTouched((prev) => ({ ...prev, port: true }));
                    setFieldErrors((prev) => ({ ...prev, port: validatePort(portInput) }));
                  }}
                  placeholder="Auto-assign free port (recommended)"
                  className="rounded-xl border border-gd-border bg-gd-bg px-3.5 py-2.5 font-mono text-sm text-white placeholder:font-sans placeholder:text-slate-500 focus:border-gd-cyan focus:outline-none"
                />
                <span id={portHelpId} className="text-xs text-slate-400">
                  Leave blank to auto-assign an available port, or enter 1024–65535.
                </span>
                {touched.port && fieldErrors.port && (
                  <span id={portErrId} role="alert" className="text-xs font-medium text-rose-400">
                    {fieldErrors.port}
                  </span>
                )}
              </div>
            </div>

            {/* Network Mode Selector */}
            <fieldset className="space-y-3 rounded-2xl border border-gd-border bg-gd-bg/50 p-4">
              <legend className="px-1.5 text-sm font-bold text-white">
                Network &amp; Sharing Mode
              </legend>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {/* Localhost */}
                <label
                  className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 transition ${
                    networkMode === 'localhost'
                      ? 'border-gd-cyan bg-gd-card shadow-md shadow-gd-cyan/10'
                      : 'border-gd-border bg-gd-panel/70 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="networkMode"
                      value="localhost"
                      checked={networkMode === 'localhost'}
                      onChange={() => handleSelectNetworkMode('localhost')}
                      className="h-4 w-4"
                    />
                    <Laptop className="h-4 w-4 text-slate-300" aria-hidden="true" />
                    <span className="text-sm font-bold text-white">Localhost (127.0.0.1)</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Solo testing &amp; level building directly on this PC.
                  </p>
                </label>

                {/* LAN / Wi-Fi */}
                <label
                  className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 transition ${
                    networkMode === 'lan'
                      ? 'border-gd-cyan bg-gd-card shadow-md shadow-gd-cyan/10'
                      : 'border-gd-border bg-gd-panel/70 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="networkMode"
                      value="lan"
                      checked={networkMode === 'lan'}
                      onChange={() => handleSelectNetworkMode('lan')}
                      className="h-4 w-4"
                    />
                    <Wifi className="h-4 w-4 text-gd-cyan" aria-hidden="true" />
                    <span className="text-sm font-bold text-white">LAN / Wi-Fi</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Play with friends &amp; Android phones connected to your local Wi-Fi or router.
                  </p>
                </label>

                {/* VPN (Radmin / Hamachi / Tailscale) */}
                <label
                  className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 transition ${
                    networkMode === 'vpn'
                      ? 'border-gd-green bg-gd-card shadow-md shadow-gd-green/15'
                      : 'border-gd-border bg-gd-panel/70 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="networkMode"
                      value="vpn"
                      checked={networkMode === 'vpn'}
                      onChange={() => handleSelectNetworkMode('vpn')}
                      className="h-4 w-4"
                    />
                    <Shield className="h-4 w-4 text-gd-green" aria-hidden="true" />
                    <span className="text-sm font-bold text-white">
                      VPN (Radmin / Hamachi / Tailscale)
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Direct low-latency virtual LAN play with friends over Radmin VPN, Hamachi, or
                    Tailscale.
                  </p>
                </label>

                {/* VPS / Custom Domain */}
                <label
                  className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 transition ${
                    networkMode === 'vps'
                      ? 'border-gd-gold bg-gd-card shadow-md shadow-gd-gold/15'
                      : 'border-gd-border bg-gd-panel/70 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="networkMode"
                      value="vps"
                      checked={networkMode === 'vps'}
                      onChange={() => handleSelectNetworkMode('vps')}
                      className="h-4 w-4"
                    />
                    <Server className="h-4 w-4 text-gd-gold" aria-hidden="true" />
                    <span className="text-sm font-bold text-white">VPS / Custom Domain</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Point patched clients to your public VPS IP or short domain (ideal for 24/7
                    hosting).
                  </p>
                </label>

                {/* Public Share (Cloudflare Quick Tunnel) */}
                <label
                  className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-3.5 transition sm:col-span-2 lg:col-span-2 ${
                    networkMode === 'tunnel'
                      ? 'border-gd-purple bg-gd-card shadow-md shadow-gd-purple/15'
                      : 'border-gd-border bg-gd-panel/70 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <input
                      type="radio"
                      name="networkMode"
                      value="tunnel"
                      checked={networkMode === 'tunnel'}
                      onChange={() => handleSelectNetworkMode('tunnel')}
                      className="h-4 w-4"
                    />
                    <Globe className="h-4 w-4 text-gd-purple" aria-hidden="true" />
                    <span className="text-sm font-bold text-white">Cloudflare Quick Tunnel</span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Instant public HTTPS Quick Tunnel for friends anywhere—no router port
                    forwarding required.
                  </p>
                </label>
              </div>

              {/* Localhost + Android Warning */}
              {networkMode === 'localhost' && buildAndroid && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/45 bg-amber-400/10 p-3 text-xs text-amber-100">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <span>
                      <strong>Android Notice:</strong> Phones and emulators cannot connect to{' '}
                      <code className="font-mono">127.0.0.1</code>. Use{' '}
                      <strong>LAN / Wi-Fi</strong>, <strong>VPN</strong>, or{' '}
                      <strong>VPS / Custom Domain</strong> so your Android APK connects cleanly.
                    </span>
                  </div>
                  {primaryLanInterface && (
                    <button
                      type="button"
                      onClick={() => {
                        setNetworkMode('lan');
                        setLanHost(primaryLanInterface.address);
                      }}
                      className="rounded-lg border border-amber-300/50 bg-amber-400/20 px-2.5 py-1 font-bold text-amber-100 hover:bg-amber-400/30"
                    >
                      Use LAN ({primaryLanInterface.address})
                    </button>
                  )}
                </div>
              )}

              {/* LAN / Wi-Fi Details Panel */}
              {networkMode === 'lan' && (
                <div className="mt-3 space-y-3 rounded-xl border border-gd-cyan/30 bg-gd-panel/90 p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor={lanSelectId} className="text-xs font-semibold text-slate-200">
                          Detected LAN / Wi-Fi Interfaces
                        </label>
                        <button
                          type="button"
                          onClick={loadNetworkInterfaces}
                          disabled={loadingInterfaces}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-gd-cyan hover:underline disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${loadingInterfaces ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          <span>Refresh</span>
                        </button>
                      </div>
                      <select
                        id={lanSelectId}
                        value={interfaces.some((i) => i.address === lanHost) ? lanHost : ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            setLanHost(e.target.value);
                            setFieldErrors((prev) => ({ ...prev, lanHost: undefined }));
                          }
                        }}
                        className="rounded-xl border border-gd-border bg-gd-bg px-3 py-2 text-xs text-white focus:border-gd-cyan focus:outline-none"
                      >
                        <option value="">-- Choose detected LAN interface --</option>
                        {lanInterfaces.length > 0 && (
                          <optgroup label="Recommended LAN / Wi-Fi Adapters">
                            {lanInterfaces.map((iface) => (
                              <option key={`lan-${iface.name}-${iface.address}`} value={iface.address}>
                                [LAN] {iface.name} ({iface.address})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {vpnInterfaces.length > 0 && (
                          <optgroup label="VPN Adapters">
                            {vpnInterfaces.map((iface) => (
                              <option key={`vpn-${iface.name}-${iface.address}`} value={iface.address}>
                                [VPN] {iface.name} ({iface.address})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {otherInterfaces.length > 0 && (
                          <optgroup label="Virtual Adapters">
                            {otherInterfaces.map((iface) => (
                              <option key={`virt-${iface.name}-${iface.address}`} value={iface.address}>
                                [Virtual] {iface.name} ({iface.address})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={lanInputId} className="text-xs font-semibold text-slate-200">
                        LAN / Wi-Fi IP Address or Hostname
                      </label>
                      <input
                        ref={lanInputRef}
                        id={lanInputId}
                        name="lanHost"
                        type="text"
                        value={lanHost}
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-invalid={Boolean(fieldErrors.lanHost)}
                        aria-describedby={fieldErrors.lanHost ? lanErrId : undefined}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLanHost(val);
                          if (fieldErrors.lanHost && !validateLanHost(val, 'lan')) {
                            setFieldErrors((prev) => ({ ...prev, lanHost: undefined }));
                          }
                        }}
                        onBlur={() => {
                          setTouched((prev) => ({ ...prev, lanHost: true }));
                          setFieldErrors((prev) => ({
                            ...prev,
                            lanHost: validateLanHost(lanHost, 'lan'),
                          }));
                        }}
                        placeholder="e.g. 192.168.1.42"
                        className="rounded-xl border border-gd-border bg-gd-bg px-3 py-2 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-gd-cyan focus:outline-none"
                      />
                      {touched.lanHost && fieldErrors.lanHost && (
                        <span id={lanErrId} role="alert" className="text-xs font-medium text-rose-400">
                          {fieldErrors.lanHost}
                        </span>
                      )}
                    </div>
                  </div>

                  {lanInterfaces.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-400">Quick-pick LAN IP:</span>
                      {lanInterfaces.map((iface) => {
                        const selected = lanHost === iface.address;
                        return (
                          <button
                            key={`pill-lan-${iface.address}`}
                            type="button"
                            onClick={() => {
                              setLanHost(iface.address);
                              setFieldErrors((prev) => ({ ...prev, lanHost: undefined }));
                            }}
                            className={`rounded-md border px-2 py-0.5 font-mono transition ${
                              selected
                                ? 'border-gd-cyan bg-gd-cyan/20 text-gd-cyan'
                                : 'border-gd-border bg-gd-bg text-slate-300 hover:border-gd-cyan/50'
                            }`}
                          >
                            {iface.name}: {iface.address}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* VPN (Radmin / Hamachi / Tailscale) Details Panel */}
              {networkMode === 'vpn' && (
                <div className="mt-3 space-y-3 rounded-xl border border-gd-green/35 bg-gd-panel/90 p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor={lanSelectId} className="text-xs font-semibold text-slate-200">
                          Detected VPN Interfaces (Radmin / Hamachi / Tailscale)
                        </label>
                        <button
                          type="button"
                          onClick={loadNetworkInterfaces}
                          disabled={loadingInterfaces}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-gd-green hover:underline disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${loadingInterfaces ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          <span>Refresh</span>
                        </button>
                      </div>
                      <select
                        id={lanSelectId}
                        value={interfaces.some((i) => i.address === lanHost) ? lanHost : ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            setLanHost(e.target.value);
                            setFieldErrors((prev) => ({ ...prev, lanHost: undefined }));
                          }
                        }}
                        className="rounded-xl border border-gd-border bg-gd-bg px-3 py-2 text-xs text-white focus:border-gd-green focus:outline-none"
                      >
                        <option value="">-- Choose detected VPN interface --</option>
                        {vpnInterfaces.length > 0 && (
                          <optgroup label="Detected VPN Adapters">
                            {vpnInterfaces.map((iface) => (
                              <option key={`vpn-${iface.name}-${iface.address}`} value={iface.address}>
                                [VPN] {iface.name} ({iface.address})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {lanInterfaces.length > 0 && (
                          <optgroup label="Other Local Interfaces">
                            {lanInterfaces.map((iface) => (
                              <option key={`lan-${iface.name}-${iface.address}`} value={iface.address}>
                                [LAN] {iface.name} ({iface.address})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                      {vpnInterfaces.length === 0 && (
                        <span className="text-[11px] text-amber-200/90">
                          No active VPN adapter detected yet. Start Radmin VPN, Hamachi, or
                          Tailscale and click Refresh, or enter your VPN IP manually.
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={lanInputId} className="text-xs font-semibold text-slate-200">
                        VPN IP Address (e.g. Radmin 26.x.x.x / Hamachi 25.x.x.x)
                      </label>
                      <input
                        ref={lanInputRef}
                        id={lanInputId}
                        name="lanHost"
                        type="text"
                        value={lanHost}
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        aria-invalid={Boolean(fieldErrors.lanHost)}
                        aria-describedby={fieldErrors.lanHost ? lanErrId : undefined}
                        onChange={(e) => {
                          const val = e.target.value;
                          setLanHost(val);
                          if (fieldErrors.lanHost && !validateLanHost(val, 'vpn')) {
                            setFieldErrors((prev) => ({ ...prev, lanHost: undefined }));
                          }
                        }}
                        onBlur={() => {
                          setTouched((prev) => ({ ...prev, lanHost: true }));
                          setFieldErrors((prev) => ({
                            ...prev,
                            lanHost: validateLanHost(lanHost, 'vpn'),
                          }));
                        }}
                        placeholder="e.g. 26.142.88.15 or 100.64.0.12"
                        className="rounded-xl border border-gd-border bg-gd-bg px-3 py-2 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-gd-green focus:outline-none"
                      />
                      {touched.lanHost && fieldErrors.lanHost && (
                        <span id={lanErrId} role="alert" className="text-xs font-medium text-rose-400">
                          {fieldErrors.lanHost}
                        </span>
                      )}
                    </div>
                  </div>

                  {vpnInterfaces.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="text-slate-400">Detected VPN IPs:</span>
                      {vpnInterfaces.map((iface) => {
                        const selected = lanHost === iface.address;
                        return (
                          <button
                            key={`pill-vpn-${iface.address}`}
                            type="button"
                            onClick={() => {
                              setLanHost(iface.address);
                              setFieldErrors((prev) => ({ ...prev, lanHost: undefined }));
                            }}
                            className={`rounded-md border px-2 py-0.5 font-mono transition ${
                              selected
                                ? 'border-gd-green bg-gd-green/20 text-gd-green'
                                : 'border-gd-border bg-gd-bg text-slate-300 hover:border-gd-green/50'
                            }`}
                          >
                            {iface.name}: {iface.address}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* VPS / Custom Domain Details Panel */}
              {networkMode === 'vps' && (
                <div className="mt-3 space-y-2.5 rounded-xl border border-gd-gold/35 bg-gd-panel/90 p-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor={vpsInputId} className="text-xs font-semibold text-slate-200">
                        VPS Public URL or Custom Domain <span aria-hidden="true" className="text-gd-gold">*</span>
                      </label>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold ${
                          !vpsUrl.trim()
                            ? 'border-slate-700 bg-slate-800/80 text-slate-400'
                            : vpsByteInfo.withinDirectPatchLimit
                              ? 'border-gd-green/45 bg-gd-green/15 text-gd-green'
                              : 'border-amber-400/50 bg-amber-400/15 text-amber-200'
                        }`}
                      >
                        <span>{vpsByteInfo.patchedBytes} / 33 bytes</span>
                        {vpsUrl.trim() && (
                          <span>
                            {vpsByteInfo.withinDirectPatchLimit
                              ? '• Direct Binary Patch Ready!'
                              : '• Over 33-Byte Limit'}
                          </span>
                        )}
                      </span>
                    </div>

                    <input
                      ref={vpsInputRef}
                      id={vpsInputId}
                      name="vpsUrl"
                      type="url"
                      value={vpsUrl}
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-invalid={Boolean(fieldErrors.vpsUrl)}
                      aria-describedby={`${vpsHelpId}${fieldErrors.vpsUrl ? ` ${vpsErrId}` : ''}`}
                      onChange={(e) => {
                        const val = e.target.value;
                        setVpsUrl(val);
                        if (fieldErrors.vpsUrl && !validateVpsUrl(val, 'vps')) {
                          setFieldErrors((prev) => ({ ...prev, vpsUrl: undefined }));
                        }
                      }}
                      onBlur={() => {
                        setTouched((prev) => ({ ...prev, vpsUrl: true }));
                        setFieldErrors((prev) => ({
                          ...prev,
                          vpsUrl: validateVpsUrl(vpsUrl, 'vps'),
                        }));
                      }}
                      placeholder="http://203.0.113.10:8080 or https://gd.myvps.com"
                      className="rounded-xl border border-gd-border bg-gd-bg px-3 py-2 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-gd-gold focus:outline-none"
                    />

                    <div id={vpsHelpId} className="space-y-1 text-[11px] text-slate-400">
                      <p>
                        Geometry Dash&apos;s binary URL slot holds at most{' '}
                        <strong className="text-slate-200">33 UTF-8 bytes</strong> (matching{' '}
                        <code className="font-mono text-slate-300">http://www.boomlings.com/database</code>
                        ). Keep your base URL &le; 24 bytes so{' '}
                        <code className="font-mono text-slate-300">/database</code> fits directly.
                      </p>
                      {vpsByteInfo.patchedEndpoint && (
                        <p className="font-mono text-[11px] text-slate-300">
                          Patched endpoint preview:{' '}
                          <span
                            className={
                              vpsByteInfo.withinDirectPatchLimit ? 'text-gd-green' : 'text-amber-300'
                            }
                          >
                            {vpsByteInfo.patchedEndpoint}
                          </span>
                        </p>
                      )}
                      {vpsUrl.trim() && !vpsByteInfo.withinDirectPatchLimit && (
                        <p className="flex items-start gap-1.5 text-amber-200">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                          <span>
                            Exceeds 33 bytes ({vpsByteInfo.patchedBytes} bytes). Use a shorter
                            domain/IP (e.g. <code className="font-mono">https://gd.myvps.com</code>)
                            for guaranteed direct binary patching without needing a redirector.
                          </span>
                        </p>
                      )}
                    </div>

                    {touched.vpsUrl && fieldErrors.vpsUrl && (
                      <span id={vpsErrId} role="alert" className="text-xs font-medium text-rose-400">
                        {fieldErrors.vpsUrl}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Tunnel Note */}
              {networkMode === 'tunnel' && (
                <div className="mt-3 space-y-2 rounded-xl border border-gd-purple/35 bg-gd-purple/10 p-3.5 text-xs text-purple-100">
                  {!runtimeStatus?.cloudflaredReady && (
                    <p className="flex items-start gap-2 text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                      <span>
                        <strong>cloudflared was not detected:</strong> You can still create this
                        server, and install <code className="font-mono">cloudflared</code> before
                        starting the tunnel.
                      </span>
                    </p>
                  )}
                  <p className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-gd-purple" aria-hidden="true" />
                    <span>
                      Cloudflare Quick Tunnels assign a dynamic{' '}
                      <code className="font-mono">https://*.trycloudflare.com</code> URL when you
                      start the server. Once started, you can share the Friend Download Page
                      directly from the Control Panel.
                    </span>
                  </p>
                  <p className="flex items-start gap-2 text-amber-200/95">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                    <span>
                      <strong>33-Byte Binary URL Limit Note:</strong> Generated{' '}
                      <code className="font-mono">*.trycloudflare.com</code> URLs are usually
                      42–52 characters long, which exceeds Geometry Dash&apos;s 33-byte in-binary
                      URL slot. Direct patching requires a &le; 33-byte endpoint—for zero-limit
                      public play with friends, consider <strong>VPN (Radmin / Hamachi)</strong> or
                      a short <strong>VPS / Custom Domain</strong>.
                    </span>
                  </p>
                </div>
              )}
            </fieldset>

            {/* Client Builder Options (Windows .exe & Android .apk) */}
            <fieldset className="space-y-4 rounded-2xl border border-gd-border bg-gd-bg/50 p-4">
              <legend className="px-1.5 text-sm font-bold text-white">
                Dual Client Builder (Windows .exe &amp; Android .apk)
              </legend>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Windows Client Box */}
                <div className="flex flex-col justify-between rounded-xl border border-gd-border bg-gd-panel/80 p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-bold text-white">
                        <input
                          type="checkbox"
                          checked={buildWindows}
                          onChange={(e) => setBuildWindows(e.target.checked)}
                          className="h-4 w-4 rounded"
                        />
                        <Monitor className="h-4 w-4 text-gd-cyan" aria-hidden="true" />
                        <span>Build Windows Client (.exe)</span>
                      </label>

                      {selectedTemplate?.windowsReady ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-gd-green/35 bg-gd-green/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                          <CheckCircle2 className="h-3 w-3 text-gd-green" aria-hidden="true" />
                          <span>Template Ready</span>
                        </span>
                      ) : (
                        <span className="rounded-md border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                          No Template
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400">
                      Patches the GD {selectedVersion} Windows executable and packages a ready-to-play{' '}
                      <code className="font-mono">.zip</code> bundle for friends.
                    </p>

                    {buildWindows && (
                      <div className="space-y-2.5 pt-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePickBaseFile('windows')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gd-border bg-gd-card px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-gd-cyan/60 hover:text-white"
                          >
                            <FolderOpen className="h-3.5 w-3.5 text-gd-cyan" aria-hidden="true" />
                            <span>Select Custom Base .exe</span>
                          </button>

                          {customWindowsBasePath && (
                            <button
                              type="button"
                              onClick={() => setCustomWindowsBasePath('')}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-white"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                              <span>Clear</span>
                            </button>
                          )}
                        </div>

                        {customWindowsBasePath ? (
                          <div className="truncate rounded-lg border border-gd-cyan/30 bg-gd-bg px-2.5 py-1.5 font-mono text-[11px] text-gd-cyan">
                            {customWindowsBasePath}
                          </div>
                        ) : !selectedTemplate?.windowsReady ? (
                          <p className="flex items-start gap-1.5 text-xs text-amber-200/90">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                            <span>
                              No pre-loaded v{selectedVersion} Windows template found. Select a
                              custom base <code className="font-mono">.exe</code> above or build
                              later from the Control Panel.
                            </span>
                          </p>
                        ) : null}

                        {(!selectedTemplate?.windowsReady || customWindowsBasePath) && (
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={saveCustomWindowsToTemplate}
                              onChange={(e) => setSaveCustomWindowsToTemplate(e.target.checked)}
                              className="h-3.5 w-3.5 rounded"
                            />
                            <span>
                              Save imported file to template library for future servers
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Android Client Box */}
                <div className="flex flex-col justify-between rounded-xl border border-gd-border bg-gd-panel/80 p-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-bold text-white">
                        <input
                          type="checkbox"
                          checked={buildAndroid}
                          onChange={(e) => setBuildAndroid(e.target.checked)}
                          className="h-4 w-4 rounded"
                        />
                        <Smartphone className="h-4 w-4 text-gd-green" aria-hidden="true" />
                        <span>Build Android Client (.apk)</span>
                      </label>

                      {selectedTemplate?.androidReady ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-gd-green/35 bg-gd-green/10 px-2 py-0.5 text-[11px] font-medium text-emerald-200">
                          <CheckCircle2 className="h-3 w-3 text-gd-green" aria-hidden="true" />
                          <span>Template Ready</span>
                        </span>
                      ) : (
                        <span className="rounded-md border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                          No Template
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400">
                      Patches <code className="font-mono">libcocos2dcpp.so</code> /{' '}
                      <code className="font-mono">libgame.so</code> inside the APK, aligns, and
                      signs it with <code className="font-mono">uber-apk-signer</code>.
                    </p>

                    {buildAndroid && (
                      <div className="space-y-2.5 pt-1">
                        {!androidSigningToolsReady && (
                          <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/35 bg-amber-400/10 px-2.5 py-2 text-xs text-amber-200">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                            <span>
                              Android signing tools (Java / zipalign / uber-apk-signer) are not
                              fully ready. Check Runtime Readiness on the dashboard if APK signing
                              fails.
                            </span>
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handlePickBaseFile('android')}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-gd-border bg-gd-card px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-gd-cyan/60 hover:text-white"
                          >
                            <FolderOpen className="h-3.5 w-3.5 text-gd-green" aria-hidden="true" />
                            <span>Select Custom Base .apk</span>
                          </button>

                          {customAndroidBasePath && (
                            <button
                              type="button"
                              onClick={() => setCustomAndroidBasePath('')}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-white"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                              <span>Clear</span>
                            </button>
                          )}
                        </div>

                        {customAndroidBasePath ? (
                          <div className="truncate rounded-lg border border-gd-green/30 bg-gd-bg px-2.5 py-1.5 font-mono text-[11px] text-gd-green">
                            {customAndroidBasePath}
                          </div>
                        ) : !selectedTemplate?.androidReady ? (
                          <p className="flex items-start gap-1.5 text-xs text-amber-200/90">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                            <span>
                              No pre-loaded v{selectedVersion} Android template found. Select a
                              custom base <code className="font-mono">.apk</code> above or build
                              later from the Control Panel.
                            </span>
                          </p>
                        ) : null}

                        {(!selectedTemplate?.androidReady || customAndroidBasePath) && (
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                            <input
                              type="checkbox"
                              checked={saveCustomAndroidToTemplate}
                              onChange={(e) => setSaveCustomAndroidToTemplate(e.target.checked)}
                              className="h-3.5 w-3.5 rounded"
                            />
                            <span>
                              Save imported file to template library for future servers
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Footer Submit Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gd-border/70 pt-4">
              <button
                type="button"
                onClick={() => goToStep(1)}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gd-border bg-gd-card px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>Back to Version</span>
              </button>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-gd-cyan to-gd-green px-6 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-gd-cyan/25 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Provisioning Server &amp; Clients...</span>
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" aria-hidden="true" />
                    <span>Create &amp; Launch GDPS Server</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
};
