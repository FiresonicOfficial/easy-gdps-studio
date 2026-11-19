#!/usr/bin/env node
/**
 * EasyGDPS Studio — Comprehensive Isolated Verification Suite
 *
 * Runs ALL tests in completely isolated temporary directories under os.tmpdir()
 * (cleaned up in finally) without modifying Electron userData or workspace files.
 *
 * Suites:
 *   1. Cross-Version Comments Suite (GD 1.1 - 2.2):
 *      - GD 1.8 empty (-2), plaintext upload, exact 3-part legacy format, legacy DB row read by 1.8 & 2.1
 *      - GD 1.9, GD 2.0 (Base64 + #users#), GD 2.1 / 2.2 (Base64 + inline :userPart, no #users#)
 *      - User Comment History (userID without levelID -> includes 1~<levelID>~)
 *      - GD 2.2 List Comments (negative levelID referencing level_lists)
 *   2. Strict Version-Gating Matrix (1.5, 1.6, 1.8, 2.0, 2.1, 2.11, 2.2):
 *      - Map Packs blocked on 1.5, allowed on 1.6..2.2 (colors2 fallback, Solo4 hash, exact type=10 order)
 *      - Gauntlets blocked on 1.5..2.0, allowed 1..15 on 2.1/2.11 (16 rejected), allowed 1..60 on 2.2 (0 & 61 rejected)
 *   3. Exhaustive Gauntlet & Map Pack Edge Cases:
 *      - Invalid/duplicate/missing/deleted level IDs rejected
 *      - Upsert same Gauntlet slot ID without duplicates
 *      - getGJGauntlets21.php (normal & special=1) exact format & Solo3 SHA1 hash
 *      - getGJLevels21.php?gauntlet=1 with non-ascending order + unlisted=1 level -> exact order, field 44:1, Solo2 hash
 *      - Delete Integrity Guard (HTTP 409 when referenced by Gauntlet or Map Pack; HTTP 200 after unlinking)
 *      - Map Pack validation, edit, and delete edge cases
 *   4. Isolated 5-Network-Mode Suite (Localhost, LAN, VPN, VPS, Cloudflare Quick Tunnel):
 *      - Compiles TypeScript main modules to os.tmpdir() and loads real serverManager + clientBuilder with mocked userData
 *      - Mode 1: Localhost (token auth 403/200, GD endpoints, 33B/44B binary patcher)
 *      - Mode 2: LAN (real detected LAN IP, real 1.811 APK patching across all ABIs if present, LAN HTTP reachability, LAN admin 403)
 *      - Mode 3: VPN (26.10.20.30, 0.0.0.0 bind, publicUrl, 33B/44B binary patcher)
 *      - Mode 4: VPS (public IP, short HTTPS, exact 33B, over-33B redirector warning, reverse-proxy admin 403 vs GD 200)
 *      - Mode 5: Live Cloudflare Quick Tunnel via bundled cloudflared.exe (portal 200, levels 200, gauntlets 200, admin 403)
 *
 * Usage:
 *   node scripts/test-isolated-suite.js [--keep-temp] [--skip-cloudflare]
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
const SAMPLE_LEVEL_STRING =
  'kS38,1_40_2_125_3_255_11_255_12_255_13_255_4_-1_6_1000_7_1_15_1_18_0_8_1|;1,1,2,15,3,15;1,1,2,105,3,15;1,8,2,195,3,15;';

function parseArgs(argv) {
  return {
    keepTemp: argv.includes('--keep-temp'),
    skipCloudflare: argv.includes('--skip-cloudflare'),
  };
}

// ---------------------------------------------------------------------------
// Crypto & GD Protocol Helpers
// ---------------------------------------------------------------------------

function sha1Hex(input) {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex');
}

function generateGjp2(password) {
  return sha1Hex(`${password}mI29fmAnxgTs`);
}

function gdBase64UrlEncode(text) {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
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

function generateSolo3Hash(data) {
  return sha1Hex(`${data}xI25fpAapCQg`);
}

function generateSolo4Hash(packs) {
  let acc = '';
  for (const pack of packs) {
    const idStr = String(pack.ID);
    const first = idStr[0] || '0';
    const last = idStr[idStr.length - 1] || '0';
    acc += `${first}${last}${pack.stars}${pack.coins}`;
  }
  return sha1Hex(`${acc}xI25fpAapCQg`);
}

function parseGdKeyValueRecord(recordStr, sep = ':') {
  const parts = recordStr.split(sep);
  const map = new Map();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    map.set(parts[i], parts[i + 1]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Runtime, Process & Filesystem Helpers
// ---------------------------------------------------------------------------

function locatePhpRuntime() {
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

  throw new Error('PHP runtime not found in resources/runtime/php/php.exe or PATH.');
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

async function rmDirWithRetry(targetDir, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    if (!fs.existsSync(targetDir)) return;
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === attempts - 1) {
        console.warn(`  WARN: Could not fully remove temp dir ${targetDir}: ${err.message}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
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
    try {
      proc.kill();
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (!done && proc.pid) {
        if (process.platform === 'win32') {
          try {
            execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } catch {
            // already exited
          }
          finish();
        } else {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          finish();
        }
      }
    }, 1200);
  });
}

async function waitForHttpReady(url, proc, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc && proc.exitCode !== null) {
      throw new Error(`Process exited early with code ${proc.exitCode}`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.status > 0) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

function execPhpSqlite(phpRuntime, dbPath, sql, params = []) {
  const script = [
    '$pdo = new PDO("sqlite:" . $argv[1]);',
    '$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);',
    '$stmt = $pdo->prepare($argv[2]);',
    '$params = json_decode($argv[3], true);',
    '$stmt->execute(is_array($params) ? $params : []);',
    'if (stripos(ltrim($argv[2]), "SELECT") === 0) {',
    '  echo json_encode($stmt->fetchAll(PDO::FETCH_ASSOC));',
    '} else {',
    '  echo json_encode(["changes" => $stmt->rowCount(), "lastInsertId" => $pdo->lastInsertId()]);',
    '}',
  ].join(' ');

  const args = [];
  if (phpRuntime.phpIni) {
    args.push('-c', phpRuntime.phpIni);
  }
  args.push('-r', script, dbPath, sql, JSON.stringify(params));

  const out = execFileSync(phpRuntime.phpExe, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  return JSON.parse(out);
}

async function postForm(url, params = {}, extraHeaders = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      body.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

async function adminCall(baseUrl, adminToken, method, action, body = null, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (adminToken !== null && adminToken !== undefined) {
    headers['X-EasyGDPS-Admin-Token'] = adminToken;
  }
  const res = await fetch(`${baseUrl}/admin_api.php?action=${encodeURIComponent(action)}`, {
    method,
    headers,
    body: method === 'POST' && body !== null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON fallback
  }
  return { status: res.status, text, json };
}

/**
 * Starts a clean, isolated PHP GDPS server instance inside suiteTempRoot.
 */
