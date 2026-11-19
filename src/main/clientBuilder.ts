import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import {
  GD_VERSIONS,
  ORIGINAL_ASCII_URL,
  ORIGINAL_BASE64_URL,
  getGdVersionSpec,
  type GdVersionId,
} from '../shared/gdVersions';
import type { ClientBuildArtifacts, TemplateAvailability } from '../shared/types';
import {
  getClientTemplatesDir,
  getInstancesDir,
  getJavaExePath,
  getUberApkSignerPath,
  getZipalignPath,
} from './paths';

const execFileAsync = promisify(execFile);

const MAX_RAW_URL_BYTES = 33;
const EXPECTED_BASE64_URL_BYTES = 44;

function findAndroidNativeLibs(extractedDir: string): string[] {
  const libRoot = path.join(extractedDir, 'lib');
  if (!fs.existsSync(libRoot)) {
    return [];
  }

  const found: string[] = [];
  for (const abiEntry of fs.readdirSync(libRoot, { withFileTypes: true })) {
    if (!abiEntry.isDirectory()) {
      continue;
    }
    const abiDir = path.join(libRoot, abiEntry.name);
    for (const fileEntry of fs.readdirSync(abiDir, { withFileTypes: true })) {
      if (fileEntry.isFile() && fileEntry.name.toLowerCase().endsWith('.so')) {
        found.push(path.join(abiDir, fileEntry.name));
      }
    }
  }

  // Prioritize libcocos2dcpp.so entries first for deterministic reporting
  found.sort((a, b) => {
    const aMain = path.basename(a).toLowerCase() === 'libcocos2dcpp.so' ? 0 : 1;
    const bMain = path.basename(b).toLowerCase() === 'libcocos2dcpp.so' ? 0 : 1;
    return aMain - bMain || a.localeCompare(b);
  });

  return found;
}

export interface PatchBufferResult {
  patchedBuffer: Buffer;
  replacementsCount: number;
  patchedUrl: string;
}

export interface BuildWindowsClientOptions {
  serverId: string;
  version: GdVersionId;
  serverBaseUrl: string;
  fallbackLocalUrl?: string;
  customExePath?: string;
}

export interface BuildWindowsClientResult {
  exePath: string;
  zipPath: string;
  patchedUrl: string;
  usedRedirector: boolean;
  replacementsCount: number;
  warnings: string[];
}

export interface BuildAndroidClientOptions {
  serverId: string;
  version: GdVersionId;
  serverBaseUrl: string;
  fallbackLocalUrl?: string;
  customApkPath?: string;
}

export interface BuildAndroidClientResult {
  apkPath: string;
  patchedUrl: string;
  usedRedirector: boolean;
  replacementsCount: number;
  warnings: string[];
}

export interface BuildClientsForServerOptions {
  serverId: string;
  version: GdVersionId;
  serverBaseUrl: string;
  fallbackLocalUrl?: string;
  buildWindows: boolean;
  buildAndroid: boolean;
  customWindowsBasePath?: string;
  customAndroidBasePath?: string;
}

/**
 * Lists non-`.gitkeep` files inside a directory, or returns an empty array if missing.
 */
function listTemplateFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.name !== '.gitkeep')
    .map((entry) => entry.name);
}

/**
 * Finds the preferred Windows executable or Android APK inside a template directory.
 */
function findPrimaryTemplateFile(
  dirPath: string,
  extension: '.exe' | '.apk',
  preferredName: string
): string | null {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const files = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => entry.name);

  if (files.length === 0) {
    return null;
  }

  const preferred = files.find((name) => name.toLowerCase() === preferredName.toLowerCase());
  return path.join(dirPath, preferred ?? files[0]);
}

/**
 * Scans `client-templates/windows/<ver>` and `client-templates/android/<ver>`
 * for all 14 Geometry Dash versions in `GD_VERSIONS`.
 */
