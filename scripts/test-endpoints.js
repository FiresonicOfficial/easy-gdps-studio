#!/usr/bin/env node
/**
 * EasyGDPS Studio — Automated Verification & Endpoint Integration Suite
 *
 * Tests:
 *   1. Binary Patcher Verification:
 *      - Reference byte-aligned URL patcher (and compiled dist-electron/main/clientBuilder.js if built)
 *      - Mock PE (.exe) buffer with 33-byte ASCII Boomlings URL replacement
 *      - Mock ELF (.so) buffer with 33-byte ASCII + 44-byte Base64 URL replacement
 *      - Exact byte-length preservation (patched.length === original.length)
 *      - Rejection of >33-byte URLs
 *   2. PHP GDPS Server End-to-End Integration:
 *      - Clean SQLite initialization (init_db.php) & empty overview/portal state
 *      - Account registration & login (plaintext & gjp2)
 *      - Level upload (2.1/2.2 and 1.9), search (1.9 & 2.1 with padded slashes /db////getGJLevels21.php),
 *        and level download with solo/solo2 hash verification
 *      - Comments, likes, user scores & leaderboards
 *      - Admin API (overview & rate_level)
 *      - Friend Download Portal (GET /) English HTML response
 *
 * Usage:
 *   node scripts/test-endpoints.js [--patcher-only] [--keep-temp]
 */

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync, spawn } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ORIGINAL_ASCII_URL = 'http://www.boomlings.com/database'; // 33 bytes
const ORIGINAL_BASE64_URL = 'aHR0cDovL3d3dy5ib29tbGluZ3MuY29tL2RhdGFiYXNl'; // 44 bytes
const MAX_RAW_URL_BYTES = 33;
const EXPECTED_BASE64_URL_BYTES = 44;

function parseArgs(argv) {
  const opts = {
    patcherOnly: false,
    keepTemp: false,
    phpPath: process.env.EASYGDPS_PHP_EXE || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--patcher-only') {
      opts.patcherOnly = true;
    } else if (arg === '--keep-temp') {
      opts.keepTemp = true;
    } else if (arg === '--php' && i + 1 < argv.length) {
      opts.phpPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--php=')) {
      opts.phpPath = path.resolve(arg.slice('--php='.length));
    }
  }
  return opts;
}

function sha1Hex(input) {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');
}

function generateGjp2(password) {
  return sha1Hex(`${password}mI29fmAnxgTs`);
}

function generateSoloHash(levelString) {
  if (levelString.length < 41) {
    return sha1Hex(`${levelString}xI25fpAapCQg`);
  }
  const step = Math.floor(levelString.length / 40);
  let sample = '';
  for (let i = 0; i < 40; i++) {
    sample += levelString[i * step];
  }
  return sha1Hex(`${sample}xI25fpAapCQg`);
}

function generateSolo2HashFromLevels(levels) {
  let acc = '';
  for (const lvl of levels) {
    const idStr = String(lvl.levelID);
    const first = idStr[0] || '0';
    const last = idStr[idStr.length - 1] || '0';
    acc += `${first}${last}${lvl.starStars || 0}${lvl.starCoins || 0}`;
  }
  return sha1Hex(`${acc}xI25fpAapCQg`);
}

function generateSolo2HashForDownload({
  userID,
  starStars = 0,
  starDemon = 0,
  levelID,
  starCoins = 0,
  starFeatured = 0,
  password = '0',
  feaID = 0,
}) {
  return sha1Hex(
    `${userID},${starStars},${starDemon},${levelID},${starCoins},${starFeatured},${password},${feaID}xI25fpAapCQg`
  );
}

// ---------------------------------------------------------------------------
// Reference Binary Patcher (mirrors src/main/clientBuilder.ts)
// ---------------------------------------------------------------------------