async function startIsolatedPhpServer(phpRuntime, suiteTempRoot, label, version) {
  const coreTemplateDir = path.join(PROJECT_ROOT, 'server-templates', 'core');
  const schemaTemplateDir = path.join(PROJECT_ROOT, 'server-templates', 'schema');
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, '_');
  const instanceRoot = path.join(
    suiteTempRoot,
    `php-${safeLabel}-${crypto.randomBytes(3).toString('hex')}`
  );
  const coreDir = path.join(instanceRoot, 'core');
  const schemaDir = path.join(instanceRoot, 'schema');

  copyDirRecursive(coreTemplateDir, coreDir);
  copyDirRecursive(schemaTemplateDir, schemaDir);
  fs.mkdirSync(path.join(instanceRoot, 'data', 'levels'), { recursive: true });
  fs.mkdirSync(path.join(instanceRoot, 'data', 'saves'), { recursive: true });
  fs.mkdirSync(path.join(instanceRoot, 'public', 'downloads'), { recursive: true });

  const port = await getFreePort();
  const adminToken = crypto.randomBytes(16).toString('hex');

  fs.writeFileSync(
    path.join(instanceRoot, 'server_config.json'),
    JSON.stringify(
      {
        id: safeLabel,
        name: `Isolated ${label} (${version})`,
        version,
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

  const initArgs = phpRuntime.phpIni
    ? ['-c', phpRuntime.phpIni, path.join(coreDir, 'init_db.php')]
    : [path.join(coreDir, 'init_db.php')];
  execFileSync(phpRuntime.phpExe, initArgs, {
    cwd: coreDir,
    encoding: 'utf8',
    windowsHide: true,
  });

  const dbPath = path.join(instanceRoot, 'data', 'database.sqlite');
  assert.ok(fs.existsSync(dbPath), `SQLite DB must be initialized for ${label}`);

  const serverArgs = [];
  if (phpRuntime.phpIni) {
    serverArgs.push('-c', phpRuntime.phpIni);
  }
  serverArgs.push('-S', `127.0.0.1:${port}`, '-t', coreDir, path.join(coreDir, 'router.php'));

  let logs = '';
  const phpProc = spawn(phpRuntime.phpExe, serverArgs, {
    cwd: coreDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  phpProc.stdout?.on('data', (d) => {
    logs += d.toString('utf8');
  });
  phpProc.stderr?.on('data', (d) => {
    logs += d.toString('utf8');
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHttpReady(`${baseUrl}/index.php`, phpProc);

  return {
    baseUrl,
    port,
    dbPath,
    adminToken,
    instanceRoot,
    phpProc,
    getLogs: () => logs,
    stop: async () => {
      await terminateProcess(phpProc);
    },
  };
}

async function seedLegacyLevel(baseUrl, { udid = 'SEED-UDID', userName = 'SeedUser', levelName, gameVersion = 18, unlisted = 0 }) {
  const res = await postForm(`${baseUrl}/db/uploadGJLevel.php`, {
    udid,
    userName,
    levelName,
    levelDesc: `Desc for ${levelName}`,
    levelString: SAMPLE_LEVEL_STRING,
    levelVersion: 1,
    levelLength: 1,
    audioTrack: 0,
    gameVersion,
    unlisted,
  });
  const id = Number(res.text.trim());
  assert.ok(Number.isInteger(id) && id > 0, `Failed to upload legacy level ${levelName}: "${res.text}"`);
  return id;
}

async function registerAndLogin(baseUrl, userName, password = 'TestPassword123') {
  const reg = await postForm(`${baseUrl}/db/accounts/registerGJAccount.php`, {
    userName,
    password,
    email: `${userName.toLowerCase()}@example.com`,
    secret: 'Wmfv3899gc9',
  });
  assert.equal(reg.text.trim(), '1', `Failed to register ${userName}: "${reg.text}"`);

  const gjp2 = generateGjp2(password);
  const login = await postForm(`${baseUrl}/db/accounts/loginGJAccount.php`, {
    userName,
    gjp2,
    udid: `UDID-${userName}`,
  });
  const [accountID, userID] = login.text.trim().split(',').map(Number);
  assert.ok(accountID > 0 && userID > 0, `Failed to login ${userName}: "${login.text}"`);
  return { accountID, userID, userName, password, gjp2 };
}

async function seedAccountLevel(baseUrl, acct, { levelName, gameVersion = 22, binaryVersion = 42, unlisted = 0, endpoint = '/db/uploadGJLevel21.php' }) {
  const res = await postForm(`${baseUrl}${endpoint}`, {
    accountID: acct.accountID,
    gjp2: acct.gjp2,
    userName: acct.userName,
    levelName,
    levelDesc: gdBase64UrlEncode(`Desc for ${levelName}`),
    levelString: SAMPLE_LEVEL_STRING,
    levelVersion: 1,
    levelLength: 2,
    audioTrack: 1,
    password: '0',
    objects: 120,
    coins: 3,
    requestedStars: 5,
    gameVersion,
    binaryVersion,
    unlisted,
  });
  const id = Number(res.text.trim());
  assert.ok(Number.isInteger(id) && id > 0, `Failed to upload level ${levelName}: "${res.text}"`);
  return id;
}

// ---------------------------------------------------------------------------
// Test Runner Accounting
// ---------------------------------------------------------------------------

const results = [];

async function runCase(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - start;
    results.push({ name, passed: true, ms, detail: detail || '' });
    console.log(`  [PASS] ${name} (${ms}ms)${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ name, passed: false, ms, error: err });
    console.error(`  [FAIL] ${name} (${ms}ms)\n         ${err.message}`);
  }
}

// ===========================================================================
// SUITE 1: Cross-Version Comments Suite (GD 1.1 - 2.2)
// ===========================================================================

async function runSuite1Comments(phpRuntime, suiteTempRoot) {
  console.log('\n======================================================================');
  console.log('SUITE 1: Cross-Version Comments Suite (GD 1.1 - 2.2)');
  console.log('======================================================================');

  // 1A. GD 1.8 server tests
  await runCase('GD 1.8: empty comments (-2), plaintext upload, exact 3-part format, & legacy DB row interop (1.8 + 2.1)', async () => {
    const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, 'comments-18', '1.8');
    try {
      const levelID = await seedLegacyLevel(srv.baseUrl, {
        udid: 'GD18-UDID-PLAYER',
        userName: 'Player',
        levelName: 'ClassicLevel18',
        gameVersion: 18,
      });
      assert.equal(levelID, 1);

      // Empty level comments -> -2
      const emptyRes = await postForm(`${srv.baseUrl}/db/getGJComments.php`, {
        levelID,
        page: 0,
      });
      assert.equal(emptyRes.status, 200);
      assert.equal(emptyRes.text.trim(), '-2', `Expected -2 for empty comments, got "${emptyRes.text}"`);

      // Upload plaintext comment "hi" (no gameVersion or binaryVersion)
      const upRes = await postForm(`${srv.baseUrl}/db/uploadGJComment.php`, {
        levelID,
        comment: 'hi',
        udid: 'GD18-UDID-PLAYER',
        userName: 'Player',
      });
      assert.equal(upRes.status, 200);
      assert.equal(upRes.text.trim(), '1', `Expected '1' from uploadGJComment.php, got "${upRes.text}"`);

      // Fetch via POST /db/getGJComments.php -> exact 3-part legacy format
      const get18 = await postForm(`${srv.baseUrl}/db/getGJComments.php`, {
        levelID,
        page: 0,
      });
      assert.equal(get18.status, 200);
      const parts18 = get18.text.split('#');
      assert.equal(
        parts18.length,
        3,
        `GD 1.8 getGJComments.php must have 3 '#' parts, got ${parts18.length}: "${get18.text}"`
      );
      assert.ok(
        /^2~hi~3~1~4~0~5~0~7~0~9~[^~]+~6~1$/.test(parts18[0]),
        `GD 1.8 comment record format mismatch: "${parts18[0]}"`
      );
      assert.ok(!parts18[0].includes(':'), 'GD 1.8 comment must NOT contain inline :userPart');
      assert.ok(!parts18[0].startsWith('1~'), 'GD 1.8 level comment must NOT include 1~levelID~');
      assert.equal(parts18[1], '1:Player:0', `Expected user segment "1:Player:0", got "${parts18[1]}"`);
      assert.equal(parts18[2], '1:0:1', `Expected pagination "1:0:1", got "${parts18[2]}"`);

      // Directly insert a legacy plaintext row into SQLite
      const nowSec = Math.floor(Date.now() / 1000);
      execPhpSqlite(
        phpRuntime,
        srv.dbPath,
        'INSERT INTO comments (userID, userName, levelID, comment, percent, likes, isSpam, timestamp) VALUES (?, ?, ?, ?, 0, 0, 0, ?)',
        [1, 'Player', levelID, 'hello from old db', nowSec]
      );

      // Read via GD 1.8 -> plaintext for both rows
      const get18After = await postForm(`${srv.baseUrl}/db/getGJComments.php`, {
        levelID,
        page: 0,
      });
      const p18 = get18After.text.split('#');
      assert.equal(p18.length, 3);
      const entries18 = p18[0].split('|');
      assert.equal(entries18.length, 2);
      assert.ok(
        entries18[0].startsWith('2~hello from old db~3~1~'),
        `GD 1.8 must read legacy plaintext row as plaintext: "${entries18[0]}"`
      );
      assert.ok(
        entries18[1].startsWith('2~hi~3~1~'),
        `GD 1.8 must decode Base64url stored row back to plaintext "hi": "${entries18[1]}"`
      );
      assert.equal(p18[2], '2:0:2');

      // Read SAME DB via GD 2.1 (binaryVersion=35, gameVersion=21) -> Base64url + inline userPart!
      const get21After = await postForm(`${srv.baseUrl}/db/getGJComments21.php`, {
        levelID,
        page: 0,
        binaryVersion: 35,
        gameVersion: 21,
      });
      const p21 = get21After.text.split('#');
      assert.equal(
        p21.length,
        2,
        `GD 2.1 getGJComments21.php must return 2 '#' segments (no #users#), got "${get21After.text}"`
      );
      const entries21 = p21[0].split('|');
      assert.equal(entries21.length, 2);
      const expectedOldB64 = gdBase64UrlEncode('hello from old db');
      const expectedHiB64 = gdBase64UrlEncode('hi');
      assert.ok(
        entries21[0].includes(`2~${expectedOldB64}~`) && entries21[0].includes(':1~Player~7~1~'),
        `GD 2.1 must encode legacy plaintext row to Base64url with inline userPart: "${entries21[0]}"`
      );
      assert.ok(
        entries21[1].includes(`2~${expectedHiB64}~`) && entries21[1].includes(':1~Player~7~1~'),
        `GD 2.1 must return "hi" as Base64url with inline userPart: "${entries21[1]}"`
      );
      assert.equal(p21[1], '2:0:2');

      return `1.8="${get18.text}" | 2.1 B64="${expectedOldB64}"`;
    } finally {
      await srv.stop();
    }
  });

  // 1B. GD 1.9 comments
  await runCase('GD 1.9: uploadGJComment19.php + getGJComments19.php plaintext 3-part format', async () => {
    const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, 'comments-19', '1.9');
    try {
      const levelID = await seedLegacyLevel(srv.baseUrl, {
        udid: 'GD19-UDID-USER',
        userName: 'Retro19',
        levelName: 'Level19',
        gameVersion: 19,
      });

      const up19 = await postForm(`${srv.baseUrl}/db/uploadGJComment19.php`, {
        levelID,
        comment: 'classic 1.9 text',
        udid: 'GD19-UDID-USER',
        userName: 'Retro19',
      });
      assert.equal(up19.text.trim(), '1');

      const get19 = await postForm(`${srv.baseUrl}/db/getGJComments19.php`, {
        levelID,
        page: 0,
      });
      const parts = get19.text.split('#');
      assert.equal(parts.length, 3, `Expected 3 '#' parts for 1.9, got: "${get19.text}"`);
      assert.ok(parts[0].startsWith('2~classic 1.9 text~3~1~'));
      assert.ok(!parts[0].includes(':'), 'GD 1.9 must not have inline :userPart');
      assert.equal(parts[1], '1:Retro19:0');
      assert.equal(parts[2], '1:0:1');
    } finally {
      await srv.stop();
    }
  });

  // 1C. GD 2.0 comments (Base64 + #users#...)
  await runCase('GD 2.0: uploadGJComment20.php (Base64) + getGJComments20.php (Base64 with #users#)', async () => {
    const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, 'comments-20', '2.0');
    try {
      const acct = await registerAndLogin(srv.baseUrl, 'User20');
      const levelID = await seedAccountLevel(srv.baseUrl, acct, {
        levelName: 'Level20',
        gameVersion: 20,
        binaryVersion: 20,
        endpoint: '/db/uploadGJLevel20.php',
      });

      const b64 = gdBase64UrlEncode('hello gd 2.0!');
      const up20 = await postForm(`${srv.baseUrl}/db/uploadGJComment20.php`, {
        accountID: acct.accountID,
        gjp2: acct.gjp2,
        userName: acct.userName,
        levelID,
        comment: b64,
      });
      assert.equal(up20.text.trim(), '1');

      const get20 = await postForm(`${srv.baseUrl}/db/getGJComments20.php`, {
        levelID,
        page: 0,
      });
      const parts = get20.text.split('#');
      assert.equal(parts.length, 3, `GD 2.0 must return 3 '#' sections (<entries>#<users>#<page>), got: "${get20.text}"`);
      assert.ok(parts[0].startsWith(`2~${b64}~3~${acct.userID}~`), `GD 2.0 comment must be Base64: "${parts[0]}"`);
      assert.ok(!parts[0].includes(':'), 'GD 2.0 must NOT have inline :userPart');
      assert.equal(parts[1], `${acct.userID}:User20:${acct.accountID}`, 'GD 2.0 #users# section mismatch');
      assert.equal(parts[2], '1:0:1');
    } finally {
      await srv.stop();
    }
  });

  // 1D. GD 2.1 / 2.2 comments, User Comment History, and GD 2.2 List Comments
  await runCase('GD 2.1/2.2: modern inline :userPart format, User Comment History (1~levelID~), & List Comments (levelID=-1)', async () => {
    const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, 'comments-22', '2.2');
    try {
      const acct = await registerAndLogin(srv.baseUrl, 'ModernPlayer');
      const levelID = await seedAccountLevel(srv.baseUrl, acct, {
        levelName: 'ModernLevel22',
        gameVersion: 22,
        binaryVersion: 42,
      });

      const commentB64 = gdBase64UrlEncode('modern 2.1/2.2 comment!');
      const up21 = await postForm(`${srv.baseUrl}/db/uploadGJComment21.php`, {
        accountID: acct.accountID,
        gjp2: acct.gjp2,
        userName: acct.userName,
        levelID,
        comment: commentB64,
        percent: 93,
      });
      assert.equal(up21.text.trim(), '1');

      // Fetch with binaryVersion=35
      const get21 = await postForm(`${srv.baseUrl}/db/getGJComments21.php`, {
        levelID,
        page: 0,
        gameVersion: 21,
        binaryVersion: 35,
      });
      const parts21 = get21.text.split('#');
      assert.equal(parts21.length, 2, `Modern 2.1/2.2 must have 2 '#' segments (NO #users#), got: "${get21.text}"`);
      const [commentPart, userPart] = parts21[0].split(':');
      assert.ok(userPart, `Modern 2.1/2.2 must include inline :userPart: "${parts21[0]}"`);
      assert.ok(!commentPart.startsWith('1~'), 'Level comments must NOT include 1~levelID~');
      assert.ok(commentPart.includes(`2~${commentB64}~`), 'Comment text must be Base64url');
      assert.ok(commentPart.includes('~10~93~'), 'Modern comment must include percent field 10~93');
      const userKv = parseGdKeyValueRecord(userPart, '~');
      assert.equal(userKv.get('1'), 'ModernPlayer');
      assert.equal(userKv.get('7'), '1');
      assert.equal(userKv.get('9'), '1');
      assert.equal(userKv.get('16'), String(acct.accountID));
      assert.equal(parts21[1], '1:0:1');

      // User Comment History (userID=1, NO levelID) -> MUST include 1~<levelID>~
      const histRes = await postForm(`${srv.baseUrl}/db/getGJComments21.php`, {
        userID: acct.userID,
        page: 0,
        gameVersion: 22,
        binaryVersion: 42,
      });
      const histParts = histRes.text.split('#');
      assert.equal(histParts.length, 2, `Comment history must have 2 '#' segments: "${histRes.text}"`);
      assert.ok(
        histParts[0].startsWith(`1~${levelID}~2~${commentB64}~`),
        `User Comment History MUST include 1~${levelID}~ prefix: "${histParts[0]}"`
      );
      assert.equal(histParts[1], '1:0:1');

      // GD 2.2 List Comments (levelID=-1 on existing level_lists row)
      execPhpSqlite(
        phpRuntime,
        srv.dbPath,
        'INSERT INTO level_lists (listID, listName, listDesc, accountID, userName, listLevels, uploadDate, updateDate) VALUES (1, ?, ?, ?, ?, ?, ?, ?)',
        ['Featured List', '', acct.accountID, acct.userName, String(levelID), Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000)]
      );

      const badListUp = await postForm(`${srv.baseUrl}/db/uploadGJComment21.php`, {
        accountID: acct.accountID,
        gjp2: acct.gjp2,
        userName: acct.userName,
        levelID: -999,
        comment: gdBase64UrlEncode('missing list'),
      });
      assert.equal(badListUp.text.trim(), '-1', 'Uploading comment to non-existent list must return -1');

      const listCommentB64 = gdBase64UrlEncode('great 2.2 level list!');
      const listUp = await postForm(`${srv.baseUrl}/db/uploadGJComment21.php`, {
        accountID: acct.accountID,
        gjp2: acct.gjp2,
        userName: acct.userName,
        levelID: -1,
        comment: listCommentB64,
      });
      assert.equal(listUp.text.trim(), '1', `Uploading list comment (levelID=-1) failed: "${listUp.text}"`);

      const listGet = await postForm(`${srv.baseUrl}/db/getGJComments21.php`, {
        levelID: -1,
        page: 0,
        gameVersion: 22,
        binaryVersion: 42,
      });
      const listParts = listGet.text.split('#');
      assert.equal(listParts.length, 2, `List comments must return 2 '#' segments: "${listGet.text}"`);
      assert.ok(
        listParts[0].includes(`2~${listCommentB64}~`) && listParts[0].includes(':1~ModernPlayer~7~1~'),
        `List comments response mismatch: "${listGet.text}"`
      );
      assert.equal(listParts[1], '1:0:1');
    } finally {
      await srv.stop();
    }
  });
}