export function getTemplateMatrix(): TemplateAvailability[] {
  const templatesRoot = getClientTemplatesDir();

  return GD_VERSIONS.map((spec) => {
    const winDir = path.join(templatesRoot, 'windows', spec.id);
    const androidDir = path.join(templatesRoot, 'android', spec.id);

    const winExe = findPrimaryTemplateFile(winDir, '.exe', 'GeometryDash.exe');
    const winFiles = listTemplateFiles(winDir);
    const androidApk = findPrimaryTemplateFile(androidDir, '.apk', 'GeometryDash.apk');

    return {
      version: spec.id,
      windowsReady: winExe !== null,
      windowsPath: winExe,
      windowsFileCount: winFiles.length,
      androidReady: androidApk !== null,
      androidPath: androidApk,
    };
  });
}

/**
 * Normalizes a GDPS base URL without trailing slashes, adding `/db` for root URLs
 * when doing so stays within the 33-byte binary URL limit.
 */
export function normalizeServerUrl(serverBaseUrl: string): string {
  const trimmed = serverBaseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Server URL cannot be empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid server URL: "${serverBaseUrl}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Server URL must start with http:// or https:// (received "${serverBaseUrl}").`);
  }

  if ((parsed.pathname === '/' || parsed.pathname === '') && !parsed.search && !parsed.hash) {
    const withDb = `${trimmed}/db`;
    if (Buffer.byteLength(withDb, 'utf8') <= MAX_RAW_URL_BYTES) {
      return withDb;
    }
  }

  return trimmed;
}

/**
 * Returns true if the normalized server URL fits within the 33-byte limit
 * required for direct in-place binary patching.
 */
export function canFitDirectUrl(serverBaseUrl: string): boolean {
  try {
    const normalized = normalizeServerUrl(serverBaseUrl);
    return Buffer.byteLength(normalized, 'utf8') <= MAX_RAW_URL_BYTES;
  } catch {
    return false;
  }
}

/**
 * Formats a GDPS URL into the exact byte length expected by Geometry Dash binaries:
 * - ASCII mode: 33 bytes padded with trailing `/`
 * - Base64 mode: 33-byte padded raw URL encoded to exact 44-byte Base64
 */
export function formatPatchedUrl(serverBaseUrl: string, usesBase64: boolean): string {
  const normalized = normalizeServerUrl(serverBaseUrl);
  const rawByteLen = Buffer.byteLength(normalized, 'utf8');

  if (rawByteLen > MAX_RAW_URL_BYTES) {
    throw new Error(
      `Server URL "${normalized}" is ${rawByteLen} bytes, which exceeds the ${MAX_RAW_URL_BYTES}-byte binary limit. Use a shorter URL or the local redirector fallback.`
    );
  }

  const paddedRaw = normalized + '/'.repeat(MAX_RAW_URL_BYTES - rawByteLen);
  if (Buffer.byteLength(paddedRaw, 'utf8') !== MAX_RAW_URL_BYTES) {
    throw new Error(`Failed to align ASCII URL to ${MAX_RAW_URL_BYTES} bytes.`);
  }

  if (!usesBase64) {
    return paddedRaw;
  }

  const encoded = Buffer.from(paddedRaw, 'utf8').toString('base64');
  if (Buffer.byteLength(encoded, 'utf8') !== EXPECTED_BASE64_URL_BYTES) {
    throw new Error(
      `Failed to align Base64 URL to ${EXPECTED_BASE64_URL_BYTES} bytes (got ${Buffer.byteLength(encoded, 'utf8')}).`
    );
  }

  return encoded;
}

/**
 * Resolves a patchable URL (<= 33 raw bytes), falling back to the local redirector URL
 * with an explanatory warning when a public/tunnel URL exceeds 33 bytes.
 */
