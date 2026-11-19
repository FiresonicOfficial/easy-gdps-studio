# EasyGDPS Studio

**EasyGDPS Studio** is a standalone Windows desktop launcher and setup builder for hosting **Geometry Dash Private Servers (GDPS)** across every version from **1.0 to 2.2** — with zero manual XAMPP, MySQL, PHP, Java, or Android SDK installation.

Spin up a clean, empty SQLite-backed GDPS in seconds, manage levels, ratings, comments, Map Packs (`1.6+`), and Gauntlets (`2.1+`) from a built-in GUI, and automatically generate patched **Windows (`.exe` / `.zip`)** and signed **Android (`.apk`)** clients served from a built-in Friend Download Portal.

---

## Features

- **Full Version Matrix (`1.0` – `2.2`):** Supports `1.0`, `1.1`, `1.2`, `1.3`, `1.4`, `1.5`, `1.6`, `1.7`, `1.8`, `1.9`, `2.0`, `2.1`, `2.11`, and `2.2` with version-aware protocol handling (`""`, `"19"`, `"20"`, `"21"` endpoints, legacy plaintext vs Base64 comments, and 33-byte ASCII / 44-byte Base64 binary URL patching).
- **Zero-Configuration Embedded Runtimes:** Bundles portable **PHP 8.3 (NTS x64)** with SQLite/PDO, **`zipalign.exe`**, **`uber-apk-signer.jar`**, **Eclipse Temurin JRE**, and **`cloudflared.exe`** inside the Windows installer.
- **Automated Dual Client Builder (`.exe` & `.apk`):**
  - Exact byte-length-preserving URL patching (`33` bytes ASCII for `1.0`–`2.0`, `44` bytes Base64 for `2.1`–`2.2`) so PE/ELF binary offsets never shift.
  - Dynamically patches **all** Android ABI native libraries (`armeabi`, `armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`), preserves uncompressed (`STORE`) alignment for `.so` and `resources.arsc`, automatically clones `armeabi` → `armeabi-v7a` for classic `1.0`–`1.5` APKs on Android 9+, aligns with `zipalign`, and signs with v1/v2/v3 APK signatures.
  - Non-destructive: base files inside `client-templates/` are never modified.
- **5 Network & Sharing Modes:**
  - **Localhost (`127.0.0.1`)** — Solo Windows testing.
  - **LAN / Wi-Fi** — Automatically prioritizes your physical Wi-Fi/Ethernet IP for phones and PCs on the same network.
  - **VPN (`Radmin VPN`, `Hamachi`, `Tailscale`, `ZeroTier`)** — Play with friends over virtual LANs.
  - **VPS / Custom Domain** — Direct patching for public VPS IPs or short `http://` / `https://` domains (`<= 33` raw bytes) with live UTF-8 byte-length validation.
  - **Cloudflare Quick Tunnel** — Instant public `*.trycloudflare.com` Friend Download Portal without router port forwarding.
- **Built-in Level & Community Manager (Version-Gated):**
  - Rate levels (Stars `0–10`, Featured, Epic, Demon, Auto), moderate comments, and ban/unban players without writing SQL.
  - **Map Packs Manager (`1.6+` only):** Create, edit, and delete 3-level Map Packs with custom RGB text/bar colors, stars, secret coins, and difficulty.
  - **Gauntlets Manager (`2.1+` only):** Create, edit, and delete 5-level Gauntlets using official slots (`1–15` for `2.1`/`2.11`, `1–60` for `2.2`) with exact level ordering and delete-integrity protection.
