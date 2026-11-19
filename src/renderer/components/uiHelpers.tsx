import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Globe,
  Laptop,
  Loader2,
  Server,
  Shield,
  Wifi,
} from 'lucide-react';
import type { NetworkInterfaceInfo, NetworkMode, ServerStatus } from '@shared/types';

export function ServerStatusBadge({ status }: { status: ServerStatus }) {
  const styles: Record<
    ServerStatus,
    { label: string; badgeClass: string; dotClass: string; spin?: boolean }
  > = {
    running: {
      label: 'Running',
      badgeClass: 'border-gd-green/40 bg-gd-green/10 text-gd-green',
      dotClass: 'bg-gd-green shadow-[0_0_8px_#38f26e]',
    },
    starting: {
      label: 'Starting',
      badgeClass: 'border-gd-gold/40 bg-gd-gold/10 text-gd-gold',
      dotClass: 'bg-gd-gold',
      spin: true,
    },
    stopped: {
      label: 'Stopped',
      badgeClass: 'border-slate-600/60 bg-slate-800/70 text-slate-300',
      dotClass: 'bg-slate-400',
    },
    error: {
      label: 'Error',
      badgeClass: 'border-rose-500/45 bg-rose-500/15 text-rose-300',
      dotClass: 'bg-rose-400',
    },
  };

  const cfg = styles[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide ${cfg.badgeClass}`}
    >
      {cfg.spin ? (
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      ) : status === 'error' ? (
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      ) : (
        <span className={`h-2 w-2 rounded-full ${cfg.dotClass}`} aria-hidden="true" />
      )}
      <span>{cfg.label}</span>
    </span>
  );
}

export function NetworkModeBadge({ mode }: { mode: NetworkMode }) {
  switch (mode) {
    case 'tunnel':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-gd-purple/40 bg-gd-purple/15 px-2 py-0.5 text-xs font-medium text-purple-200">
          <Globe className="h-3.5 w-3.5 text-gd-purple" aria-hidden="true" />
          <span>Cloudflare Tunnel</span>
        </span>
      );
    case 'vps':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-gd-gold/40 bg-gd-gold/10 px-2 py-0.5 text-xs font-medium text-amber-200">
          <Server className="h-3.5 w-3.5 text-gd-gold" aria-hidden="true" />
          <span>VPS / Custom Domain</span>
        </span>
      );
    case 'vpn':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-gd-green/40 bg-gd-green/10 px-2 py-0.5 text-xs font-medium text-emerald-200">
          <Shield className="h-3.5 w-3.5 text-gd-green" aria-hidden="true" />
          <span>VPN (Radmin / Hamachi)</span>
        </span>
      );
    case 'lan':
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-gd-cyan/35 bg-gd-cyan/10 px-2 py-0.5 text-xs font-medium text-cyan-200">
          <Wifi className="h-3.5 w-3.5 text-gd-cyan" aria-hidden="true" />
          <span>LAN / Wi-Fi</span>
        </span>
      );
    case 'localhost':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-600/60 bg-slate-800/80 px-2 py-0.5 text-xs font-medium text-slate-300">
          <Laptop className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span>Localhost</span>
        </span>
      );
  }
}

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  title?: string;
}

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  className = '',
  title = 'Copy to clipboard',
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await window.easyGdps.copyToClipboard(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback if clipboard IPC fails
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-gd-border bg-gd-panel px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-gd-cyan/60 hover:text-white ${className}`}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-gd-green" aria-hidden="true" />
          <span className="text-gd-green">{copiedLabel}</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5 text-gd-cyan" aria-hidden="true" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}

export function formatUnixTimestamp(ts: number): string {
  if (!ts || Number.isNaN(ts)) return 'Unknown';
  const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts;
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return String(ts);
  }
}

export function getFriendDownloadUrl(baseUrl: string): string {
  const cleaned = baseUrl.trim().replace(/\/+$/, '').replace(/\/database$/, '');
  return cleaned || baseUrl;
}

export function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function getVpsPatchByteInfo(rawUrl: string): {
  cleanedBase: string;
  patchedEndpoint: string;
  rawBytes: number;
  patchedBytes: number;
  withinDirectPatchLimit: boolean;
} {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return {
      cleanedBase: '',
      patchedEndpoint: '',
      rawBytes: 0,
      patchedBytes: 0,
      withinDirectPatchLimit: true,
    };
  }
  const patchedEndpoint = /\/database$/i.test(trimmed) ? trimmed : `${trimmed}/database`;
  const rawBytes = getUtf8ByteLength(trimmed);
  const patchedBytes = getUtf8ByteLength(patchedEndpoint);
  return {
    cleanedBase: trimmed,
    patchedEndpoint,
    rawBytes,
    patchedBytes,
    withinDirectPatchLimit: patchedBytes <= 33,
  };
}

export function classifyInterfaceKind(iface: NetworkInterfaceInfo): 'lan' | 'vpn' | 'virtual' {
  if (iface.kind) return iface.kind;
  const lower = iface.name.toLowerCase();
  if (
    lower.includes('virtualbox') ||
    lower.includes('vmware') ||
    lower.includes('vethernet') ||
    lower.includes('hyper-v') ||
    lower.includes('vbox') ||
    iface.address.startsWith('192.168.56.')
  ) {
    return 'virtual';
  }
  if (
    lower.includes('radmin') ||
    lower.includes('hamachi') ||
    lower.includes('zerotier') ||
    lower.includes('tailscale') ||
    lower.includes('wireguard') ||
    lower.includes('vpn') ||
    iface.address.startsWith('26.') ||
    iface.address.startsWith('25.') ||
    iface.address.startsWith('100.')
  ) {
    return 'vpn';
  }
  return 'lan';
}

export function isValidRgbString(rgb: string): boolean {
  const parts = rgb.trim().split(',');
  if (parts.length !== 3) return false;
  return parts.every((part) => {
    if (!/^\d{1,3}$/.test(part.trim())) return false;
    const n = Number(part.trim());
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function rgbStringToHex(rgb: string, fallback = '#ffffff'): string {
  if (!isValidRgbString(rgb)) return fallback;
  const [r, g, b] = rgb.split(',').map((p) => Number(p.trim()));
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToRgbString(hex: string): string {
  const clean = hex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '255,255,255';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

export function toCssRgb(rgb: string, fallback = 'rgb(255, 255, 255)'): string {
  if (!isValidRgbString(rgb)) return fallback;
  const [r, g, b] = rgb.split(',').map((p) => Number(p.trim()));
  return `rgb(${r}, ${g}, ${b})`;
}