function resolvePatchableUrl(
  serverBaseUrl: string,
  fallbackLocalUrl?: string
): { effectiveUrl: string; usedRedirector: boolean; warnings: string[] } {
  const normalized = normalizeServerUrl(serverBaseUrl);
  const byteLen = Buffer.byteLength(normalized, 'utf8');

  if (byteLen <= MAX_RAW_URL_BYTES) {
    return {
      effectiveUrl: normalized,
      usedRedirector: false,
      warnings: [],
    };
  }

  if (fallbackLocalUrl && canFitDirectUrl(fallbackLocalUrl)) {
    const normalizedFallback = normalizeServerUrl(fallbackLocalUrl);
    return {
      effectiveUrl: normalizedFallback,
      usedRedirector: true,
      warnings: [
        `The server URL "${normalized}" is ${byteLen} bytes (limit: ${MAX_RAW_URL_BYTES} bytes). Patched client binaries with the short local redirector URL "${normalizedFallback}" to prevent binary corruption.`,
      ],
    };
  }

  throw new Error(
    `Server URL "${normalized}" is ${byteLen} bytes (exceeds ${MAX_RAW_URL_BYTES}-byte limit) and no valid short fallback URL is available.`
  );
}

/**
 * Replaces all occurrences of `pattern` in `buffer` in-place with `replacement`
 * of identical byte length, returning the count of replacements performed.
 */
function replaceAllExactLength(buffer: Buffer, pattern: Buffer, replacement: Buffer): number {
  if (pattern.length !== replacement.length) {
    throw new Error(
      `Byte-length mismatch during binary patch: pattern=${pattern.length}, replacement=${replacement.length}`
    );
  }

  let count = 0;
  let searchFrom = 0;

  while (searchFrom <= buffer.length - pattern.length) {
    const matchIndex = buffer.indexOf(pattern, searchFrom);
    if (matchIndex === -1) {
      break;
    }
    replacement.copy(buffer, matchIndex);
    count += 1;
    searchFrom = matchIndex + pattern.length;
  }

  return count;
}

/**
 * Performs exact byte-length-preserving URL replacement on an executable or shared library buffer.
 */
export function patchBinaryBuffer(
  buffer: Buffer,
  serverBaseUrl: string,
  usesBase64: boolean
): PatchBufferResult {
  const patchedBuffer = Buffer.from(buffer);
  const patchedAscii = formatPatchedUrl(serverBaseUrl, false);
  const asciiPattern = Buffer.from(ORIGINAL_ASCII_URL, 'utf8');
  const asciiReplacement = Buffer.from(patchedAscii, 'utf8');

  let replacementsCount = replaceAllExactLength(patchedBuffer, asciiPattern, asciiReplacement);
  let patchedUrl = patchedAscii;

  if (usesBase64) {
    const patchedBase64 = formatPatchedUrl(serverBaseUrl, true);
    const base64Pattern = Buffer.from(ORIGINAL_BASE64_URL, 'utf8');
    const base64Replacement = Buffer.from(patchedBase64, 'utf8');
    replacementsCount += replaceAllExactLength(patchedBuffer, base64Pattern, base64Replacement);
    patchedUrl = patchedBase64;
  }

  if (patchedBuffer.length !== buffer.length) {
    throw new Error('Binary size changed during patching; aborting to prevent binary corruption.');
  }

  return {
    patchedBuffer,
    replacementsCount,
    patchedUrl,
  };
}

/**
 * Recursively copies a directory while skipping `.gitkeep` placeholder files.
 */