- **Hardened Security:**
  - All PHP SQL queries use PDO Prepared Statements.
  - The local Admin API (`admin_api.php`) requires loopback access, rejects all reverse-proxy/Cloudflare forwarded headers (`CF-Connecting-IP`, `CF-Ray`, `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, `True-Client-IP`), and validates a per-instance `X-EasyGDPS-Admin-Token`.

---

## Quick Start (End Users)

1. Download **`EasyGDPS-Setup.exe`** from the **GitHub Releases** page and run the installer.
2. Launch **EasyGDPS Studio** and click **+ Create New GDPS Server**.
3. **Step 1:** Choose your Geometry Dash version (`1.0` – `2.2`).
4. **Step 2:** Enter a server name, choose your Network Mode (**LAN / Wi-Fi** is recommended if you plan to connect from an Android phone or emulator), and select your own base `GeometryDash.exe` and/or `GeometryDash.apk` file (optionally saving it to your local template library for future servers).
5. **Step 3:** Click **Start Server**. Share the **Friend Download Page** link (`http://<your-ip>:<port>/`) so friends can download the pre-patched Windows `.zip`/`.exe` or Android `.apk` and play right away.

---

## Network & Client Tips

### Android Phones & Emulators (BlueStacks / LDPlayer)
- **Use LAN / VPN / VPS (not Localhost):** On an Android device, `127.0.0.1` refers to the phone itself, not your PC. Select **LAN / Wi-Fi** (your PC's local IP, e.g. `192.168.1.x`) so the APK connects to your server, and allow `php.exe` through Windows Defender Firewall when prompted.
- **Classic `1.0` – `1.5` APKs on BlueStacks:** Original `1.0`–`1.5` Geometry Dash APKs only include 32-bit ARM native binaries (no `x86` or `arm64-v8a`). On BlueStacks 5, create a **Nougat 32-bit** instance (or a **Pie 64-bit** instance with **ARM / Auto** ABI enabled) rather than an x86-only or Android 11 instance.
- **Switching Between GD Versions on the Same Device:** Because official Geometry Dash APKs share the package name `com.robtopx.geometryjump`, Android blocks installing an older `versionCode` (e.g. `1.3`) over a newer one (e.g. `1.8`). Uninstall the newer version first before installing an older GDPS build.

### Cloudflare Quick Tunnels & 33-Byte URL Limit
- Geometry Dash binaries reserve **33 raw URL bytes** (`44` Base64 bytes in `2.1`–`2.2`) for the server base URL.
- Random `*.trycloudflare.com` quick-tunnel URLs are typically 40–55 characters and work great for hosting the **Friend Download Portal**, while **LAN**, **VPN (`25.x` / `26.x`)**, **VPS IPs**, or **short custom domains (`<= 33` chars)** fit directly inside `.exe` and `.apk` binaries.

---

## Building from Source (Developers)

### Prerequisites
- Windows 10/11 (x64)
- [Node.js](https://nodejs.org/) 20+ (tested on Node 24)

### Setup & Run
```bash
git clone https://github.com/FiresonicOfficial/easy-gdps-studio.git
cd easy-gdps-studio

# 1. Install dependencies
npm install

# 2. Download & verify portable Windows runtimes
#    (PHP 8.3 NTS, zipalign, uber-apk-signer, cloudflared, Temurin JRE 21)
npm run fetch-runtimes

# 3. Start in development mode
npm run dev
```

### Build Windows Installer (`dist/EasyGDPS-Setup.exe`)
```bash
npm run typecheck
npm run dist
```

*(Optional)* Before running `npm run dist`, you may place your own legal base game files into:
- `client-templates/windows/<version>/GeometryDash.exe` (+ DLLs/Resources)
- `client-templates/android/<version>/GeometryDash.apk`

They are git-ignored by default and will be bundled locally if present at build time.

---

## Automated Verification Suites

EasyGDPS Studio includes two automated Node.js verification suites that run completely isolated in temporary directories:

```bash
# Core binary patcher + PHP SQLite GDPS protocol smoke suite
npm run test:endpoints

# Full isolated suite:
# - Cross-version comments (1.8, 1.9, 2.0, 2.1, 2.2, legacy DB rows, list comments)
# - Strict version gating (1.5, 1.6, 1.8, 2.0, 2.1, 2.11, 2.2)
# - Exhaustive Map Pack & Gauntlet edge cases (ordering, hashes, 409 delete guard)
# - All 5 network modes (Localhost, LAN, VPN, VPS + proxy blocking, live Cloudflare Tunnel)
npm run test:isolated
```

---

## Project Structure

```text
easy-gdps-studio/
├── src/
│   ├── main/                 # Electron main process, server manager, EXE/APK client builder
│   ├── preload/              # Secure contextBridge IPC API
│   ├── renderer/             # React + TypeScript + Tailwind CSS UI
│   └── shared/               # GD 1.0–2.2 version matrix, Gauntlet/Map Pack catalogs, types
├── server-templates/
│   ├── core/                 # Multi-version PHP 8+ GDPS backend, Friend Portal, Admin API
│   └── schema/               # Clean SQLite database schema
├── client-templates/         # Git-ignored slots (1.0–2.2) for base Windows/Android clients
├── resources/runtime/        # Downloaded portable PHP, Android tools, JRE, cloudflared
└── scripts/
    ├── fetch-runtimes.js     # Portable Windows runtime downloader & verifier
    ├── test-endpoints.js     # Core protocol & binary patcher tests
    └── test-isolated-suite.js # Full multi-version & 5-network isolated test suite
```

---

## Legal Notice

EasyGDPS Studio does **not** include or distribute copyrighted Geometry Dash game binaries (`.exe`, `.dll`, `.apk`, or game assets). Users must supply their own legally obtained copies of Geometry Dash when building private server clients. Geometry Dash is a trademark of RobTop Games AB.