// ===========================================================================
// SUITE 2: Strict Version-Gating Matrix (1.5, 1.6, 1.8, 2.0, 2.1, 2.11, 2.2)
// ===========================================================================

async function runSuite2VersionGating(phpRuntime, suiteTempRoot) {
  console.log('\n======================================================================');
  console.log('SUITE 2: Strict Version-Gating Matrix (1.5, 1.6, 1.8, 2.0, 2.1, 2.11, 2.2)');
  console.log('======================================================================');

  // GD 1.5: Map Packs BLOCKED, Gauntlets BLOCKED
  await runCase('GD 1.5: Map Packs blocked (400 / -1) & Gauntlets blocked (400 / -1)', async () => {
    const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, 'gate-15', '1.5');
    try {
      for (let i = 1; i <= 5; i++) {
        await seedLegacyLevel(srv.baseUrl, { levelName: `L15_${i}`, gameVersion: 6 });
      }

      const mpSave = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveMapPack', {
        name: 'Blocked Pack',
        levels: [1, 2, 3],
        stars: 3,
        coins: 1,
        difficulty: 2,
        rgbcolors: '100,200,255',
        colors2: 'none',
      });
      assert.equal(mpSave.status, 400, `GD 1.5 saveMapPack must return 400, got ${mpSave.status}`);

      const mpGet = await postForm(`${srv.baseUrl}/db/getGJMapPacks.php`, { page: 0 });
      assert.equal(mpGet.text.trim(), '-1', `GD 1.5 getGJMapPacks.php must return -1, got "${mpGet.text}"`);

      const gSave = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
        ID: 1,
        level1: 1,
        level2: 2,
        level3: 3,
        level4: 4,
        level5: 5,
      });
      assert.equal(gSave.status, 400, `GD 1.5 saveGauntlet must return 400, got ${gSave.status}`);

      const gGet = await postForm(`${srv.baseUrl}/db/getGJGauntlets21.php`, {});
      assert.equal(gGet.text.trim(), '-1', `GD 1.5 getGJGauntlets21.php must return -1, got "${gGet.text}"`);
    } finally {
      await srv.stop();
    }
  });

  // GD 1.6, 1.8, 2.0: Map Packs ALLOWED (exact non-ascending order 3,1,2, colors2 fallback, Solo4 hash), Gauntlets REJECTED
  for (const ver of ['1.6', '1.8', '2.0']) {
    await runCase(`GD ${ver}: Map Packs allowed (colors2 fallback, Solo4 hash, exact order 3,1,2) & Gauntlets rejected`, async () => {
      const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, `gate-${ver}`, ver);
      try {
        const gvInt = ver === '1.6' ? 7 : ver === '1.8' ? 18 : 20;
        for (let i = 1; i <= 5; i++) {
          await seedLegacyLevel(srv.baseUrl, { levelName: `L${ver}_${i}`, gameVersion: gvInt });
        }

        // Save Map Pack with non-ascending order [3, 1, 2] and colors2='none'
        const mpSave = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveMapPack', {
          name: `Retro Pack ${ver}`,
          levels: [3, 1, 2],
          stars: 5,
          coins: 1,
          difficulty: 3,
          rgbcolors: '255,140,0',
          colors2: 'none',
        });
        assert.equal(mpSave.status, 200, `GD ${ver} saveMapPack must succeed: ${mpSave.text}`);
        assert.equal(mpSave.json.ok, true);
        const packID = mpSave.json.ID;
        assert.equal(packID, 1);

        // Overview includes mapPacks
        const ov = await adminCall(srv.baseUrl, srv.adminToken, 'GET', 'overview');
        assert.equal(ov.status, 200);
        assert.equal(ov.json.stats.mapPacksCount, 1);
        assert.equal(ov.json.mapPacks.length, 1);
        assert.deepEqual(ov.json.mapPacks[0].levels, [3, 1, 2]);

        // getGJMapPacks.php returns pack + colors2 fallback + valid Solo4 hash
        const mpGet = await postForm(`${srv.baseUrl}/db/getGJMapPacks.php`, { page: 0 });
        const mpParts = mpGet.text.split('#');
        assert.equal(mpParts.length, 3, `getGJMapPacks.php must have 3 '#' parts: "${mpGet.text}"`);
        const mpKv = parseGdKeyValueRecord(mpParts[0], ':');
        assert.equal(mpKv.get('1'), '1');
        assert.equal(mpKv.get('2'), `Retro Pack ${ver}`);
        assert.equal(mpKv.get('3'), '3,1,2');
        assert.equal(mpKv.get('4'), '5');
        assert.equal(mpKv.get('5'), '1');
        assert.equal(mpKv.get('6'), '3');
        assert.equal(mpKv.get('7'), '255,140,0');
        assert.equal(mpKv.get('8'), '255,140,0', 'colors2="none" must fall back to rgbcolors in field 8');
        assert.equal(mpParts[1], '1:0:10');
        const expectedSolo4 = generateSolo4Hash([{ ID: 1, stars: 5, coins: 1 }]);
        assert.equal(mpParts[2], expectedSolo4, 'getGJMapPacks Solo4 SHA1 hash mismatch');

        // getGJLevels*.php type=10 returns exact non-ascending order [3, 1, 2]
        const searchEndpoint = ver === '2.0' ? '/db/getGJLevels20.php' : '/db/getGJLevels.php';
        const lvlRes = await postForm(`${srv.baseUrl}${searchEndpoint}`, {
          type: 10,
          str: '3,1,2',
          page: 0,
        });
        const lvlSegs = lvlRes.text.split('#');
        const returnedIds = lvlSegs[0]
          .split('|')
          .map((rec) => Number(parseGdKeyValueRecord(rec, ':').get('1')));
        assert.deepEqual(
          returnedIds,
          [3, 1, 2],
          `GD ${ver} ${searchEndpoint} type=10 must preserve exact order [3,1,2], got ${JSON.stringify(returnedIds)}`
        );

        // Gauntlets REJECTED
        const gSave = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
          ID: 1,
          level1: 1,
          level2: 2,
          level3: 3,
          level4: 4,
          level5: 5,
        });
        assert.equal(gSave.status, 400, `GD ${ver} saveGauntlet must return 400, got ${gSave.status}`);

        const gGet = await postForm(`${srv.baseUrl}/db/getGJGauntlets21.php`, {});
        assert.equal(gGet.text.trim(), '-1', `GD ${ver} getGJGauntlets21.php must return -1`);

        const gLevels = await postForm(`${srv.baseUrl}/db/getGJLevels21.php`, { gauntlet: 1 });
        assert.equal(gLevels.text.trim(), '-1', `GD ${ver} getGJLevels21.php gauntlet=1 must return -1`);
      } finally {
        await srv.stop();
      }
    });
  }

  // GD 2.1 & 2.11: Map Packs ALLOWED, Gauntlets 1..15 ALLOWED, ID 16 REJECTED
  for (const ver of ['2.1', '2.11']) {
    await runCase(`GD ${ver}: Map Packs allowed, Gauntlets 1..15 allowed (Fire #1, Death #15), ID 16 rejected (400)`, async () => {
      const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, `gate-${ver}`, ver);
      try {
        const acct = await registerAndLogin(srv.baseUrl, 'User21');
        for (let i = 1; i <= 5; i++) {
          await seedAccountLevel(srv.baseUrl, acct, { levelName: `L${ver}_${i}`, gameVersion: 21, binaryVersion: 35 });
        }

        const mpSave = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveMapPack', {
          name: `Pack ${ver}`,
          levels: [1, 2, 3],
          stars: 4,
          coins: 1,
          difficulty: 2,
          rgbcolors: '50,180,255',
          colors2: 'none',
        });
        assert.equal(mpSave.status, 200);

        const g1 = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
          ID: 1,
          level1: 1,
          level2: 2,
          level3: 3,
          level4: 4,
          level5: 5,
        });
        assert.equal(g1.status, 200, `GD ${ver} Gauntlet #1 must succeed`);

        const g15 = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
          ID: 15,
          level1: 5,
          level2: 4,
          level3: 3,
          level4: 2,
          level5: 1,
        });
        assert.equal(g15.status, 200, `GD ${ver} Gauntlet #15 must succeed`);

        const g16 = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
          ID: 16,
          level1: 1,
          level2: 2,
          level3: 3,
          level4: 4,
          level5: 5,
        });
        assert.equal(g16.status, 400, `GD ${ver} Gauntlet #16 MUST return 400, got ${g16.status}`);

        const g0 = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
          ID: 0,
          level1: 1,
          level2: 2,
          level3: 3,
          level4: 4,
          level5: 5,
        });
        assert.equal(g0.status, 400, `GD ${ver} Gauntlet #0 MUST return 400`);

        const ov = await adminCall(srv.baseUrl, srv.adminToken, 'GET', 'overview');
        assert.equal(ov.json.stats.gauntletsCount, 2);
        assert.equal(ov.json.gauntlets[0].name, 'Fire Gauntlet');
        assert.equal(ov.json.gauntlets[1].name, 'Death Gauntlet');
      } finally {
        await srv.stop();
      }
    });
  }

  // GD 2.2: Map Packs ALLOWED, Gauntlets 1..60 ALLOWED (1, 16, 47, 60), 0 & 61 REJECTED
  await runCase('GD 2.2: Map Packs allowed, Gauntlets 1..60 allowed (#1, #16, #47, #60), #0 & #61 rejected (400)', async () => {
    const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, 'gate-22', '2.2');
    try {
      const acct = await registerAndLogin(srv.baseUrl, 'User22');
      for (let i = 1; i <= 5; i++) {
        await seedAccountLevel(srv.baseUrl, acct, { levelName: `L22_${i}`, gameVersion: 22, binaryVersion: 42 });
      }

      const mpSave = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveMapPack', {
        name: 'Pack 2.2',
        levels: [1, 2, 3],
        stars: 8,
        coins: 2,
        difficulty: 5,
        rgbcolors: '120,60,255',
        colors2: '255,255,255',
      });
      assert.equal(mpSave.status, 200);

      for (const gid of [1, 16, 47, 60]) {
        const res = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
          ID: gid,
          level1: 1,
          level2: 2,
          level3: 3,
          level4: 4,
          level5: 5,
        });
        assert.equal(res.status, 200, `GD 2.2 Gauntlet #${gid} must return 200, got ${res.status}: ${res.text}`);
      }

      for (const badId of [0, 61]) {
        const res = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
          ID: badId,
          level1: 1,
          level2: 2,
          level3: 3,
          level4: 4,
          level5: 5,
        });
        assert.equal(res.status, 400, `GD 2.2 Gauntlet #${badId} MUST return 400, got ${res.status}`);
      }

      const ov = await adminCall(srv.baseUrl, srv.adminToken, 'GET', 'overview');
      const byId = new Map(ov.json.gauntlets.map((g) => [g.ID, g.name]));
      assert.equal(byId.get(1), 'Fire Gauntlet');
      assert.equal(byId.get(16), 'Forest Gauntlet');
      assert.equal(byId.get(47), 'Galaxy Gauntlet');
      assert.equal(byId.get(60), 'Love Gauntlet');
    } finally {
      await srv.stop();
    }
  });
}