function normalizeServerUrlRef(serverBaseUrl) {
  const trimmed = serverBaseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Server URL cannot be empty.');
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid protocol in ${serverBaseUrl}`);
  }
  if (parsed.pathname === '/' || parsed.pathname === '') {
    const withDb = `${trimmed}/db`;
    if (Buffer.byteLength(withDb, 'utf8') <= MAX_RAW_URL_BYTES) {
      return withDb;
    }
  }
  return trimmed;
}

function formatPatchedUrlRef(serverBaseUrl, usesBase64) {
  const normalized = normalizeServerUrlRef(serverBaseUrl);
  const rawByteLen = Buffer.byteLength(normalized, 'utf8');
  if (rawByteLen > MAX_RAW_URL_BYTES) {
    throw new Error(`URL "${normalized}" is ${rawByteLen} bytes (max ${MAX_RAW_URL_BYTES}).`);
  }
  const paddedRaw = normalized + '/'.repeat(MAX_RAW_URL_BYTES - rawByteLen);
  if (!usesBase64) return paddedRaw;
  return Buffer.from(paddedRaw, 'utf8').toString('base64');
}

function replaceAllExactLength(buf, pattern, replacement) {
  assert.equal(pattern.length, replacement.length, 'Pattern and replacement lengths must match');
  let count = 0;
  let offset = 0;
  while (offset <= buf.length - pattern.length) {
    const idx = buf.indexOf(pattern, offset);
    if (idx === -1) break;
    replacement.copy(buf, idx);
    count++;
    offset = idx + pattern.length;
  }
  return count;
}

function patchBinaryBufferRef(buffer, serverBaseUrl, usesBase64) {
  const patchedBuffer = Buffer.from(buffer);
  const patchedAscii = formatPatchedUrlRef(serverBaseUrl, false);
  let replacementsCount = replaceAllExactLength(
    patchedBuffer,
    Buffer.from(ORIGINAL_ASCII_URL, 'utf8'),
    Buffer.from(patchedAscii, 'utf8')
  );
  let patchedUrl = patchedAscii;

  if (usesBase64) {
    const patchedBase64 = formatPatchedUrlRef(serverBaseUrl, true);
    replacementsCount += replaceAllExactLength(
      patchedBuffer,
      Buffer.from(ORIGINAL_BASE64_URL, 'utf8'),
      Buffer.from(patchedBase64, 'utf8')
    );
    patchedUrl = patchedBase64;
  }

  return { patchedBuffer, replacementsCount, patchedUrl };
}

function tryLoadCompiledClientBuilder() {
  const compiledPath = path.join(PROJECT_ROOT, 'dist-electron', 'main', 'clientBuilder.js');
  if (!fs.existsSync(compiledPath)) {
    return null;
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
          getPath: () => os.tmpdir(),
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(compiledPath);
  } finally {
    Module._load = originalLoad;
  }
}

function runPatcherSuite(label, impl) {
  const shortUrl = 'http://127.0.0.1:8080/db';
  const exact33Url = 'http://192.168.1.100:12345/gdpsdb';
  const tooLongUrl = 'https://too-long-tunnel-subdomain.trycloudflare.com/db';

  assert.equal(Buffer.byteLength(ORIGINAL_ASCII_URL, 'utf8'), 33);
  assert.equal(Buffer.byteLength(ORIGINAL_BASE64_URL, 'utf8'), 44);
  assert.equal(Buffer.byteLength(exact33Url, 'utf8'), 33);

  // 1. Padding length checks
  const paddedAscii = impl.formatPatchedUrl(shortUrl, false);
  assert.equal(Buffer.byteLength(paddedAscii, 'utf8'), 33, `${label}: ASCII URL must be 33 bytes`);
  assert.equal(paddedAscii, 'http://127.0.0.1:8080/db/////////');

  const paddedB64 = impl.formatPatchedUrl(shortUrl, true);
  assert.equal(Buffer.byteLength(paddedB64, 'utf8'), 44, `${label}: Base64 URL must be 44 bytes`);
  assert.equal(
    Buffer.from(paddedB64, 'base64').toString('utf8'),
    paddedAscii,
    `${label}: Base64 URL must decode back to 33-byte padded ASCII`
  );

  // 2. Reject >33-byte URLs
  assert.throws(
    () => impl.formatPatchedUrl(tooLongUrl, false),
    /33/,
    `${label}: Must reject URLs exceeding 33 bytes`
  );
  assert.throws(
    () => impl.formatPatchedUrl(tooLongUrl, true),
    /33/,
    `${label}: Must reject URLs exceeding 33 bytes in Base64 mode`
  );

  // 3. Mock PE .exe buffer (ASCII mode)
  const pePrefix = Buffer.from('MZ\x90\x00MOCK_PE_SECTION_DATA_\x00\x00');
  const peMiddle = Buffer.from('\x00\x00\x00MORE_RODATA_\x00');
  const peSuffix = Buffer.from('\x00\x00END_OF_MOCK_PE');
  const mockExe = Buffer.concat([
    pePrefix,
    Buffer.from(ORIGINAL_ASCII_URL, 'ascii'),
    peMiddle,
    Buffer.from(ORIGINAL_ASCII_URL, 'ascii'),
    peSuffix,
  ]);

  const exeRes = impl.patchBinaryBuffer(mockExe, shortUrl, false);
  assert.equal(
    exeRes.patchedBuffer.length,
    mockExe.length,
    `${label}: Patched PE .exe buffer byte length must equal original`
  );
  assert.equal(exeRes.replacementsCount, 2, `${label}: Expected 2 ASCII replacements in mock .exe`);
  assert.equal(
    exeRes.patchedBuffer.indexOf(ORIGINAL_ASCII_URL),
    -1,
    `${label}: No original Boomlings URL should remain in mock .exe`
  );
  assert.ok(
    exeRes.patchedBuffer.subarray(0, pePrefix.length).equals(pePrefix),
    `${label}: PE prefix bytes corrupted`
  );
  assert.ok(
    exeRes.patchedBuffer
      .subarray(exeRes.patchedBuffer.length - peSuffix.length)
      .equals(peSuffix),
    `${label}: PE suffix bytes corrupted`
  );

  // 4. Mock ELF .so buffer (ASCII + Base64 mode, GD 2.1/2.2)
  const elfPrefix = Buffer.from('\x7fELF\x02\x01\x01\x00MOCK_ARM64_SO_\x00');
  const elfMid = Buffer.from('\x00\x00RODATA_GAP\x00\x00');
  const elfSuffix = Buffer.from('\x00\x00END_OF_MOCK_ELF');
  const mockSo = Buffer.concat([
    elfPrefix,
    Buffer.from(ORIGINAL_ASCII_URL, 'ascii'),
    elfMid,
    Buffer.from(ORIGINAL_BASE64_URL, 'ascii'),
    elfSuffix,
  ]);

  const soRes = impl.patchBinaryBuffer(mockSo, exact33Url, true);
  assert.equal(
    soRes.patchedBuffer.length,
    mockSo.length,
    `${label}: Patched ELF .so buffer byte length must equal original`
  );
  assert.equal(
    soRes.replacementsCount,
    2,
    `${label}: Expected 1 ASCII + 1 Base64 replacement in mock .so`
  );
  assert.equal(soRes.patchedBuffer.indexOf(ORIGINAL_ASCII_URL), -1);
  assert.equal(soRes.patchedBuffer.indexOf(ORIGINAL_BASE64_URL), -1);
  assert.ok(soRes.patchedBuffer.includes(exact33Url));
  assert.ok(
    soRes.patchedBuffer.includes(Buffer.from(exact33Url, 'utf8').toString('base64'))
  );
}

function testBinaryPatcher() {
  console.log('\n[1/2] Running Binary Patcher Verification...');
  runPatcherSuite('reference-patcher', {
    formatPatchedUrl: formatPatchedUrlRef,
    patchBinaryBuffer: patchBinaryBufferRef,
  });
  console.log('  PASS: Reference binary patcher (33B ASCII, 44B Base64, >33B rejection, mock .exe/.so)');

  const compiled = tryLoadCompiledClientBuilder();
  if (compiled && typeof compiled.patchBinaryBuffer === 'function') {
    runPatcherSuite('dist-electron/main/clientBuilder.js', compiled);
    console.log('  PASS: Compiled dist-electron/main/clientBuilder.js matches all binary patcher invariants');
  } else {
    console.log('  INFO: dist-electron/main/clientBuilder.js not built yet; tested reference patcher');
  }
}

// ---------------------------------------------------------------------------
// PHP End-to-End Integration Suite
// ---------------------------------------------------------------------------

function locatePhpRuntime(explicitPhpPath) {
  if (explicitPhpPath) {
    if (!fs.existsSync(explicitPhpPath)) {
      throw new Error(`Specified --php executable does not exist: ${explicitPhpPath}`);
    }
    const siblingIni = path.join(path.dirname(explicitPhpPath), 'php.ini');
    return {
      phpExe: explicitPhpPath,
      phpIni: fs.existsSync(siblingIni) ? siblingIni : null,
    };
  }

  const bundledExe = path.join(PROJECT_ROOT, 'resources', 'runtime', 'php', 'php.exe');
  const bundledIni = path.join(PROJECT_ROOT, 'resources', 'runtime', 'php', 'php.ini');
  if (fs.existsSync(bundledExe)) {
    return {
      phpExe: bundledExe,
      phpIni: fs.existsSync(bundledIni) ? bundledIni : null,
    };
  }

  const pathEnv = process.env.PATH || '';
  const candidates = process.platform === 'win32' ? ['php.exe', 'php'] : ['php'];
  for (const dir of pathEnv.split(path.delimiter).filter(Boolean)) {
    for (const name of candidates) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return { phpExe: candidate, phpIni: null };
      }
    }
  }

  return null;
}

function copyDirRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name === '.gitkeep') continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForServerReady(baseUrl, phpProc, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (phpProc.exitCode !== null) {
      throw new Error(`PHP built-in server exited early with code ${phpProc.exitCode}`);
    }
    try {
      const res = await fetch(`${baseUrl}/admin_api.php?action=overview`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.status > 0) return;
    } catch {
      // Retry until ready
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`PHP server did not become ready at ${baseUrl} within ${timeoutMs}ms`);
}

async function terminateProcess(proc) {
  if (!proc || proc.exitCode !== null) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    proc.once('exit', finish);
    proc.kill();
    setTimeout(() => {
      if (!done && proc.pid) {
        if (process.platform === 'win32') {
          try {
            execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } catch {
            // Process may already be gone
          }
          finish();
        } else {
          proc.kill('SIGKILL');
          finish();
        }
      }
    }, 1500);
  });
}

async function postForm(url, params) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    body.set(k, String(v));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

function parseGdKeyValueRecord(recordStr) {
  const parts = recordStr.split(':');
  const map = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    map.set(parts[i], parts[i + 1]);
  }
  return map;
}

async function testPhpIntegration(opts) {
  console.log('\n[2/2] Running PHP GDPS Server End-to-End Integration Tests...');

  const runtime = locatePhpRuntime(opts.phpPath);
  if (!runtime) {
    throw new Error(
      'PHP runtime not found in resources/runtime/php/php.exe or PATH. Run "npm run fetch-runtimes" first.'
    );
  }
  console.log(`  Using PHP: ${runtime.phpExe}`);

  const coreTemplateDir = path.join(PROJECT_ROOT, 'server-templates', 'core');
  const schemaTemplateDir = path.join(PROJECT_ROOT, 'server-templates', 'schema');
  if (!fs.existsSync(coreTemplateDir) || !fs.existsSync(schemaTemplateDir)) {
    throw new Error('Missing server-templates/core/ or server-templates/schema/.');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'easygdps-e2e-'));
  const coreDir = path.join(tempRoot, 'core');
  const schemaDir = path.join(tempRoot, 'schema');
  let phpProc = null;
  let serverLogs = '';

  try {
    copyDirRecursive(coreTemplateDir, coreDir);
    copyDirRecursive(schemaTemplateDir, schemaDir);
    fs.mkdirSync(path.join(tempRoot, 'data', 'levels'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'data', 'saves'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'public', 'downloads'), { recursive: true });

    const port = await getFreePort();
    const adminToken = crypto.randomBytes(16).toString('hex');
    const adminHeaders = {
      'Content-Type': 'application/json',
      'X-EasyGDPS-Admin-Token': adminToken,
    };
    fs.writeFileSync(
      path.join(tempRoot, 'server_config.json'),
      JSON.stringify(
        {
          id: 'test-e2e',
          name: 'EasyGDPS Test Server',
          version: '2.2',
          port,
          networkMode: 'localhost',
          adminToken,
          createdAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf8'
    );

    // Step 1: Clean SQLite initialization via init_db.php
    const initArgs = runtime.phpIni
      ? ['-c', runtime.phpIni, path.join(coreDir, 'init_db.php')]
      : [path.join(coreDir, 'init_db.php')];
    const initOut = execFileSync(runtime.phpExe, initArgs, {
      cwd: coreDir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.ok(
      fs.existsSync(path.join(tempRoot, 'data', 'database.sqlite')),
      'SQLite database file must be created by init_db.php'
    );
    console.log(`  PASS: SQLite initialized cleanly (${initOut.trim()})`);

    // Start PHP built-in server
    const serverArgs = [];
    if (runtime.phpIni) {
      serverArgs.push('-c', runtime.phpIni);
    }
    serverArgs.push('-S', `127.0.0.1:${port}`, '-t', coreDir, path.join(coreDir, 'router.php'));

    phpProc = spawn(runtime.phpExe, serverArgs, {
      cwd: coreDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    phpProc.stdout?.on('data', (d) => {
      serverLogs += d.toString('utf8');
    });
    phpProc.stderr?.on('data', (d) => {
      serverLogs += d.toString('utf8');
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServerReady(baseUrl, phpProc);
    console.log(`  PASS: PHP test server listening on ${baseUrl}`);

    // Step 2: Verify clean empty state on index.php and hardened admin_api.php security
    const portalRes = await fetch(`${baseUrl}/index.php`);
    assert.equal(portalRes.status, 200, 'GET /index.php must return 200 OK');
    const portalHtml = await portalRes.text();
    assert.ok(portalHtml.includes('EasyGDPS Test Server'), 'Portal HTML must include server name');

    const unauthOverviewRes = await fetch(`${baseUrl}/admin_api.php?action=overview`);
    assert.equal(
      unauthOverviewRes.status,
      403,
      'GET /admin_api.php?action=overview without X-EasyGDPS-Admin-Token must return 403'
    );

    const proxiedOverviewRes = await fetch(`${baseUrl}/admin_api.php?action=overview`, {
      headers: {
        ...adminHeaders,
        'X-Forwarded-For': '198.51.100.42',
      },
    });
    assert.equal(
      proxiedOverviewRes.status,
      403,
      'GET /admin_api.php?action=overview with X-Forwarded-For must return 403'
    );

    const emptyOverviewRes = await fetch(`${baseUrl}/admin_api.php?action=overview`, {
      headers: adminHeaders,
    });
    assert.equal(
      emptyOverviewRes.status,
      200,
      'GET /admin_api.php?action=overview with valid token must return 200'
    );
    const emptyOverviewJson = await emptyOverviewRes.json();
    const emptyData = emptyOverviewJson.data || emptyOverviewJson;
    assert.equal(emptyData.stats.accountsCount, 0, 'Initial accountsCount must be 0');
    assert.equal(emptyData.stats.levelsCount, 0, 'Initial levelsCount must be 0');
    assert.equal(emptyData.stats.usersCount, 0, 'Initial usersCount must be 0');
    assert.equal(emptyData.stats.commentsCount, 0, 'Initial commentsCount must be 0');
    console.log(
      '  PASS: Empty initial state and hardened admin_api.php auth/proxy guards verified'
    );

    // Step 3: Account registration & login
    const testUser = 'E2ETester';
    const testPass = 'SecretPass123';
    const regRes = await postForm(`${baseUrl}/db/accounts/registerGJAccount.php`, {
      userName: testUser,
      password: testPass,
      email: 'e2e@example.com',
      secret: 'Wmfv3899gc9',
    });
    assert.equal(regRes.status, 200);
    assert.equal(regRes.text.trim(), '1', `Expected '1' on register, got "${regRes.text}"`);

    const dupRegRes = await postForm(`${baseUrl}/db/accounts/registerGJAccount.php`, {
      userName: testUser,
      password: testPass,
      email: 'e2e2@example.com',
      secret: 'Wmfv3899gc9',
    });
    assert.equal(dupRegRes.text.trim(), '-2', 'Duplicate username must return -2');

    const loginRes = await postForm(`${baseUrl}/db/accounts/loginGJAccount.php`, {
      userName: testUser,
      password: testPass,
      udid: 'E2E-UDID-001',
    });
    assert.equal(loginRes.status, 200);
    const loginParts = loginRes.text.trim().split(',');
    assert.equal(loginParts.length, 2, `Expected accountID,userID, got "${loginRes.text}"`);
    const accountID = Number(loginParts[0]);
    const userID = Number(loginParts[1]);
    assert.ok(accountID > 0 && userID > 0, 'accountID and userID must be positive integers');

    const gjp2 = generateGjp2(testPass);
    const gjp2LoginRes = await postForm(`${baseUrl}/db/accounts/loginGJAccount.php`, {
      userName: testUser,
      gjp2,
      udid: 'E2E-UDID-001',
    });
    assert.equal(gjp2LoginRes.text.trim(), `${accountID},${userID}`, 'gjp2 login must succeed');
    console.log(`  PASS: Account registration & login verified (accountID=${accountID}, userID=${userID})`);

    // Step 4: Level upload (2.1/2.2 and 1.9), search (1.9 & 2.1 with padded slashes), download + hashes
    const sampleLevelString =
      'kS38,1_40_2_125_3_255_11_255_12_255_13_255_4_-1_6_1000_7_1_15_1_18_0_8_1|;1,1,2,15,3,15;1,1,2,105,3,15;1,8,2,195,3,15;';
    const level1DescB64 = Buffer.from('Modern 2.2 Test Level', 'utf8').toString('base64url');
    const up21Res = await postForm(`${baseUrl}/db/uploadGJLevel21.php`, {
      accountID,
      gjp2,
      userName: testUser,
      levelName: 'CyberPulse',
      levelDesc: level1DescB64,
      levelString: sampleLevelString,
      levelVersion: 1,
      levelLength: 2,
      audioTrack: 1,
      password: '0',
      objects: 150,
      coins: 3,
      requestedStars: 7,
      gameVersion: 22,
      binaryVersion: 42,
    });
    const levelID1 = Number(up21Res.text.trim());
    assert.ok(Number.isInteger(levelID1) && levelID1 > 0, `2.1 upload failed: "${up21Res.text}"`);

    const up19Res = await postForm(`${baseUrl}/db/uploadGJLevel.php`, {
      udid: 'LEGACY-19-UDID',
      userName: 'ClassicBuilder',
      levelName: 'RetroWave19',
      levelDesc: 'Classic 1.9 Level',
      levelString: sampleLevelString,
      levelVersion: 1,
      levelLength: 1,
      audioTrack: 0,
      gameVersion: 19,
      binaryVersion: 19,
    });
    const levelID2 = Number(up19Res.text.trim());
    assert.ok(Number.isInteger(levelID2) && levelID2 > 0, `1.9 upload failed: "${up19Res.text}"`);

    // Search 1.9 endpoint
    const search19Res = await postForm(`${baseUrl}/db/getGJLevels19.php`, {
      type: 4,
      page: 0,
      gameVersion: 19,
    });
    const seg19 = search19Res.text.split('#');
    assert.equal(seg19.length, 4, `1.9 search must have 4 '#' segments, got ${seg19.length}`);
    assert.ok(seg19[0].includes('RetroWave19'), '1.9 search must return RetroWave19');
    assert.ok(seg19[0].includes('CyberPulse'), '1.9 search must return CyberPulse');

    // Search 2.1 endpoint WITH padded slashes (/db////getGJLevels21.php)
    const search21PaddedRes = await postForm(`${baseUrl}/db////getGJLevels21.php`, {
      type: 0,
      str: 'CyberPulse',
      page: 0,
      gameVersion: 22,
    });
    const seg21 = search21PaddedRes.text.split('#');
    assert.equal(seg21.length, 5, `2.1 search must have 5 '#' segments, got ${seg21.length}`);
    const levelMap21 = parseGdKeyValueRecord(seg21[0].split('|')[0]);
    assert.equal(Number(levelMap21.get('1')), levelID1, '2.1 search must return uploaded levelID');
    assert.equal(levelMap21.get('2'), 'CyberPulse');
    const expectedSearchHash = generateSolo2HashFromLevels([
      { levelID: levelID1, starStars: 0, starCoins: 0 },
    ]);
    assert.equal(seg21[4], expectedSearchHash, '2.1 search solo2 hash mismatch');

    // Download 2.1 endpoint & verify solo + solo2 hashes
    const dlRes = await postForm(`${baseUrl}/db/downloadGJLevel21.php`, {
      levelID: levelID1,
      gameVersion: 22,
    });
    const dlSegs = dlRes.text.split('#');
    assert.equal(dlSegs.length, 3, `2.1 download must have 3 '#' segments, got ${dlSegs.length}`);
    const dlMap = parseGdKeyValueRecord(dlSegs[0]);
    assert.equal(Number(dlMap.get('1')), levelID1);
    assert.equal(dlMap.get('4'), sampleLevelString, 'Downloaded levelString must match uploaded data');
    assert.equal(dlSegs[1], generateSoloHash(sampleLevelString), 'Download solo hash mismatch');
    assert.equal(
      dlSegs[2],
      generateSolo2HashForDownload({
        userID,
        levelID: levelID1,
        password: '0',
      }),
      'Download solo2 hash mismatch'
    );
    console.log(
      `  PASS: Level upload, 1.9/2.1 search (with /db//// padding), and download hashes verified (IDs ${levelID1}, ${levelID2})`
    );

    // Step 5: Comments, Likes, User Score & Leaderboards, Admin API
    const commentB64 = Buffer.from('Awesome E2E level!', 'utf8').toString('base64url');
    const upCommentRes = await postForm(`${baseUrl}/db/uploadGJComment21.php`, {
      accountID,
      gjp2,
      userName: testUser,
      levelID: levelID1,
      comment: commentB64,
      percent: 100,
    });
    const commentIdNum = Number(upCommentRes.text.trim());
    assert.ok(
      Number.isInteger(commentIdNum) && commentIdNum > 0,
      `uploadGJComment21.php failed: "${upCommentRes.text}"`
    );

    const getCommentsRes = await postForm(`${baseUrl}/db/getGJComments21.php`, {
      levelID: levelID1,
      page: 0,
      gameVersion: 22,
      binaryVersion: 35,
    });
    const commentParts21 = getCommentsRes.text.split('#');
    assert.equal(
      commentParts21.length,
      2,
      `Modern getGJComments21.php must return 2 '#' segments (no #users#), got: "${getCommentsRes.text}"`
    );
    assert.ok(
      commentParts21[0].includes(`2~${commentB64}~`) && commentParts21[0].includes(`:1~${testUser}~7~1~`),
      `Modern getGJComments21.php must return Base64 comment with inline userPart: "${getCommentsRes.text}"`
    );
    assert.equal(commentParts21[1], '1:0:1', 'Modern getGJComments21.php pagination mismatch');

    const getComments19Res = await postForm(`${baseUrl}/db/getGJComments19.php`, {
      levelID: levelID1,
      page: 0,
    });
    const commentParts19 = getComments19Res.text.split('#');
    assert.equal(
      commentParts19.length,
      3,
      `Legacy getGJComments19.php must return 3 '#' segments, got: "${getComments19Res.text}"`
    );
    assert.ok(
      commentParts19[0].includes('2~Awesome E2E level!~') && !commentParts19[0].includes(':'),
      `Legacy getGJComments19.php must return plaintext without inline userPart: "${getComments19Res.text}"`
    );
    assert.equal(commentParts19[1], `${userID}:${testUser}:${accountID}`);
    assert.equal(commentParts19[2], '1:0:1');

    const likeRes = await postForm(`${baseUrl}/db/likeGJItem211.php`, {
      accountID,
      gjp2,
      itemID: levelID1,
      type: 1,
      like: 1,
    });
    assert.equal(likeRes.text.trim(), '1', `likeGJItem211.php failed: "${likeRes.text}"`);

    const scoreUpdRes = await postForm(`${baseUrl}/db/updateGJUserScore22.php`, {
      accountID,
      gjp2,
      userName: testUser,
      stars: 42,
      moons: 7,
      demons: 3,
      diamonds: 120,
      coins: 12,
      userCoins: 18,
    });
    assert.equal(
      scoreUpdRes.text.trim(),
      String(userID),
      `updateGJUserScore22.php failed: "${scoreUpdRes.text}"`
    );

    const scoresRes = await postForm(`${baseUrl}/db/getGJScores20.php`, {
      accountID,
      gjp2,
      type: 'top',
    });
    assert.ok(scoresRes.text.includes(testUser), 'getGJScores20.php must include test user');
    assert.ok(scoresRes.text.includes(':3:42:'), 'getGJScores20.php must reflect 42 stars');

    // Admin API rateLevel & overview (authenticated with X-EasyGDPS-Admin-Token)
    const rateRes = await fetch(`${baseUrl}/admin_api.php?action=rateLevel`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        levelID: levelID1,
        stars: 10,
        featured: 1,
        epic: 1,
        demon: 1,
        auto: 0,
      }),
    });
    assert.equal(rateRes.status, 200, 'admin_api.php?action=rateLevel must return 200');
    const rateJson = await rateRes.json();
    assert.notEqual(rateJson.ok, false, `rate_level returned failure: ${JSON.stringify(rateJson)}`);

    const fullOverviewRes = await fetch(`${baseUrl}/admin_api.php?action=overview`, {
      headers: adminHeaders,
    });
    assert.equal(fullOverviewRes.status, 200);
    const fullOverviewJson = await fullOverviewRes.json();
    const overview = fullOverviewJson.data || fullOverviewJson;
    assert.equal(overview.stats.accountsCount, 1, 'Expected 1 account in overview');
    assert.equal(overview.stats.levelsCount, 2, 'Expected 2 levels in overview');
    assert.equal(overview.stats.commentsCount, 1, 'Expected 1 comment in overview');
    const ratedLevel = overview.levels.find((l) => Number(l.levelID) === levelID1);
    assert.ok(ratedLevel, 'Rated level must appear in admin overview');
    assert.equal(Number(ratedLevel.starStars), 10, 'Rated level must have 10 stars');
    assert.equal(Number(ratedLevel.starEpic), 1, 'Rated level must have epic=1');
    console.log('  PASS: Comments, likes, user scores/leaderboards, and Admin API rateLevel/overview verified');

    // Step 6: Friend Download Portal (GET /)
    const rootRes = await fetch(`${baseUrl}/`);
    assert.equal(rootRes.status, 200, 'GET / must return 200 OK');
    const ct = rootRes.headers.get('content-type') || '';
    assert.ok(ct.toLowerCase().includes('text/html'), `GET / Content-Type must be text/html, got ${ct}`);
    const rootHtml = await rootRes.text();
    assert.ok(rootHtml.includes('<html') && rootHtml.includes('EasyGDPS Test Server'));
    console.log('  PASS: Friend Download Portal (GET /) returns 200 OK English HTML');
  } catch (err) {
    if (serverLogs) {
      console.error('\n--- PHP Server Logs ---\n' + serverLogs.trim());
    }
    throw err;
  } finally {
    await terminateProcess(phpProc);
    if (!opts.keepTemp && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } else if (opts.keepTemp) {
      console.log(`  INFO: Kept temporary instance directory (--keep-temp): ${tempRoot}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log('=== EasyGDPS Studio Automated Verification Suite ===');

  testBinaryPatcher();
  if (!opts.patcherOnly) {
    await testPhpIntegration(opts);
  }

  console.log('\nALL CHECKS PASSED.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\nTEST SUITE FAILED: ${err.stack || err.message}`);
  process.exit(1);
});