function copyDirectoryFiltered(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.gitkeep') {
      continue;
    }
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryFiltered(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copies a user-selected custom base client into `client-templates/` when explicitly requested,
 * without overwriting or deleting existing template files.
 */
export function saveBaseClientToTemplate(
  kind: 'windows' | 'android',
  version: GdVersionId,
  sourceFilePath: string
): void {
  if (!fs.existsSync(sourceFilePath)) {
    throw new Error(`Custom base file not found: ${sourceFilePath}`);
  }

  const targetDir = path.join(getClientTemplatesDir(), kind, version);
  fs.mkdirSync(targetDir, { recursive: true });

  if (kind === 'windows') {
    const srcDir = path.dirname(sourceFilePath);
    const baseExeName = path.basename(sourceFilePath);
    const targetExe = path.join(targetDir, baseExeName);
    if (!fs.existsSync(targetExe)) {
      fs.copyFileSync(sourceFilePath, targetExe);
    }

    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll')) {
        const destDll = path.join(targetDir, entry.name);
        if (!fs.existsSync(destDll)) {
          fs.copyFileSync(path.join(srcDir, entry.name), destDll);
        }
      }
    }

    const resourcesSrc = path.join(srcDir, 'Resources');
    const resourcesDest = path.join(targetDir, 'Resources');
    if (fs.existsSync(resourcesSrc) && !fs.existsSync(resourcesDest)) {
      copyDirectoryFiltered(resourcesSrc, resourcesDest);
    }
  } else {
    const destApk = path.join(targetDir, path.basename(sourceFilePath));
    if (!fs.existsSync(destApk)) {
      fs.copyFileSync(sourceFilePath, destApk);
    }
  }
}

/**
 * Recursively collects all file paths under `rootDir`.
 */
function walkFilesRecursive(rootDir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Copies a custom Windows `.exe` along with sibling `.dll` files and an optional
 * `Resources/` directory into the build staging folder.
 */
function stageCustomWindowsClient(customExePath: string, buildDir: string): string {
  if (!fs.existsSync(customExePath)) {
    throw new Error(`Selected Windows executable does not exist: ${customExePath}`);
  }

  const srcDir = path.dirname(customExePath);
  const exeName = path.basename(customExePath);
  const stagedExePath = path.join(buildDir, exeName);
  fs.copyFileSync(customExePath, stagedExePath);

  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.dll')) {
      fs.copyFileSync(path.join(srcDir, entry.name), path.join(buildDir, entry.name));
    }
  }

  const resourcesDir = path.join(srcDir, 'Resources');
  if (fs.existsSync(resourcesDir) && fs.statSync(resourcesDir).isDirectory()) {
    copyDirectoryFiltered(resourcesDir, path.join(buildDir, 'Resources'));
  }

  return stagedExePath;
}

/**
 * Builds a patched Windows `.exe` and distributable `.zip` package for a GDPS instance.
 */
export async function buildWindowsClient(
  opts: BuildWindowsClientOptions
): Promise<BuildWindowsClientResult> {
  const spec = getGdVersionSpec(opts.version);
  const { effectiveUrl, usedRedirector, warnings } = resolvePatchableUrl(
    opts.serverBaseUrl,
    opts.fallbackLocalUrl
  );

  const instanceDir = path.join(getInstancesDir(), opts.serverId);
  const buildDir = path.join(instanceDir, 'builds', 'windows');
  const downloadsDir = path.join(instanceDir, 'public', 'downloads');

  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });

  let stagedMainExe: string | null = null;

  if (opts.customExePath) {
    stagedMainExe = stageCustomWindowsClient(opts.customExePath, buildDir);
  } else {
    const templateDir = path.join(getClientTemplatesDir(), 'windows', opts.version);
    const templateExe = findPrimaryTemplateFile(templateDir, '.exe', 'GeometryDash.exe');
    if (!templateExe) {
      throw new Error(
        `No Windows base client found for Geometry Dash ${opts.version}. Place GeometryDash.exe in client-templates/windows/${opts.version}/ or select a custom EXE.`
      );
    }
    copyDirectoryFiltered(templateDir, buildDir);
    stagedMainExe = path.join(buildDir, path.basename(templateExe));
  }

  const rawExe = fs.readFileSync(stagedMainExe);
  const { patchedBuffer, replacementsCount, patchedUrl } = patchBinaryBuffer(
    rawExe,
    effectiveUrl,
    spec.usesBase64Url
  );

  if (replacementsCount === 0) {
    warnings.push(
      `No Boomlings server URL strings were found in ${path.basename(stagedMainExe)}. Verify that this executable is an unmodified Geometry Dash ${opts.version} binary.`
    );
  }

  const outputExeName = `MyGDPS-v${opts.version}.exe`;
  const stagedPatchedExe = path.join(buildDir, outputExeName);
  fs.writeFileSync(stagedPatchedExe, patchedBuffer);
  if (path.resolve(stagedMainExe) !== path.resolve(stagedPatchedExe) && fs.existsSync(stagedMainExe)) {
    fs.unlinkSync(stagedMainExe);
  }

  const publicExePath = path.join(downloadsDir, outputExeName);
  fs.copyFileSync(stagedPatchedExe, publicExePath);

  const publicZipPath = path.join(downloadsDir, `MyGDPS-v${opts.version}-Windows.zip`);
  const zip = new AdmZip();
  for (const filePath of walkFilesRecursive(buildDir)) {
    const relPosix = path.relative(buildDir, filePath).split(path.sep).join('/');
    zip.addFile(relPosix, fs.readFileSync(filePath));
  }
  zip.writeZip(publicZipPath);

  return {
    exePath: publicExePath,
    zipPath: publicZipPath,
    patchedUrl,
    usedRedirector,
    replacementsCount,
    warnings,
  };
}

