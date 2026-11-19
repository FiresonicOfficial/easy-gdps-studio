import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { RuntimeStatus } from '../shared/types';

/**
 * Resolves the workspace root directory during development.
 * When compiled to `dist-electron/main/`, `../..` points to the project root.
 */
export function getProjectRoot(): string {
  const fromDist = path.resolve(__dirname, '../..');
  if (fs.existsSync(path.join(fromDist, 'package.json'))) {
    return fromDist;
  }
  return process.cwd();
}

/**
 * Resolves the bundled runtime directory (`resources/runtime` in dev,
 * `process.resourcesPath/runtime` in packaged builds).
 */
export function getRuntimeDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtime');
  }
  return path.join(getProjectRoot(), 'resources', 'runtime');
}

/**
 * Resolves the PHP server templates directory (`server-templates`).
 */
export function getServerTemplatesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server-templates');
  }
  return path.join(getProjectRoot(), 'server-templates');
}

/**
 * Resolves the client templates directory (`client-templates`).
 * Template files inside this directory must never be modified during builds.
 */
export function getClientTemplatesDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'client-templates');
  }
  return path.join(getProjectRoot(), 'client-templates');
}

/**
 * Resolves the writable per-user instances directory inside `userData`.
 */
export function getInstancesDir(): string {
  return path.join(app.getPath('userData'), 'instances');
}

/**
 * Resolves the persistent server registry file path (`servers.json`).
 */
export function getServersStorePath(): string {
  return path.join(app.getPath('userData'), 'servers.json');
}

/**
 * Searches the system PATH for the first matching executable filename.
 */
function findExecutableInPath(candidateNames: string[]): string | null {
  const pathEnv = process.env.PATH ?? '';
  if (!pathEnv) {
    return null;
  }

  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const name of candidateNames) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Resolves the portable PHP executable path (with PATH fallback in development).
 */
export function getPhpExePath(): string | null {
  const bundled = path.join(getRuntimeDir(), 'php', 'php.exe');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return findExecutableInPath(['php.exe', 'php']);
}

/**
 * Resolves the portable `php.ini` path if present alongside portable PHP.
 */
export function getPhpIniPath(): string | null {
  const bundled = path.join(getRuntimeDir(), 'php', 'php.ini');
  return fs.existsSync(bundled) ? bundled : null;
}

/**
 * Resolves `zipalign.exe` from `runtime/android-tools` or PATH.
 */
export function getZipalignPath(): string | null {
  const bundled = path.join(getRuntimeDir(), 'android-tools', 'zipalign.exe');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return findExecutableInPath(['zipalign.exe', 'zipalign']);
}

/**
 * Resolves `uber-apk-signer.jar` from `runtime/android-tools`.
 */
export function getUberApkSignerPath(): string | null {
  const bundled = path.join(getRuntimeDir(), 'android-tools', 'uber-apk-signer.jar');
  return fs.existsSync(bundled) ? bundled : null;
}

/**
 * Resolves `java.exe` by checking the portable JRE first, then `JAVA_HOME`,
 * PATH, and standard Eclipse Adoptium installation directories.
 */
export function getJavaExePath(): string | null {
  const bundled = path.join(getRuntimeDir(), 'jre', 'bin', 'java.exe');
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const fromHome = path.join(javaHome, 'bin', 'java.exe');
    if (fs.existsSync(fromHome)) {
      return fromHome;
    }
  }

  const fromPath = findExecutableInPath(['java.exe', 'java']);
  if (fromPath) {
    return fromPath;
  }

  const adoptiumRoot = 'C:\\Program Files\\Eclipse Adoptium';
  if (fs.existsSync(adoptiumRoot)) {
    try {
      const entries = fs.readdirSync(adoptiumRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const candidate = path.join(adoptiumRoot, entry.name, 'bin', 'java.exe');
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // Ignore permission or directory read errors when probing optional system paths.
    }
  }

  return null;
}

/**
 * Resolves `cloudflared.exe` from `runtime/cloudflared` or PATH.
 */
export function getCloudflaredPath(): string | null {
  const bundled = path.join(getRuntimeDir(), 'cloudflared', 'cloudflared.exe');
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  return findExecutableInPath(['cloudflared.exe', 'cloudflared']);
}

/**
 * Collects availability and resolved paths for all required external runtime tools.
 */
export function getRuntimeStatus(): RuntimeStatus {
  const phpPath = getPhpExePath();
  const zipalignPath = getZipalignPath();
  const uberApkSignerPath = getUberApkSignerPath();
  const javaPath = getJavaExePath();
  const cloudflaredPath = getCloudflaredPath();

  return {
    phpReady: phpPath !== null,
    phpPath,
    zipalignReady: zipalignPath !== null,
    zipalignPath,
    uberApkSignerReady: uberApkSignerPath !== null,
    uberApkSignerPath,
    javaReady: javaPath !== null,
    javaPath,
    cloudflaredReady: cloudflaredPath !== null,
    cloudflaredPath,
  };
}