// ===========================================================================
// SUITE 3: Exhaustive Gauntlet & Map Pack Edge Cases
// ===========================================================================

async function runSuite3EdgeCases(phpRuntime, suiteTempRoot) {
  console.log('\n======================================================================');
  console.log('SUITE 3: Exhaustive Gauntlet & Map Pack Edge Cases');
  console.log('======================================================================');

  const srv = await startIsolatedPhpServer(phpRuntime, suiteTempRoot, 'edge-22', '2.2');
  try {
    const acct = await registerAndLogin(srv.baseUrl, 'EdgeMaster');
    // Seed 6 levels: level 4 is unlisted=1, level 6 will be marked isDeleted=1
    for (let i = 1; i <= 6; i++) {
      await seedAccountLevel(srv.baseUrl, acct, {
        levelName: `EdgeLvl_${i}`,
        gameVersion: 22,
        binaryVersion: 42,
        unlisted: i === 4 ? 1 : 0,
      });
    }
    execPhpSqlite(phpRuntime, srv.dbPath, 'UPDATE levels SET isDeleted = 1 WHERE levelID = 6');

    // 3A. Gauntlet validation edge cases
    await runCase('Gauntlet validation: rejects <5 levels, duplicates, missing IDs, and deleted IDs', async () => {
      const tooFew = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
        ID: 1,
        level1: 1,
        level2: 2,
        level3: 3,
        level4: 4,
      });
      assert.equal(tooFew.status, 400, 'Missing level5 must return 400');

      const dup = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
        ID: 1,
        level1: 1,
        level2: 2,
        level3: 3,
        level4: 4,
        level5: 1,
      });
      assert.equal(dup.status, 400, 'Duplicate level IDs must return 400');

      const missing = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
        ID: 1,
        level1: 1,
        level2: 2,
        level3: 3,
        level4: 4,
        level5: 9999,
      });
      assert.equal(missing.status, 400, 'Non-existent level 9999 must return 400');

      const deleted = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
        ID: 1,
        level1: 1,
        level2: 2,
        level3: 3,
        level4: 4,
        level5: 6,
      });
      assert.equal(deleted.status, 400, 'Soft-deleted level 6 must return 400');
    });

    // 3B. Upsert same Gauntlet slot ID + getGJGauntlets21.php (normal & special=1)
    await runCase('Gauntlet upsert (slot #1) & getGJGauntlets21.php (normal & special=1) Solo3 SHA1 hash', async () => {
      const first = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
        ID: 1,
        level1: 1,
        level2: 2,
        level3: 3,
        level4: 4,
        level5: 5,
      });
      assert.equal(first.status, 200);

      // Upsert same slot #1 with non-ascending order [5, 2, 4, 1, 3]
      const second = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveGauntlet', {
        ID: 1,
        level1: 5,
        level2: 2,
        level3: 4,
        level4: 1,
        level5: 3,
      });
      assert.equal(second.status, 200);

      const ov = await adminCall(srv.baseUrl, srv.adminToken, 'GET', 'overview');
      assert.equal(ov.json.gauntlets.length, 1, 'Upsert must not create duplicate gauntlet rows');
      assert.deepEqual(ov.json.gauntlets[0].levels, [5, 2, 4, 1, 3]);

      const expectedBody = `1:1:3:5,2,4,1,3#${generateSolo3Hash('15,2,4,1,3')}`;
      const gNormal = await postForm(`${srv.baseUrl}/db/getGJGauntlets21.php`, {});
      assert.equal(gNormal.text, expectedBody, `Normal getGJGauntlets21 mismatch: "${gNormal.text}"`);

      const gSpecial = await postForm(`${srv.baseUrl}/db/getGJGauntlets21.php`, { special: 1 });
      assert.equal(gSpecial.text, expectedBody, `special=1 getGJGauntlets21 mismatch: "${gSpecial.text}"`);
    });

    // 3C. getGJLevels21.php?gauntlet=1 with unlisted=1 level -> exact order [5,2,4,1,3], field 44:1, Solo2 hash
    await runCase('getGJLevels21.php (gauntlet=1): exact order [5,2,4,1,3], includes unlisted level 4, field 44:1, Solo2 hash', async () => {
      // Confirm level 4 is truly hidden from normal recent search (type=4)
      const recentRes = await postForm(`${srv.baseUrl}/db/getGJLevels21.php`, { type: 4, page: 0 });
      const recentIds = recentRes.text
        .split('#')[0]
        .split('|')
        .map((rec) => Number(parseGdKeyValueRecord(rec, ':').get('1')));
      assert.ok(!recentIds.includes(4), 'Unlisted level 4 must be hidden from normal recent search');

      // Now query gauntlet=1
      const gLvlRes = await postForm(`${srv.baseUrl}/db/getGJLevels21.php`, {
        gauntlet: 1,
        gameVersion: 22,
      });
      const segs = gLvlRes.text.split('#');
      assert.equal(segs.length, 5, `getGJLevels21.php must have 5 '#' segments: "${gLvlRes.text}"`);

      const records = segs[0].split('|').map((rec) => parseGdKeyValueRecord(rec, ':'));
      const returnedIds = records.map((kv) => Number(kv.get('1')));
      assert.deepEqual(
        returnedIds,
        [5, 2, 4, 1, 3],
        `Gauntlet levels must be returned in EXACT order [5,2,4,1,3], got ${JSON.stringify(returnedIds)}`
      );

      for (const kv of records) {
        assert.equal(
          kv.get('44'),
          '1',
          `Level ${kv.get('1')} in gauntlet=1 must have field 44:1, got 44:${kv.get('44')}`
        );
      }

      const expectedSolo2 = generateSolo2HashFromLevels(
        returnedIds.map((levelID) => ({ levelID, starStars: 0, starCoins: 0 }))
      );
      assert.equal(segs[4], expectedSolo2, 'Gauntlet getGJLevels21 Solo2 hash mismatch');
    });

    // 3D. Map Pack edge cases (validation, create, edit, delete)
    await runCase('Map Pack edge cases: rejects <3 levels, duplicates, bad RGB, bad stars/coins; edit & delete work cleanly', async () => {
      const badCases = [
        { label: '<3 levels', payload: { name: 'Bad1', levels: [1, 2], stars: 3, coins: 1, difficulty: 2, rgbcolors: '1,2,3', colors2: 'none' } },
        { label: 'duplicate levels', payload: { name: 'Bad2', levels: [1, 2, 1], stars: 3, coins: 1, difficulty: 2, rgbcolors: '1,2,3', colors2: 'none' } },
        { label: 'invalid RGB 999,0,0', payload: { name: 'Bad3', levels: [1, 2, 3], stars: 3, coins: 1, difficulty: 2, rgbcolors: '999,0,0', colors2: 'none' } },
        { label: 'stars=0', payload: { name: 'Bad4', levels: [1, 2, 3], stars: 0, coins: 1, difficulty: 2, rgbcolors: '1,2,3', colors2: 'none' } },
        { label: 'stars=11', payload: { name: 'Bad5', levels: [1, 2, 3], stars: 11, coins: 1, difficulty: 2, rgbcolors: '1,2,3', colors2: 'none' } },
        { label: 'coins=0', payload: { name: 'Bad6', levels: [1, 2, 3], stars: 5, coins: 0, difficulty: 2, rgbcolors: '1,2,3', colors2: 'none' } },
        { label: 'coins=3', payload: { name: 'Bad7', levels: [1, 2, 3], stars: 5, coins: 3, difficulty: 2, rgbcolors: '1,2,3', colors2: 'none' } },
        { label: 'deleted level 6', payload: { name: 'Bad8', levels: [1, 2, 6], stars: 5, coins: 1, difficulty: 2, rgbcolors: '1,2,3', colors2: 'none' } },
      ];

      for (const tc of badCases) {
        const res = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveMapPack', tc.payload);
        assert.equal(res.status, 400, `Map Pack (${tc.label}) must return 400, got ${res.status}: ${res.text}`);
      }

      // Create valid Map Pack
      const created = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveMapPack', {
        name: 'Guard Pack',
        levels: [3, 1, 2],
        stars: 4,
        coins: 1,
        difficulty: 2,
        rgbcolors: '10,20,30',
        colors2: 'none',
      });
      assert.equal(created.status, 200);
      const packID = created.json.ID;
      assert.ok(packID > 0);

      // Edit existing Map Pack (same ID)
      const edited = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'saveMapPack', {
        ID: packID,
        name: 'Guard Pack Renamed',
        levels: [2, 3, 1],
        stars: 7,
        coins: 2,
        difficulty: 4,
        rgbcolors: '40,50,60',
        colors2: '200,210,220',
      });
      assert.equal(edited.status, 200);
      assert.equal(edited.json.ID, packID);

      const ov = await adminCall(srv.baseUrl, srv.adminToken, 'GET', 'overview');
      assert.equal(ov.json.mapPacks.length, 1, 'Editing pack must not duplicate rows');
      assert.equal(ov.json.mapPacks[0].name, 'Guard Pack Renamed');
      assert.deepEqual(ov.json.mapPacks[0].levels, [2, 3, 1]);
      assert.equal(ov.json.mapPacks[0].colors2, '200,210,220');

      const mpGet = await postForm(`${srv.baseUrl}/db/getGJMapPacks21.php`, { page: 0 });
      const mpKv = parseGdKeyValueRecord(mpGet.text.split('#')[0], ':');
      assert.equal(mpKv.get('2'), 'Guard Pack Renamed');
      assert.equal(mpKv.get('7'), '40,50,60');
      assert.equal(mpKv.get('8'), '200,210,220');
    });

    // 3E. Delete Integrity Guard (HTTP 409 when referenced by Gauntlet or Map Pack; HTTP 200 after removing references)
    await runCase('Delete Integrity Guard: HTTP 409 naming Gauntlet & Map Pack; HTTP 200 after deleteGauntlet/deleteMapPack', async () => {
      // Level 1 is inside BOTH Fire Gauntlet (#1) AND Guard Pack Renamed (#1)
      const delBoth = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'deleteLevel', { levelID: 1 });
      assert.equal(delBoth.status, 409, `Deleting level in Gauntlet+MapPack must return 409, got ${delBoth.status}`);
      assert.ok(
        delBoth.json.error.includes('Fire Gauntlet') && delBoth.json.error.includes('Guard Pack Renamed'),
        `409 error must name both Gauntlet and Map Pack, got: "${delBoth.json.error}"`
      );

      // Level 5 is inside Fire Gauntlet (#1) only
      const delGOnly = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'deleteLevel', { levelID: 5 });
      assert.equal(delGOnly.status, 409, `Deleting level in Gauntlet must return 409, got ${delGOnly.status}`);
      assert.ok(delGOnly.json.error.includes('Fire Gauntlet'));

      // Remove Fire Gauntlet #1
      const rmG = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'deleteGauntlet', { gauntletID: 1 });
      assert.equal(rmG.status, 200);

      // Level 5 is now unreferenced -> deleteLevel MUST succeed (200)
      const del5Ok = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'deleteLevel', { levelID: 5 });
      assert.equal(del5Ok.status, 200, `Unreferenced level 5 must delete with 200, got ${del5Ok.status}: ${del5Ok.text}`);

      // Level 1 is STILL referenced by Guard Pack Renamed -> MUST still fail with 409 naming Map Pack
      const delMpOnly = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'deleteLevel', { levelID: 1 });
      assert.equal(delMpOnly.status, 409, `Deleting level still in Map Pack must return 409, got ${delMpOnly.status}`);
      assert.ok(delMpOnly.json.error.includes('Guard Pack Renamed'));

      // Delete Map Pack #1
      const rmMp = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'deleteMapPack', { packID: 1 });
      assert.equal(rmMp.status, 200);

      // Level 1 is now unreferenced -> deleteLevel MUST succeed (200)
      const del1Ok = await adminCall(srv.baseUrl, srv.adminToken, 'POST', 'deleteLevel', { levelID: 1 });
      assert.equal(del1Ok.status, 200, `Unreferenced level 1 must delete with 200, got ${del1Ok.status}: ${del1Ok.text}`);

      // Verify empty Map Packs & Gauntlets endpoints after deletion
      const emptyMp = await postForm(`${srv.baseUrl}/db/getGJMapPacks21.php`, { page: 0 });
      assert.equal(emptyMp.text, `#0:0:10#${generateSolo4Hash([])}`);
      const emptyG = await postForm(`${srv.baseUrl}/db/getGJGauntlets21.php`, {});
      assert.equal(emptyG.text, `#${generateSolo3Hash('')}`);
    });
  } finally {
    await srv.stop();
  }
}