/**
 * Returns true if an APK entry path belongs to the old JAR/APK signature metadata.
 */
function isApkSignatureEntry(entryName: string): boolean {
  const upper = entryName.replace(/\\/g, '/').toUpperCase();
  if (!upper.startsWith('META-INF/')) {
    return false;
  }
  const fileName = upper.slice('META-INF/'.length);
  if (!fileName || fileName.includes('/')) {
    return false;
  }
  return (
    fileName === 'MANIFEST.MF' ||
    fileName.endsWith('.SF') ||
    fileName.endsWith('.RSA') ||
    fileName.endsWith('.DSA') ||
    fileName.endsWith('.EC')
  );
}

/**
 * Determines whether an APK entry must remain uncompressed (`STORE`, method = 0).
 */
function shouldStoreUncompressed(entryName: string, originalMethod?: number): boolean {
  const normalized = entryName.replace(/\\/g, '/').toLowerCase();
  return (
    normalized.endsWith('.so') ||
    normalized === 'resources.arsc' ||
    originalMethod === 0
  );
}

/**
 * Patches, repackages, aligns, and signs an Android `.apk` client for a GDPS instance.
 */
export async function buildAndroidClient(
  opts: BuildAndroidClientOptions
): Promise<BuildAndroidClientResult> {
  const spec = getGdVersionSpec(opts.version);
  const { effectiveUrl, usedRedirector, warnings } = resolvePatchableUrl(
    opts.serverBaseUrl,
    opts.fallbackLocalUrl
  );

  let sourceApkPath: string | null = null;
  if (opts.customApkPath) {
    if (!fs.existsSync(opts.customApkPath)) {
      throw new Error(`Selected Android APK does not exist: ${opts.customApkPath}`);
    }
    sourceApkPath = opts.customApkPath;
  } else {
    const templateDir = path.join(getClientTemplatesDir(), 'android', opts.version);
    sourceApkPath = findPrimaryTemplateFile(templateDir, '.apk', 'GeometryDash.apk');
    if (!sourceApkPath) {
      throw new Error(
        `No Android base APK found for Geometry Dash ${opts.version}. Place GeometryDash.apk in client-templates/android/${opts.version}/ or select a custom APK.`
      );
    }
  }

  const javaExe = getJavaExePath();
  const signerJar = getUberApkSignerPath();
  if (!javaExe) {
    throw new Error(
      'Java runtime (java.exe) was not found. Bundle a portable JRE under resources/runtime/jre/ or install Java 17+ to sign Android APKs.'
    );
  }
  if (!signerJar) {
    throw new Error(
      'uber-apk-signer.jar was not found under resources/runtime/android-tools/. Run "npm run fetch-runtimes" to install Android signing tools.'
    );
  }

  const instanceDir = path.join(getInstancesDir(), opts.serverId);
  const workDir = path.join(instanceDir, 'builds', 'android', 'work');
  const extractedDir = path.join(workDir, 'extracted');
  const signedOutDir = path.join(workDir, 'signed');
  const downloadsDir = path.join(instanceDir, 'public', 'downloads');

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(extractedDir, { recursive: true });
  fs.mkdirSync(signedOutDir, { recursive: true });
  fs.mkdirSync(downloadsDir, { recursive: true });

  const baseApkWorkPath = path.join(workDir, 'base.apk');
  fs.copyFileSync(sourceApkPath, baseApkWorkPath);

  const sourceZip = new AdmZip(baseApkWorkPath);
  const originalMethods = new Map<string, number>();
  const keptEntries: string[] = [];

  for (const entry of sourceZip.getEntries()) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (entry.isDirectory || isApkSignatureEntry(entryName)) {
      continue;
    }

    originalMethods.set(entryName, entry.header.method);
    const outFile = path.join(extractedDir, entryName);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, entry.getData());
    keptEntries.push(entryName);
  }

  let totalReplacements = 0;
  let patchedUrl = formatPatchedUrl(effectiveUrl, spec.usesBase64Url);
  const nativeLibs = findAndroidNativeLibs(extractedDir);

  if (nativeLibs.length === 0) {
    throw new Error(
      'No native .so libraries (e.g. libcocos2dcpp.so) were found inside the base APK.'
    );
  }

  for (const fullSoPath of nativeLibs) {
    const rawSo = fs.readFileSync(fullSoPath);
    const result = patchBinaryBuffer(rawSo, effectiveUrl, spec.usesBase64Url);
    if (result.replacementsCount > 0) {
      fs.writeFileSync(fullSoPath, result.patchedBuffer);
      totalReplacements += result.replacementsCount;
      patchedUrl = result.patchedUrl;
    }
  }

  if (effectiveUrl.includes('127.0.0.1') || effectiveUrl.includes('localhost')) {
    warnings.push(
      'APK was patched with 127.0.0.1 (Localhost). Android devices cannot reach your PC via 127.0.0.1 — switch Network Mode to LAN / Wi-Fi, VPN, or VPS so your phone or emulator can connect.'
    );
  }

  if (totalReplacements === 0) {
    warnings.push(
      `No Boomlings server URL strings were found inside native .so libraries for Geometry Dash ${opts.version}. Verify that the base APK is unmodified.`
    );
  }

  const unsignedApkPath = path.join(workDir, 'unsigned.apk');
  const outZip = new AdmZip();

  // Android 9+ / modern emulators (e.g. BlueStacks Pie/Android 11) dropped ARMv5 `armeabi` ABI support.
  // Classic GD 1.0–1.5 APKs only ship `lib/armeabi/*.so`. Since ARMv5 code is binary-compatible with
  // `armeabi-v7a`, clone patched `lib/armeabi/*.so` entries into `lib/armeabi-v7a/` when missing.
  const hasArmeabiV7a = keptEntries.some((entry) => entry.startsWith('lib/armeabi-v7a/'));
  const extraCompatEntries: Array<{ entryName: string; diskPath: string }> = [];
  if (!hasArmeabiV7a) {
    for (const entryName of keptEntries) {
      if (entryName.startsWith('lib/armeabi/') && entryName.toLowerCase().endsWith('.so')) {
        const v7aName = 'lib/armeabi-v7a/' + entryName.slice('lib/armeabi/'.length);
        extraCompatEntries.push({
          entryName: v7aName,
          diskPath: path.join(extractedDir, entryName),
        });
      }
    }
    if (extraCompatEntries.length > 0) {
      warnings.push(
        'Legacy ARMv5-only APK detected (lib/armeabi). Cloned patched native library to lib/armeabi-v7a for Android 9+ / BlueStacks compatibility.'
      );
    }
  }

  for (const entryName of keptEntries) {
    const diskPath = path.join(extractedDir, entryName);
    const zipEntry = outZip.addFile(entryName, fs.readFileSync(diskPath));
    if (shouldStoreUncompressed(entryName, originalMethods.get(entryName))) {
      zipEntry.header.method = 0;
    }
  }
  for (const extra of extraCompatEntries) {
    const zipEntry = outZip.addFile(extra.entryName, fs.readFileSync(extra.diskPath));
    zipEntry.header.method = 0;
  }
  outZip.writeZip(unsignedApkPath);

  const alignedApkPath = path.join(workDir, 'aligned.apk');
  const zipalignExe = getZipalignPath();
  if (zipalignExe) {
    await execFileAsync(zipalignExe, ['-p', '-f', '4', unsignedApkPath, alignedApkPath], {
      windowsHide: true,
    });
  } else {
    warnings.push(
      'zipalign.exe was not found in resources/runtime/android-tools/. Built APK without 4-byte ZIP alignment.'
    );
    fs.copyFileSync(unsignedApkPath, alignedApkPath);
  }

  const signerArgs = [
    '-jar',
    signerJar,
    '--apks',
    alignedApkPath,
    '--out',
    signedOutDir,
    '--allowResign',
  ];
  if (zipalignExe) {
    signerArgs.push('--zipAlignPath', zipalignExe);
  } else {
    signerArgs.push('--skipZipAlign');
  }

  const signerResult = await execFileAsync(javaExe, signerArgs, { windowsHide: true });

  const signedApkName = fs
    .readdirSync(signedOutDir)
    .find((file) => file.toLowerCase().endsWith('.apk'));

  if (!signedApkName) {
    const details = `${signerResult.stdout ?? ''}\n${signerResult.stderr ?? ''}`.trim();
    throw new Error(
      `uber-apk-signer completed but did not produce a signed .apk file.${details ? ` Details: ${details.slice(0, 300)}` : ''}`
    );
  }

  const publicApkPath = path.join(downloadsDir, `MyGDPS-v${opts.version}-Android.apk`);
  fs.copyFileSync(path.join(signedOutDir, signedApkName), publicApkPath);

  return {
    apkPath: publicApkPath,
    patchedUrl,
    usedRedirector,
    replacementsCount: totalReplacements,
    warnings,
  };
}

