#!/usr/bin/env node
/**
 * EasyGDPS Studio — Portable Runtime Fetcher
 *
 * Downloads and verifies Windows portable runtime dependencies into resources/runtime/:
 *   - Portable PHP 8.2+ (Windows x64 NTS) with pdo_sqlite, sqlite3, curl, mbstring, openssl, fileinfo
 *   - uber-apk-signer.jar (latest GitHub release)
 *   - zipalign.exe (from official Android SDK build-tools Windows package)
 *   - cloudflared.exe (latest Windows amd64 release)
 *   - Portable JRE 21 (Eclipse Temurin Windows x64 JRE) [optional via --skip-jre]
 *
 * Usage:
 *   node scripts/fetch-runtimes.js [--skip-jre] [--force] [--only php,zipalign,...] [--dest <path>]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');

const USER_AGENT = 'EasyGDPS-Studio-Fetcher/1.0';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_RUNTIME_DIR = path.join(PROJECT_ROOT, 'resources', 'runtime');

const ALL_COMPONENTS = ['php', 'uber-apk-signer', 'zipalign', 'cloudflared', 'jre'];

function parseArgs(argv) {
  const opts = {
    skipJre: false,
    force: false,
    only: null,
    dest: DEFAULT_RUNTIME_DIR,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--skip-jre') {
      opts.skipJre = true;
    } else if (arg === '--force') {
      opts.force = true;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--only' && i + 1 < argv.length) {
      opts.only = argv[++i]
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg.startsWith('--only=')) {
      opts.only = arg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === '--dest' && i + 1 < argv.length) {
      opts.dest = path.resolve(argv[++i]);
    } else if (arg.startsWith('--dest=')) {
      opts.dest = path.resolve(arg.slice('--dest='.length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.only) {
    for (const name of opts.only) {
      if (!ALL_COMPONENTS.includes(name)) {
        throw new Error(
          `Invalid component in --only: "${name}". Valid values: ${ALL_COMPONENTS.join(', ')}`
        );
      }
    }
  }

  return opts;
}

function printUsage() {
  console.log(
    [
      'EasyGDPS Studio Runtime Fetcher',
      '',
      'Usage:',
      '  node scripts/fetch-runtimes.js [options]',
      '',
      'Options:',
      '  --skip-jre            Skip downloading Eclipse Temurin Portable JRE (~45 MB)',
      '  --force               Re-download and overwrite components even if already verified',
      '  --only <list>         Comma-separated subset: php,uber-apk-signer,zipalign,cloudflared,jre',
      '  --dest <dir>          Target runtime directory (default: resources/runtime)',
      '  -h, --help            Show this help message',
    ].join('\n')
  );
}

function log(component, message) {
  console.log(`[${component}] ${message}`);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  const headers = {
    'User-Agent': USER_AGENT,
    ...(options.headers || {}),
  };

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers,
        redirect: 'follow',
        signal: options.signal || AbortSignal.timeout(120000),
      });

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        const err = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
        if (!retryable || attempt === retries) {
          throw err;
        }
        lastError = err;
      } else {
        return response;
      }
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
    }

    const backoffMs = 1000 * Math.pow(2, attempt - 1);
    console.warn(`  Retry ${attempt}/${retries - 1} in ${backoffMs}ms (${lastError.message})`);
    await sleep(backoffMs);
  }

  throw lastError;
}

async function fetchJson(url, extraHeaders = {}) {
  const res = await fetchWithRetry(url, { headers: extraHeaders });
  return res.json();
}

async function fetchText(url, extraHeaders = {}) {
  const res = await fetchWithRetry(url, { headers: extraHeaders });
  return res.text();
}

async function downloadFile(url, destPath, expectedChecksum = null, hashAlgorithm = 'sha256') {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.download.${process.pid}`;

  try {
    const res = await fetchWithRetry(url, {
      signal: AbortSignal.timeout(300000),
    });

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      throw new Error(`Downloaded empty file from ${url}`);
    }

    if (expectedChecksum) {
      const actual = crypto
        .createHash(hashAlgorithm)
        .update(buffer)
        .digest('hex')
        .toLowerCase();
      const expected = expectedChecksum.trim().toLowerCase();
      if (actual !== expected) {
        throw new Error(
          `${hashAlgorithm.toUpperCase()} mismatch for ${path.basename(destPath)}: expected ${expected}, got ${actual}`
        );
      }
    }

    fs.writeFileSync(tempPath, buffer);
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }
    fs.renameSync(tempPath, destPath);
    return buffer.length;
  } finally {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

function safeExtractZip(zipPath, targetDir, options = {}) {
  const { stripTopDir = false, filterEntry = null } = options;
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  // Detect common top-level directory when stripTopDir is requested
  let topDirPrefix = '';
  if (stripTopDir && entries.length > 0) {
    const firstParts = new Set(
      entries
        .map((e) => e.entryName.replace(/\\/g, '/').split('/')[0])
        .filter(Boolean)
    );
    if (firstParts.size === 1) {
      topDirPrefix = `${[...firstParts][0]}/`;
    }
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const resolvedTarget = path.resolve(targetDir);
  let extractedCount = 0;

  for (const entry of entries) {
    let relName = entry.entryName.replace(/\\/g, '/');
    if (topDirPrefix && relName.startsWith(topDirPrefix)) {
      relName = relName.slice(topDirPrefix.length);
    }
    if (!relName || relName === '/') continue;

    if (filterEntry && !filterEntry(relName, entry)) {
      continue;
    }

    const outPath = path.resolve(resolvedTarget, relName);
    if (outPath !== resolvedTarget && !outPath.startsWith(resolvedTarget + path.sep)) {
      throw new Error(`Blocked unsafe zip entry path: ${entry.entryName}`);
    }

    if (entry.isDirectory) {
      fs.mkdirSync(outPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, entry.getData());
      extractedCount++;
    }
  }

  return extractedCount;
}

function ensureNonEmptyFile(filePath, minBytes = 1024) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  return stat.isFile() && stat.size >= minBytes;
}

function hasPeHeader(filePath) {
  if (!ensureNonEmptyFile(filePath, 64)) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    return buf[0] === 0x4d && buf[1] === 0x5a; // 'MZ'
  } finally {
    fs.closeSync(fd);
  }
}

function hasZipHeader(filePath) {
  if (!ensureNonEmptyFile(filePath, 64)) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    return buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  } finally {
    fs.closeSync(fd);
  }
}

function clearDirectoryPreserveGitkeep(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    const fullPath = path.join(dirPath, entry.name);
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 1. Portable PHP 8.2+ (Windows x64 NTS)
// ---------------------------------------------------------------------------

function configurePhpIni(phpDir) {
  const prodIni = path.join(phpDir, 'php.ini-production');
  const devIni = path.join(phpDir, 'php.ini-development');
  const targetIni = path.join(phpDir, 'php.ini');

  const sourceIni = fs.existsSync(prodIni) ? prodIni : fs.existsSync(devIni) ? devIni : null;
  if (!sourceIni) {
    throw new Error(`Neither php.ini-production nor php.ini-development found in ${phpDir}`);
  }

  let ini = fs.readFileSync(sourceIni, 'utf8');

  const replacements = [
    {
      regex: /^;?\s*extension_dir\s*=\s*"ext"\s*$/m,
      line: 'extension_dir = "ext"',
    },
    {
      regex: /^;?\s*extension\s*=\s*pdo_sqlite\s*$/m,
      line: 'extension=pdo_sqlite',
    },
    {
      regex: /^;?\s*extension\s*=\s*sqlite3\s*$/m,
      line: 'extension=sqlite3',
    },
    {
      regex: /^;?\s*extension\s*=\s*curl\s*$/m,
      line: 'extension=curl',
    },
    {
      regex: /^;?\s*extension\s*=\s*mbstring\s*$/m,
      line: 'extension=mbstring',
    },
    {
      regex: /^;?\s*extension\s*=\s*openssl\s*$/m,
      line: 'extension=openssl',
    },
    {
      regex: /^;?\s*extension\s*=\s*fileinfo\s*$/m,
      line: 'extension=fileinfo',
    },
    {
      regex: /^;?\s*upload_max_filesize\s*=.*$/m,
      line: 'upload_max_filesize = 64M',
    },
    {
      regex: /^;?\s*post_max_size\s*=.*$/m,
      line: 'post_max_size = 64M',
    },
    {
      regex: /^;?\s*max_execution_time\s*=.*$/m,
      line: 'max_execution_time = 60',
    },
    {
      regex: /^;?\s*default_charset\s*=.*$/m,
      line: 'default_charset = "UTF-8"',
    },
  ];

  const missing = [];
  for (const item of replacements) {
    if (item.regex.test(ini)) {
      ini = ini.replace(item.regex, item.line);
    } else {
      missing.push(item.line);
    }
  }

  if (missing.length > 0) {
    ini += `\n; Added by EasyGDPS Studio runtime fetcher\n${missing.join('\n')}\n`;
  }

  fs.writeFileSync(targetIni, ini, 'utf8');
}

function verifyPhp(phpDir) {
  const phpExe = path.join(phpDir, 'php.exe');
  const phpIni = path.join(phpDir, 'php.ini');
  if (!hasPeHeader(phpExe) || !ensureNonEmptyFile(phpIni, 100)) {
    return { ok: false, reason: 'php.exe or php.ini missing' };
  }

  if (process.platform !== 'win32') {
    return {
      ok: true,
      detail: 'php.exe and php.ini verified on disk (non-Windows host; skipped execution check)',
    };
  }

  try {
    const versionOut = execFileSync(phpExe, ['-c', phpIni, '-v'], {
      encoding: 'utf8',
      timeout: 15000,
    }).trim();
    const firstLine = versionOut.split(/\r?\n/)[0] || '';
    const versionMatch = firstLine.match(/PHP\s+(\d+)\.(\d+)\.(\d+)/i);
    if (!versionMatch) {
      return { ok: false, reason: `Unexpected php -v output: ${firstLine}` };
    }
    const major = Number(versionMatch[1]);
    const minor = Number(versionMatch[2]);
    if (major < 8 || (major === 8 && minor < 2)) {
      return { ok: false, reason: `PHP version ${major}.${minor} is below 8.2` };
    }

    const modulesOut = execFileSync(phpExe, ['-c', phpIni, '-m'], {
      encoding: 'utf8',
      timeout: 15000,
    });
    const modules = new Set(
      modulesOut
        .split(/\r?\n/)
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean)
    );

    const required = ['pdo_sqlite', 'sqlite3', 'curl', 'mbstring', 'openssl', 'fileinfo'];
    const missingModules = required.filter((m) => !modules.has(m));
    if (missingModules.length > 0) {
      return { ok: false, reason: `Missing PHP extensions: ${missingModules.join(', ')}` };
    }

    return { ok: true, detail: `${firstLine} (${required.join(', ')})` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function resolvePhpDownload() {
  // Primary: official Windows PHP releases.json
  try {
    const releases = await fetchJson('https://windows.php.net/downloads/releases/releases.json');
    const preferredBranches = ['8.3', '8.2', '8.4', '8.5'];
    for (const branch of preferredBranches) {
      const entry = releases[branch];
      if (!entry) continue;
      const archKeys = Object.keys(entry).filter(
        (k) => k.startsWith('nts-') && k.endsWith('-x64') && entry[k]?.zip?.path
      );
      if (archKeys.length > 0) {
        const zipInfo = entry[archKeys[0]].zip;
        return {
          url: `https://windows.php.net/downloads/releases/${zipInfo.path}`,
          filename: zipInfo.path,
          sha256: zipInfo.sha256 || null,
        };
      }
    }
  } catch (err) {
    log('php', `Warning: releases.json lookup failed (${err.message}), falling back to HTML index`);
  }

  // Fallback: scrape releases/ then releases/archives/
  const indexUrls = [
    'https://windows.php.net/downloads/releases/',
    'https://windows.php.net/downloads/releases/archives/',
  ];
  const filePattern = /href="(?:\/downloads\/releases\/(?:archives\/)?)?(php-(8\.(?:3|2|4)\.\d+(?:-\d+)?)-nts-Win32-vs1[67]-x64\.zip)"/gi;

  for (const baseUrl of indexUrls) {
    try {
      const html = await fetchText(baseUrl);
      const matches = [];
      let m;
      while ((m = filePattern.exec(html)) !== null) {
        matches.push({ filename: path.posix.basename(m[1]), version: m[2] });
      }
      if (matches.length > 0) {
        matches.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
        const chosen = matches[0];
        return {
          url: `${baseUrl}${chosen.filename}`,
          filename: chosen.filename,
          sha256: null,
        };
      }
    } catch {
      // Try next mirror
    }
  }

  throw new Error('Unable to locate a Windows x64 NTS PHP 8.2+ download from windows.php.net');
}

async function fetchPhp(runtimeDir, force) {
  const phpDir = path.join(runtimeDir, 'php');
  if (!force) {
    const check = verifyPhp(phpDir);
    if (check.ok) {
      log('php', `Already verified: ${check.detail}`);
      return { component: 'php', status: 'skipped', detail: check.detail };
    }
  }

  log('php', 'Resolving latest Windows x64 NTS PHP 8.2+ release...');
  const info = await resolvePhpDownload();
  const tempZip = path.join(runtimeDir, `.tmp-${info.filename}`);

  try {
    log('php', `Downloading ${info.url}...`);
    const bytes = await downloadFile(info.url, tempZip, info.sha256, 'sha256');
    log('php', `Downloaded ${formatBytes(bytes)}${info.sha256 ? ' (SHA-256 verified)' : ''}`);

    clearDirectoryPreserveGitkeep(phpDir);
    const count = safeExtractZip(tempZip, phpDir);
    log('php', `Extracted ${count} files into ${phpDir}`);

    configurePhpIni(phpDir);
    log('php', 'Configured php.ini with pdo_sqlite, sqlite3, curl, mbstring, openssl, fileinfo');

    const check = verifyPhp(phpDir);
    if (!check.ok) {
      throw new Error(`PHP verification failed after extraction: ${check.reason}`);
    }
    log('php', `Verified: ${check.detail}`);
    return { component: 'php', status: 'installed', detail: check.detail };
  } finally {
    if (fs.existsSync(tempZip)) {
      fs.unlinkSync(tempZip);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. uber-apk-signer.jar
// ---------------------------------------------------------------------------

function verifyUberApkSigner(jarPath) {
  if (!hasZipHeader(jarPath)) {
    return { ok: false, reason: 'uber-apk-signer.jar missing or invalid JAR/ZIP header' };
  }
  const size = fs.statSync(jarPath).size;
  return { ok: true, detail: `uber-apk-signer.jar (${formatBytes(size)})` };
}

async function fetchUberApkSigner(runtimeDir, force) {
  const androidToolsDir = path.join(runtimeDir, 'android-tools');
  const jarPath = path.join(androidToolsDir, 'uber-apk-signer.jar');

  if (!force) {
    const check = verifyUberApkSigner(jarPath);
    if (check.ok) {
      log('uber-apk-signer', `Already verified: ${check.detail}`);
      return { component: 'uber-apk-signer', status: 'skipped', detail: check.detail };
    }
  }

  log('uber-apk-signer', 'Querying GitHub latest release for patrickfav/uber-apk-signer...');
  const release = await fetchJson(
    'https://api.github.com/repos/patrickfav/uber-apk-signer/releases/latest',
    { Accept: 'application/vnd.github+json' }
  );

  const assets = Array.isArray(release.assets) ? release.assets : [];
  const jarAsset = assets.find((a) => /^uber-apk-signer-.*\.jar$/i.test(a.name));
  if (!jarAsset?.browser_download_url) {
    throw new Error('Could not find uber-apk-signer-*.jar in latest GitHub release assets');
  }

  let expectedSha256 = null;
  const checksumAsset = assets.find((a) => /checksum.*sha256.*\.txt$/i.test(a.name));
  if (checksumAsset?.browser_download_url) {
    try {
      const txt = await fetchText(checksumAsset.browser_download_url);
      for (const line of txt.split(/\r?\n/)) {
        const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
        if (m && m[2].trim() === jarAsset.name) {
          expectedSha256 = m[1];
          break;
        }
      }
    } catch {
      // Checksum asset is optional if network fetch fails
    }
  }

  log('uber-apk-signer', `Downloading ${jarAsset.name}...`);
  const bytes = await downloadFile(jarAsset.browser_download_url, jarPath, expectedSha256, 'sha256');
  const check = verifyUberApkSigner(jarPath);
  if (!check.ok) {
    throw new Error(`Verification failed: ${check.reason}`);
  }
  const detail = `${jarAsset.name} (${formatBytes(bytes)}${expectedSha256 ? ', SHA-256 verified' : ''})`;
  log('uber-apk-signer', `Verified: ${detail}`);
  return { component: 'uber-apk-signer', status: 'installed', detail };
}

// ---------------------------------------------------------------------------
// 3. zipalign.exe (Android SDK build-tools for Windows)
// ---------------------------------------------------------------------------

function verifyZipalign(androidToolsDir) {
  const exePath = path.join(androidToolsDir, 'zipalign.exe');
  if (!hasPeHeader(exePath)) {
    return { ok: false, reason: 'zipalign.exe missing or invalid PE header' };
  }
  const size = fs.statSync(exePath).size;
  return { ok: true, detail: `zipalign.exe (${formatBytes(size)})` };
}

async function resolveBuildToolsDownload() {
  const repoUrls = [
    'https://dl.google.com/android/repository/repository2-3.xml',
    'https://dl.google.com/android/repository/repository2-1.xml',
  ];

  for (const repoUrl of repoUrls) {
    try {
      const xml = await fetchText(repoUrl);
      const re =
        /<complete>\s*<size>(\d+)<\/size>\s*<checksum(?:\s+type="([^"]+)")?>([a-f0-9]+)<\/checksum>\s*<url>(build-tools_r[^<]+-windows\.zip)<\/url>/g;
      const candidates = [];
      let m;
      while ((m = re.exec(xml)) !== null) {
        const filename = m[4];
        if (!/-rc\d*-windows\.zip$/i.test(filename)) {
          candidates.push({
            filename,
            url: `https://dl.google.com/android/repository/${filename}`,
          });
        }
      }
      if (candidates.length > 0) {
        return candidates[0];
      }
    } catch {
      // Fallback to next XML or hardcoded URL
    }
  }

  return {
    filename: 'build-tools_r34-windows.zip',
    url: 'https://dl.google.com/android/repository/build-tools_r34-windows.zip',
  };
}

async function fetchZipalign(runtimeDir, force) {
  const androidToolsDir = path.join(runtimeDir, 'android-tools');
  if (!force) {
    const check = verifyZipalign(androidToolsDir);
    if (check.ok) {
      log('zipalign', `Already verified: ${check.detail}`);
      return { component: 'zipalign', status: 'skipped', detail: check.detail };
    }
  }

  const buildTools = await resolveBuildToolsDownload();
  const tempZip = path.join(runtimeDir, `.tmp-${buildTools.filename}`);

  try {
    log('zipalign', `Downloading ${buildTools.url}...`);
    const bytes = await downloadFile(buildTools.url, tempZip);
    log('zipalign', `Downloaded ${formatBytes(bytes)}, extracting zipalign.exe...`);

    const zip = new AdmZip(tempZip);
    const entries = zip.getEntries();
    const zipalignEntry = entries.find((e) => /(?:^|\/)zipalign\.exe$/i.test(e.entryName));
    if (!zipalignEntry) {
      throw new Error(`zipalign.exe not found inside ${buildTools.filename}`);
    }

    fs.mkdirSync(androidToolsDir, { recursive: true });
    const zipalignDirPrefix = path.posix.dirname(zipalignEntry.entryName.replace(/\\/g, '/'));
    const extractedFiles = [];

    // Extract zipalign.exe and any companion runtime DLLs in the same directory
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const norm = entry.entryName.replace(/\\/g, '/');
      if (path.posix.dirname(norm) !== zipalignDirPrefix) continue;
      const base = path.posix.basename(norm);
      if (/^zipalign\.exe$/i.test(base) || /^lib.*\.dll$/i.test(base) || /^libc\+\+.*\.dll$/i.test(base)) {
        const outPath = path.join(androidToolsDir, base);
        fs.writeFileSync(outPath, entry.getData());
        extractedFiles.push(base);
      }
    }

    const check = verifyZipalign(androidToolsDir);
    if (!check.ok) {
      throw new Error(`zipalign verification failed: ${check.reason}`);
    }
    const detail = `${check.detail} from ${buildTools.filename} (files: ${extractedFiles.join(', ')})`;
    log('zipalign', `Verified: ${detail}`);
    return { component: 'zipalign', status: 'installed', detail };
  } finally {
    if (fs.existsSync(tempZip)) {
      fs.unlinkSync(tempZip);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. cloudflared.exe (Windows amd64)
// ---------------------------------------------------------------------------

function verifyCloudflared(exePath) {
  if (!hasPeHeader(exePath)) {
    return { ok: false, reason: 'cloudflared.exe missing or invalid PE header' };
  }
  const size = fs.statSync(exePath).size;
  if (process.platform !== 'win32') {
    return { ok: true, detail: `cloudflared.exe (${formatBytes(size)}, non-Windows host)` };
  }
  try {
    const out = execFileSync(exePath, ['--version'], {
      encoding: 'utf8',
      timeout: 15000,
    }).trim();
    return { ok: true, detail: `${out.split(/\r?\n/)[0]} (${formatBytes(size)})` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function fetchCloudflared(runtimeDir, force) {
  const cfDir = path.join(runtimeDir, 'cloudflared');
  const exePath = path.join(cfDir, 'cloudflared.exe');

  if (!force) {
    const check = verifyCloudflared(exePath);
    if (check.ok) {
      log('cloudflared', `Already verified: ${check.detail}`);
      return { component: 'cloudflared', status: 'skipped', detail: check.detail };
    }
  }

  const downloadUrl =
    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  log('cloudflared', `Downloading ${downloadUrl}...`);
  await downloadFile(downloadUrl, exePath);

  const check = verifyCloudflared(exePath);
  if (!check.ok) {
    throw new Error(`cloudflared verification failed: ${check.reason}`);
  }
  log('cloudflared', `Verified: ${check.detail}`);
  return { component: 'cloudflared', status: 'installed', detail: check.detail };
}

// ---------------------------------------------------------------------------
// 5. Portable JRE (Eclipse Temurin Windows x64)
// ---------------------------------------------------------------------------

function verifyJre(jreDir) {
  const javaExe = path.join(jreDir, 'bin', 'java.exe');
  if (!hasPeHeader(javaExe)) {
    return { ok: false, reason: 'jre/bin/java.exe missing or invalid PE header' };
  }
  if (process.platform !== 'win32') {
    return { ok: true, detail: 'jre/bin/java.exe verified on disk (non-Windows host)' };
  }
  try {
    // java -version prints to stderr on HotSpot
    const res = require('node:child_process').spawnSync(javaExe, ['-version'], {
      encoding: 'utf8',
      timeout: 15000,
    });
    if (res.status !== 0) {
      return { ok: false, reason: res.stderr || res.error?.message || `Exit code ${res.status}` };
    }
    const line = `${res.stderr || ''}${res.stdout || ''}`.trim().split(/\r?\n/)[0] || 'Temurin JRE';
    return { ok: true, detail: line };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function resolveAdoptiumJre() {
  for (const major of [21, 17]) {
    try {
      const apiUrl = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=windows`;
      const assets = await fetchJson(apiUrl);
      if (Array.isArray(assets) && assets.length > 0 && assets[0]?.binary?.package?.link) {
        const pkg = assets[0].binary.package;
        return {
          major,
          name: pkg.name,
          url: pkg.link,
          sha256: pkg.checksum || null,
        };
      }
    } catch {
      // Try fallback major version
    }
  }
  throw new Error('Unable to resolve Eclipse Temurin Windows x64 JRE from Adoptium API');
}

async function fetchJre(runtimeDir, force) {
  const jreDir = path.join(runtimeDir, 'jre');
  if (!force) {
    const check = verifyJre(jreDir);
    if (check.ok) {
      log('jre', `Already verified: ${check.detail}`);
      return { component: 'jre', status: 'skipped', detail: check.detail };
    }
  }

  log('jre', 'Querying Adoptium API for Eclipse Temurin Windows x64 JRE...');
  const info = await resolveAdoptiumJre();
  const tempZip = path.join(runtimeDir, `.tmp-${info.name}`);

  try {
    log('jre', `Downloading ${info.url}...`);
    const bytes = await downloadFile(info.url, tempZip, info.sha256, 'sha256');
    log('jre', `Downloaded ${formatBytes(bytes)}${info.sha256 ? ' (SHA-256 verified)' : ''}`);

    clearDirectoryPreserveGitkeep(jreDir);
    const count = safeExtractZip(tempZip, jreDir, { stripTopDir: true });
    log('jre', `Extracted ${count} files into ${jreDir}`);

    const check = verifyJre(jreDir);
    if (!check.ok) {
      throw new Error(`JRE verification failed: ${check.reason}`);
    }
    log('jre', `Verified: ${check.detail}`);
    return { component: 'jre', status: 'installed', detail: check.detail };
  } finally {
    if (fs.existsSync(tempZip)) {
      fs.unlinkSync(tempZip);
    }
  }
}

// ---------------------------------------------------------------------------
// Main Runner & Summary
// ---------------------------------------------------------------------------

function printSummary(results) {
  console.log('\n=== Runtime Fetch Summary ===');
  const col1 = 18;
  const col2 = 12;
  console.log(`${'Component'.padEnd(col1)}${'Status'.padEnd(col2)}Details`);
  console.log(`${'-'.repeat(col1)}${'-'.repeat(col2)}${'-'.repeat(50)}`);
  for (const r of results) {
    console.log(`${r.component.padEnd(col1)}${r.status.toUpperCase().padEnd(col2)}${r.detail}`);
  }
  console.log('');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  console.log(`Target runtime directory: ${opts.dest}`);
  if (opts.force) console.log('Mode: --force (re-downloading selected components)');
  if (opts.skipJre) console.log('Mode: --skip-jre (skipping Portable JRE)');

  fs.mkdirSync(opts.dest, { recursive: true });

  const selected = new Set(opts.only || ALL_COMPONENTS);
  if (opts.skipJre) {
    selected.delete('jre');
  }

  const tasks = [
    { name: 'php', fn: () => fetchPhp(opts.dest, opts.force) },
    { name: 'uber-apk-signer', fn: () => fetchUberApkSigner(opts.dest, opts.force) },
    { name: 'zipalign', fn: () => fetchZipalign(opts.dest, opts.force) },
    { name: 'cloudflared', fn: () => fetchCloudflared(opts.dest, opts.force) },
    { name: 'jre', fn: () => fetchJre(opts.dest, opts.force) },
  ];

  const results = [];
  let hasFailure = false;

  for (const task of tasks) {
    if (!selected.has(task.name)) {
      if (task.name === 'jre' && opts.skipJre) {
        results.push({ component: 'jre', status: 'omitted', detail: 'Skipped via --skip-jre' });
      }
      continue;
    }

    try {
      const result = await task.fn();
      results.push(result);
    } catch (err) {
      hasFailure = true;
      console.error(`[${task.name}] ERROR: ${err.message}`);
      results.push({ component: task.name, status: 'failed', detail: err.message });
    }
  }

  printSummary(results);
  if (hasFailure) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