// ===========================================================================
// SUITE 4: Isolated 5-Network-Mode Suite (Localhost, LAN, VPN, VPS, Cloudflare)
// ===========================================================================

function loadIsolatedElectronModules(suiteTempRoot) {
  const compiledOutDir = path.join(suiteTempRoot, 'compiled-electron');
  const mockUserDataDir = path.join(suiteTempRoot, 'mock-userData');
  fs.mkdirSync(mockUserDataDir, { recursive: true });

  const tscBin = path.join(PROJECT_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  assert.ok(fs.existsSync(tscBin), 'TypeScript compiler not found in node_modules/typescript/bin/tsc');

  execFileSync(process.execPath, [tscBin, '-p', path.join(PROJECT_ROOT, 'tsconfig.node.json'), '--outDir', compiledOutDir], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });

  const admZipResolved = require.resolve('adm-zip', { paths: [PROJECT_ROOT] });
  const AdmZip = require(admZipResolved);

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
          getPath: (name) => (name === 'userData' ? mockUserDataDir : suiteTempRoot),
        },
      };
    }
    if (request === 'adm-zip') {
      return AdmZip;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const prevCwd = process.cwd();
  process.chdir(PROJECT_ROOT);
  try {
    const serverManager = require(path.join(compiledOutDir, 'main', 'serverManager.js'));
    const clientBuilder = require(path.join(compiledOutDir, 'main', 'clientBuilder.js'));
    return {
      serverManager,
      clientBuilder,
      AdmZip,
      mockUserDataDir,
      restore: () => {
        Module._load = originalLoad;
        try {
          process.chdir(prevCwd);
        } catch {
          // ignore
        }
      },
    };
  } catch (err) {
    Module._load = originalLoad;
    try {
      process.chdir(prevCwd);
    } catch {
      // ignore
    }
    throw err;
  }
}