/**
 * Builds requested Windows and/or Android game clients for a GDPS server instance.
 */
export async function buildClientsForServer(
  opts: BuildClientsForServerOptions
): Promise<ClientBuildArtifacts> {
  const warnings: string[] = [];
  let windowsExePath: string | undefined;
  let windowsZipPath: string | undefined;
  let androidApkPath: string | undefined;
  let patchedUrl: string | undefined;
  let usedRedirector = false;

  if (opts.buildWindows) {
    const winResult = await buildWindowsClient({
      serverId: opts.serverId,
      version: opts.version,
      serverBaseUrl: opts.serverBaseUrl,
      fallbackLocalUrl: opts.fallbackLocalUrl,
      customExePath: opts.customWindowsBasePath,
    });
    windowsExePath = winResult.exePath;
    windowsZipPath = winResult.zipPath;
    patchedUrl = winResult.patchedUrl;
    usedRedirector = usedRedirector || winResult.usedRedirector;
    warnings.push(...winResult.warnings);
  }

  if (opts.buildAndroid) {
    const androidResult = await buildAndroidClient({
      serverId: opts.serverId,
      version: opts.version,
      serverBaseUrl: opts.serverBaseUrl,
      fallbackLocalUrl: opts.fallbackLocalUrl,
      customApkPath: opts.customAndroidBasePath,
    });
    androidApkPath = androidResult.apkPath;
    patchedUrl = patchedUrl ?? androidResult.patchedUrl;
    usedRedirector = usedRedirector || androidResult.usedRedirector;
    warnings.push(...androidResult.warnings);
  }

  return {
    windowsExePath,
    windowsZipPath,
    androidApkPath,
    patchedUrl,
    usedRedirector,
    builtAt: new Date().toISOString(),
    warnings,
  };
}