async function fetchWithRetry(url, init = {}, maxWaitMs = 20000) {
  const deadline = Date.now() + maxWaitMs;
  let lastError = null;
  let lastRes = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(8000),
      });
      // Cloudflare quick tunnels briefly return 530 / 502 while edge routing warms up
      if (res.status === 530 || res.status === 502 || res.status === 503) {
        lastRes = res;
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (lastRes) return lastRes;
  throw lastError || new Error(`Timed out fetching ${url}`);
}

async function runSuite4NetworkModes(suiteTempRoot, opts) {
  console.log('\n======================================================================');
  console.log('SUITE 4: Isolated 5-Network-Mode Suite (Localhost, LAN, VPN, VPS, Cloudflare)');
  console.log('======================================================================');

  const env = loadIsolatedElectronModules(suiteTempRoot);
  const { serverManager, clientBuilder, AdmZip, mockUserDataDir } = env;

  try {
    // -----------------------------------------------------------------------
    // Mode 1: Localhost (127.0.0.1)
    // -----------------------------------------------------------------------
    await runCase('Mode 1 (Localhost): token-enforced admin_api (403/200), GD endpoints, 33B/44B patcher', async () => {
      const { server } = await serverManager.createServerInstance({
        name: 'Iso Localhost',
        version: '2.2',
        networkMode: 'localhost',
        buildWindows: false,
        buildAndroid: false,
      });
      try {
        assert.ok(server.adminToken && server.adminToken.length >= 16, 'adminToken must be generated');
        const live = await serverManager.startServer(server.id);
        assert.equal(live.status, 'running');
        assert.equal(live.publicUrl, `http://127.0.0.1:${server.port}`);

        // Admin API without token -> 403
        const noToken = await adminCall(live.localUrl, null, 'GET', 'overview');
        assert.equal(noToken.status, 403, `Expected 403 without token, got ${noToken.status}`);

        // Admin API with wrong token -> 403
        const wrongToken = await adminCall(live.localUrl, 'wrong-token-value', 'GET', 'overview');
        assert.equal(wrongToken.status, 403, `Expected 403 with wrong token, got ${wrongToken.status}`);

        // Admin API with valid token -> 200
        const valid = await adminCall(live.localUrl, server.adminToken, 'GET', 'overview');
        assert.equal(valid.status, 200, `Expected 200 with valid token, got ${valid.status}`);

        // GD endpoint on 127.0.0.1
        const gdRes = await postForm(`${live.localUrl}/db/getGJLevels21.php`, { type: 4, page: 0 });
        assert.equal(gdRes.status, 200);
        assert.ok(gdRes.text.startsWith('###0:0:10#'));

        // Binary patcher exact 33B ASCII & 44B Base64
        const localDbUrl = `http://127.0.0.1:${server.port}/db`;
        const ascii33 = clientBuilder.formatPatchedUrl(localDbUrl, false);
        const b64_44 = clientBuilder.formatPatchedUrl(localDbUrl, true);
        assert.equal(Buffer.byteLength(ascii33, 'utf8'), 33);
        assert.equal(Buffer.byteLength(b64_44, 'utf8'), 44);
        assert.equal(Buffer.from(b64_44, 'base64').toString('utf8'), ascii33);

        return `port=${server.port}, patched="${ascii33}"`;
      } finally {
        await serverManager.stopServer(server.id);
      }
    });

    // -----------------------------------------------------------------------
    // Mode 2: LAN (Real detected LAN IP + Real GD 1.811 APK if present)
    // -----------------------------------------------------------------------
    await runCase('Mode 2 (LAN): real LAN IP, all APK .so ABIs patched (if 1.811 APK present), LAN GD 200 & LAN admin 403', async () => {
      const ifaces = serverManager.getNetworkInterfaces();
      const lanIface = ifaces.find((i) => i.kind === 'lan');
      assert.ok(lanIface, `Expected at least one LAN network interface, found: ${JSON.stringify(ifaces)}`);
      const lanIp = lanIface.address;

      const sample18Apk = path.resolve(PROJECT_ROOT, '..', 'Geometry.Dash.ver.1.811.build.21.apk');
      const hasRealApk = fs.existsSync(sample18Apk);

      const { server } = await serverManager.createServerInstance({
        name: 'Iso LAN 1.8',
        version: '1.8',
        networkMode: 'lan',
        lanHost: lanIp,
        buildWindows: false,
        buildAndroid: hasRealApk,
        customAndroidBasePath: hasRealApk ? sample18Apk : undefined,
      });

      try {
        const expectedPatchedAscii = clientBuilder.formatPatchedUrl(`http://${lanIp}:${server.port}/db`, false);
        assert.equal(Buffer.byteLength(expectedPatchedAscii, 'utf8'), 33);

        let patchedAbis = [];
        if (hasRealApk) {
          assert.ok(
            server.artifacts.androidApkPath && fs.existsSync(server.artifacts.androidApkPath),
            `Android APK build failed; warnings: ${JSON.stringify(server.artifacts.warnings)}`
          );
          assert.ok(
            server.artifacts.androidApkPath.startsWith(mockUserDataDir),
            'Built APK MUST reside inside isolated temp userData!'
          );

          const apkZip = new AdmZip(server.artifacts.androidApkPath);
          const soEntries = apkZip
            .getEntries()
            .filter((e) => !e.isDirectory && e.entryName.startsWith('lib/') && e.entryName.endsWith('.so'));
          assert.ok(soEntries.length > 0, 'Built APK must contain native .so libraries');

          for (const soEntry of soEntries) {
            const abi = soEntry.entryName.split('/')[1];
            const data = soEntry.getData();
            assert.equal(
              soEntry.header.method,
              0,
              `Native lib ${soEntry.entryName} must be stored uncompressed (method=0)`
            );
            assert.equal(
              data.indexOf(ORIGINAL_ASCII_URL),
              -1,
              `${soEntry.entryName} still contains original Boomlings URL!`
            );
            assert.ok(
              data.includes(expectedPatchedAscii),
              `${soEntry.entryName} does not contain patched LAN URL "${expectedPatchedAscii}"`
            );
            patchedAbis.push(abi);
          }

          for (const requiredAbi of ['armeabi', 'armeabi-v7a', 'x86']) {
            assert.ok(
              patchedAbis.includes(requiredAbi),
              `Expected ABI "${requiredAbi}" in patched 1.811 APK, found: ${JSON.stringify(patchedAbis)}`
            );
          }
        }

        const live = await serverManager.startServer(server.id);
        assert.equal(live.status, 'running');
        assert.equal(live.publicUrl, `http://${lanIp}:${server.port}`);

        // Verify HTTP reachability over LAN IP
        const lanPortal = await fetch(`http://${lanIp}:${server.port}/`, {
          signal: AbortSignal.timeout(8000),
        });
        assert.equal(lanPortal.status, 200, `Portal over LAN IP http://${lanIp}:${server.port}/ must return 200`);
        const lanHtml = await lanPortal.text();
        assert.ok(lanHtml.includes('Iso LAN 1.8'));
        if (hasRealApk) {
          assert.ok(lanHtml.includes('MyGDPS-v1.8-Android.apk'), 'Portal must list built 1.8 Android APK');
        }

        const lanGd = await postForm(`http://${lanIp}:${server.port}/db/getGJLevels.php`, {
          type: 4,
          page: 0,
        });
        assert.equal(lanGd.status, 200);
        assert.ok(lanGd.text.startsWith('##0:0:10'));

        // Admin API over LAN IP MUST return 403 EVEN WITH valid admin token!
        const lanAdmin = await adminCall(
          `http://${lanIp}:${server.port}`,
          server.adminToken,
          'GET',
          'overview'
        );
        assert.equal(
          lanAdmin.status,
          403,
          `admin_api.php requested via LAN IP (${lanIp}) MUST return 403, got ${lanAdmin.status}`
        );

        return `lanIp=${lanIp}:${server.port}${hasRealApk ? `, patchedABIs=[${patchedAbis.join(',')}]` : ' (no 1.811 APK)'}`;
      } finally {
        await serverManager.stopServer(server.id);
      }
    });

    // -----------------------------------------------------------------------
    // Mode 3: VPN (Radmin / Hamachi / Tailscale, e.g. 26.10.20.30)
    // -----------------------------------------------------------------------
    await runCase('Mode 3 (VPN): 26.10.20.30 binds 0.0.0.0, publicUrl matches, 33B ASCII & 44B Base64 padding', async () => {
      const vpnIp = '26.10.20.30';
      const { server } = await serverManager.createServerInstance({
        name: 'Iso VPN',
        version: '2.2',
        networkMode: 'vpn',
        lanHost: vpnIp,
        buildWindows: false,
        buildAndroid: false,
      });

      try {
        const live = await serverManager.startServer(server.id);
        assert.equal(live.status, 'running');
        assert.equal(live.publicUrl, `http://${vpnIp}:${server.port}`);
        assert.ok(
          live.logs.some((line) => line.includes(`Starting PHP server on 0.0.0.0:${server.port}`)),
          `VPN mode must bind PHP on 0.0.0.0:${server.port}; logs: ${live.logs.join(' | ')}`
        );

        // Verify binary patcher pads http://26.10.20.30:<port>/db to exact 33B ASCII & 44B Base64
        const vpnDbUrl = `http://${vpnIp}:${server.port}/db`;
        const paddedAscii = clientBuilder.formatPatchedUrl(vpnDbUrl, false);
        const paddedB64 = clientBuilder.formatPatchedUrl(vpnDbUrl, true);
        assert.equal(Buffer.byteLength(paddedAscii, 'utf8'), 33);
        assert.equal(Buffer.byteLength(paddedB64, 'utf8'), 44);
        assert.ok(paddedAscii.startsWith(vpnDbUrl));
        assert.equal(Buffer.from(paddedB64, 'base64').toString('utf8'), paddedAscii);

        // Verify mock binary patching byte-length preservation
        const mockSo = Buffer.concat([
          Buffer.from('\x7fELF\x00MOCK_VPN_'),
          Buffer.from(ORIGINAL_ASCII_URL, 'ascii'),
          Buffer.from('\x00'),
          Buffer.from(ORIGINAL_BASE64_URL, 'ascii'),
          Buffer.from('\x00END'),
        ]);
        const patched = clientBuilder.patchBinaryBuffer(mockSo, vpnDbUrl, true);
        assert.equal(patched.patchedBuffer.length, mockSo.length);
        assert.equal(patched.replacementsCount, 2);
        assert.ok(patched.patchedBuffer.includes(paddedAscii));
        assert.ok(patched.patchedBuffer.includes(paddedB64));

        return `publicUrl=${live.publicUrl}, padded="${paddedAscii}"`;
      } finally {
        await serverManager.stopServer(server.id);
      }
    });

    // -----------------------------------------------------------------------
    // Mode 4: VPS (Public IP, Short HTTPS, Exact 33B, Over-33B Redirector + Reverse Proxy Security)
    // -----------------------------------------------------------------------
    await runCase('Mode 4 (VPS): IP/short/33B/over-33B patching & Reverse Proxy admin 403 vs GD 200', async () => {
      // 4a. Public IP (27B with /db)
      const ipNorm = clientBuilder.normalizeServerUrl('http://203.0.113.10:8080');
      assert.equal(ipNorm, 'http://203.0.113.10:8080/db');
      assert.equal(Buffer.byteLength(ipNorm, 'utf8'), 27);
      assert.equal(clientBuilder.canFitDirectUrl('http://203.0.113.10:8080'), true);
      assert.equal(Buffer.byteLength(clientBuilder.formatPatchedUrl('http://203.0.113.10:8080', false), 'utf8'), 33);
      assert.equal(Buffer.byteLength(clientBuilder.formatPatchedUrl('http://203.0.113.10:8080', true), 'utf8'), 44);

      // 4b. Short HTTPS domain (23B with /db)
      const shortNorm = clientBuilder.normalizeServerUrl('https://gd.myvps.org');
      assert.equal(shortNorm, 'https://gd.myvps.org/db');
      assert.equal(Buffer.byteLength(shortNorm, 'utf8'), 23);
      assert.equal(clientBuilder.canFitDirectUrl('https://gd.myvps.org'), true);
      assert.equal(Buffer.byteLength(clientBuilder.formatPatchedUrl('https://gd.myvps.org', false), 'utf8'), 33);
      assert.equal(Buffer.byteLength(clientBuilder.formatPatchedUrl('https://gd.myvps.org', true), 'utf8'), 44);

      // 4c. Exact 33B domain (without /db)
      const exact33Domain = 'https://my-custom-gdps.example.io';
      assert.equal(Buffer.byteLength(exact33Domain, 'utf8'), 33);
      assert.equal(clientBuilder.normalizeServerUrl(exact33Domain), exact33Domain);
      assert.equal(clientBuilder.canFitDirectUrl(exact33Domain), true);
      assert.equal(clientBuilder.formatPatchedUrl(exact33Domain, false), exact33Domain);
      assert.equal(Buffer.byteLength(clientBuilder.formatPatchedUrl(exact33Domain, true), 'utf8'), 44);

      // 4d. Over-33B domain -> triggers redirector/fallback warning cleanly without corrupting binary size
      const over33Domain = 'https://my-very-long-gdps-domain.example.com';
      assert.equal(clientBuilder.canFitDirectUrl(over33Domain), false);

      const mockExeDir = path.join(suiteTempRoot, 'mock-vps-exe');
      fs.mkdirSync(mockExeDir, { recursive: true });
      const mockExePath = path.join(mockExeDir, 'GeometryDash.exe');
      const mockExeBuf = Buffer.concat([
        Buffer.from('MZ\x90\x00VPS_MOCK_EXE_\x00'),
        Buffer.from(ORIGINAL_ASCII_URL, 'ascii'),
        Buffer.from('\x00'),
        Buffer.from(ORIGINAL_BASE64_URL, 'ascii'),
        Buffer.from('\x00END_EXE'),
      ]);
      fs.writeFileSync(mockExePath, mockExeBuf);

      const { server } = await serverManager.createServerInstance({
        name: 'Iso VPS',
        version: '2.2',
        networkMode: 'vps',
        vpsUrl: over33Domain,
        buildWindows: true,
        buildAndroid: false,
        customWindowsBasePath: mockExePath,
      });

      try {
        assert.equal(server.artifacts.usedRedirector, true, 'Over-33B VPS domain must trigger redirector fallback');
        assert.ok(
          server.artifacts.warnings.some((w) => w.includes('33 bytes')),
          `Expected 33-byte fallback warning, got: ${JSON.stringify(server.artifacts.warnings)}`
        );
        assert.ok(server.artifacts.windowsExePath && fs.existsSync(server.artifacts.windowsExePath));
        const builtExe = fs.readFileSync(server.artifacts.windowsExePath);
        assert.equal(
          builtExe.length,
          mockExeBuf.length,
          'Redirector fallback build must preserve exact binary byte length'
        );

        const live = await serverManager.startServer(server.id);
        assert.equal(live.publicUrl, over33Domain);

        // VPS Reverse Proxy Security: X-Forwarded-For + valid token -> 403 Forbidden!
        const proxyHeadersToTest = [
          { 'X-Forwarded-For': '198.51.100.42' },
          { 'X-Real-IP': '198.51.100.42' },
          { 'CF-Connecting-IP': '198.51.100.42' },
          { 'CF-Ray': '9a8b7c6d5e4f-FRA' },
          { Forwarded: 'for=198.51.100.42;proto=https' },
          { 'True-Client-IP': '198.51.100.42' },
        ];
        for (const hdr of proxyHeadersToTest) {
          const proxiedAdmin = await adminCall(
            live.localUrl,
            server.adminToken,
            'GET',
            'overview',
            null,
            hdr
          );
          assert.equal(
            proxiedAdmin.status,
            403,
            `admin_api.php with ${Object.keys(hdr)[0]} MUST return 403, got ${proxiedAdmin.status}`
          );
        }

        // Direct loopback with valid token -> 200 OK
        const directAdmin = await adminCall(live.localUrl, server.adminToken, 'GET', 'overview');
        assert.equal(directAdmin.status, 200);

        // GD endpoint with X-Forwarded-For -> 200 OK!
        const proxiedGd = await postForm(
          `${live.localUrl}/db/getGJLevels21.php`,
          { type: 4, page: 0 },
          { 'X-Forwarded-For': '198.51.100.42' }
        );
        assert.equal(
          proxiedGd.status,
          200,
          `GD endpoint with X-Forwarded-For must return 200, got ${proxiedGd.status}`
        );

        return 'IP(27B), HTTPS(23B), Exact(33B), Over-33B fallback OK, all 6 proxy headers blocked (403)';
      } finally {
        await serverManager.stopServer(server.id);
      }
    });

    // -----------------------------------------------------------------------
    // Mode 5: Cloudflare Quick Tunnel (LIVE cloudflared.exe)
    // -----------------------------------------------------------------------
    if (opts.skipCloudflare) {
      console.log('  [SKIP] Mode 5 (Cloudflare Quick Tunnel) skipped via --skip-cloudflare');
    } else {
      await runCase('Mode 5 (Cloudflare Quick Tunnel — LIVE cloudflared.exe): Portal 200, Levels 200, Gauntlets 200, Admin 403', async () => {
        const { server } = await serverManager.createServerInstance({
          name: 'Iso Cloudflare 2.2',
          version: '2.2',
          networkMode: 'tunnel',
          buildWindows: false,
          buildAndroid: false,
        });

        let unsubscribe = null;
        try {
          let discoveredTunnelUrl = null;
          let resolveTunnelReady = null;
          const tunnelReadyPromise = new Promise((resolve) => {
            resolveTunnelReady = resolve;
          });

          unsubscribe = serverManager.onServerStateUpdate((st) => {
            if (st.id === server.id && st.tunnelStatus === 'active' && st.tunnelUrl) {
              discoveredTunnelUrl = st.tunnelUrl;
              resolveTunnelReady(st.tunnelUrl);
            }
          });

          const live = await serverManager.startServer(server.id);
          assert.equal(live.status, 'running');

          // Seed 5 levels + Fire Gauntlet #1 on localhost while tunnel connects
          const acct = await registerAndLogin(live.localUrl, 'TunnelUser');
          for (let i = 1; i <= 5; i++) {
            await seedAccountLevel(live.localUrl, acct, {
              levelName: `TunnelLvl_${i}`,
              gameVersion: 22,
              binaryVersion: 42,
            });
          }
          const gSave = await adminCall(live.localUrl, server.adminToken, 'POST', 'saveGauntlet', {
            ID: 1,
            level1: 1,
            level2: 2,
            level3: 3,
            level4: 4,
            level5: 5,
          });
          assert.equal(gSave.status, 200);

          // Wait up to 25 seconds for https://*.trycloudflare.com
          const currentLive = serverManager.getServerLiveState(server.id);
          if (currentLive.tunnelStatus === 'active' && currentLive.tunnelUrl) {
            discoveredTunnelUrl = currentLive.tunnelUrl;
          } else {
            await Promise.race([
              tunnelReadyPromise,
              new Promise((_, reject) =>
                setTimeout(() => {
                  const snap = serverManager.getServerLiveState(server.id);
                  reject(
                    new Error(
                      `Cloudflare Quick Tunnel did not become active within 25s (status=${snap.tunnelStatus}). Logs:\n${snap.logs.slice(-15).join('\n')}`
                    )
                  );
                }, 25000)
              ),
            ]);
          }

          assert.ok(
            discoveredTunnelUrl && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(discoveredTunnelUrl),
            `Invalid Cloudflare tunnel URL: "${discoveredTunnelUrl}"`
          );

          // 1. GET https://<tunnel>/ -> Friend Download Portal 200 OK English HTML
          const portalRes = await fetchWithRetry(`${discoveredTunnelUrl}/`, { method: 'GET' }, 20000);
          assert.equal(
            portalRes.status,
            200,
            `GET ${discoveredTunnelUrl}/ must return 200 OK, got ${portalRes.status}`
          );
          const portalHtml = await portalRes.text();
          assert.ok(
            portalHtml.includes('<html lang="en">') && portalHtml.includes('Iso Cloudflare 2.2'),
            'Tunnel Friend Download Portal must return English HTML with server name'
          );

          // 2. POST https://<tunnel>/db/getGJLevels21.php -> 200 OK valid GD response
          const lvlBody = new URLSearchParams({ type: '4', page: '0', gameVersion: '22' }).toString();
          const lvlRes = await fetchWithRetry(
            `${discoveredTunnelUrl}/db/getGJLevels21.php`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: lvlBody,
            },
            15000
          );
          assert.equal(lvlRes.status, 200, `Tunnel getGJLevels21.php must return 200, got ${lvlRes.status}`);
          const lvlText = await lvlRes.text();
          const lvlSegs = lvlText.split('#');
          assert.equal(lvlSegs.length, 5, `Tunnel getGJLevels21.php must return 5 '#' segments: "${lvlText}"`);
          assert.ok(lvlSegs[0].includes('TunnelLvl_1') && lvlSegs[0].includes('TunnelLvl_5'));

          // 3. POST https://<tunnel>/db/getGJGauntlets21.php -> 200 OK valid Gauntlet + Solo3 hash
          const gRes = await fetchWithRetry(
            `${discoveredTunnelUrl}/db/getGJGauntlets21.php`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: '',
            },
            15000
          );
          assert.equal(gRes.status, 200, `Tunnel getGJGauntlets21.php must return 200, got ${gRes.status}`);
          const gText = await gRes.text();
          const expectedGauntlet = `1:1:3:1,2,3,4,5#${generateSolo3Hash('11,2,3,4,5')}`;
          assert.equal(gText, expectedGauntlet, `Tunnel Gauntlets response mismatch: "${gText}"`);

          // 4. GET https://<tunnel>/admin_api.php?action=overview WITH VALID TOKEN -> MUST return 403!
          const adminRes = await fetchWithRetry(
            `${discoveredTunnelUrl}/admin_api.php?action=overview`,
            {
              method: 'GET',
              headers: {
                'X-EasyGDPS-Admin-Token': server.adminToken,
              },
            },
            15000
          );
          assert.equal(
            adminRes.status,
            403,
            `Tunnel admin_api.php (even with valid token!) MUST return 403 Forbidden, got ${adminRes.status}`
          );

          return `tunnel=${discoveredTunnelUrl} (Portal 200, Levels 200, Gauntlets 200, Admin 403)`;
        } finally {
          if (unsubscribe) unsubscribe();
          await serverManager.stopServer(server.id);
        }
      });
    }
  } finally {
    await serverManager.stopAllServers();
    env.restore();
  }
}

// ---------------------------------------------------------------------------
// Main Entrypoint
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const phpRuntime = locatePhpRuntime();
  const suiteTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'easygdps-isolated-'));

  console.log('=== EasyGDPS Studio Comprehensive Isolated Verification Suite ===');
  console.log(`  PHP Runtime : ${phpRuntime.phpExe}`);
  console.log(`  Temp Root   : ${suiteTempRoot} (fully isolated)`);

  try {
    await runSuite1Comments(phpRuntime, suiteTempRoot);
    await runSuite2VersionGating(phpRuntime, suiteTempRoot);
    await runSuite3EdgeCases(phpRuntime, suiteTempRoot);
    await runSuite4NetworkModes(suiteTempRoot, opts);
  } finally {
    if (opts.keepTemp) {
      console.log(`\n  INFO: Kept temporary directory (--keep-temp): ${suiteTempRoot}`);
    } else {
      await rmDirWithRetry(suiteTempRoot);
      const cleaned = !fs.existsSync(suiteTempRoot);
      console.log(
        `\n  CLEANUP: Temporary directory ${cleaned ? 'removed cleanly' : 'partially retained'}: ${suiteTempRoot}`
      );
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log('\n======================================================================');
  console.log(`SUMMARY: ${passed} passed, ${failed} failed (out of ${results.length} test cases)`);
  console.log('======================================================================');

  if (failed > 0) {
    for (const f of results.filter((r) => !r.passed)) {
      console.error(`  FAILED: ${f.name} -> ${f.error.stack || f.error.message}`);
    }
    process.exit(1);
  }

  console.log('ALL ISOLATED VERIFICATION SUITES PASSED.');
  process.exit(0);
}

main().catch((err) => {
  console.error(`\nFATAL SUITE ERROR: ${err.stack || err.message}`);
  process.exit(1);
});
