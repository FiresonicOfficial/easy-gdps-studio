<?php
declare(strict_types=1);

/**
 * EasyGDPS Studio Core Configuration & Database Connection
 */

define('GDPS_CORE_DIR', __DIR__);
define('GDPS_INSTANCE_ROOT', dirname(__DIR__));
define('GDPS_DATA_DIR', GDPS_INSTANCE_ROOT . '/data');
define('GDPS_DB_PATH', GDPS_DATA_DIR . '/database.sqlite');
define('GDPS_LEVELS_DIR', GDPS_DATA_DIR . '/levels');
define('GDPS_SAVES_DIR', GDPS_DATA_DIR . '/saves');
define('GDPS_DOWNLOADS_DIR', GDPS_INSTANCE_ROOT . '/public/downloads');
define('GDPS_SCHEMA_PATH', GDPS_INSTANCE_ROOT . '/schema/schema.sql');

/**
 * Load optional server_config.json from the instance root.
 */
function getServerConfig(): array
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $defaults = [
        'name' => 'EasyGDPS Server',
        'version' => '2.2',
        'serverId' => '',
        'createdAt' => '',
        'port' => 8080,
        'networkMode' => 'localhost',
        'publicUrl' => '',
        'adminToken' => '',
    ];

    $candidates = [
        GDPS_INSTANCE_ROOT . '/server_config.json',
        GDPS_CORE_DIR . '/server_config.json',
    ];

    foreach ($candidates as $file) {
        if (is_file($file)) {
            $raw = file_get_contents($file);
            if ($raw !== false) {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $cached = [
                        'name' => (string)($decoded['name'] ?? $defaults['name']),
                        'version' => (string)($decoded['version'] ?? $defaults['version']),
                        'serverId' => (string)($decoded['serverId'] ?? $decoded['id'] ?? $defaults['serverId']),
                        'createdAt' => (string)($decoded['createdAt'] ?? $defaults['createdAt']),
                        'port' => (int)($decoded['port'] ?? $defaults['port']),
                        'networkMode' => (string)($decoded['networkMode'] ?? $defaults['networkMode']),
                        'publicUrl' => (string)($decoded['publicUrl'] ?? $defaults['publicUrl']),
                        'adminToken' => (string)($decoded['adminToken'] ?? $defaults['adminToken']),
                    ];
                    return $cached;
                }
            }
        }
    }

    $cached = $defaults;
    return $cached;
}

/**
 * Return version-gated GD server capabilities derived from server_config.json.
 * Matches src/shared/gdVersions.ts.
 */
function getServerCapabilities(): array
{
    $version = (string)(getServerConfig()['version'] ?? '2.2');

    $map = [
        '1.0' => ['gameVersionInt' => 1, 'binaryVersionInt' => 1, 'supportsMapPacks' => false, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.1' => ['gameVersionInt' => 2, 'binaryVersionInt' => 2, 'supportsMapPacks' => false, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.2' => ['gameVersionInt' => 3, 'binaryVersionInt' => 3, 'supportsMapPacks' => false, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.3' => ['gameVersionInt' => 4, 'binaryVersionInt' => 4, 'supportsMapPacks' => false, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.4' => ['gameVersionInt' => 5, 'binaryVersionInt' => 5, 'supportsMapPacks' => false, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.5' => ['gameVersionInt' => 6, 'binaryVersionInt' => 6, 'supportsMapPacks' => false, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.6' => ['gameVersionInt' => 7, 'binaryVersionInt' => 7, 'supportsMapPacks' => true, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.7' => ['gameVersionInt' => 10, 'binaryVersionInt' => 10, 'supportsMapPacks' => true, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.8' => ['gameVersionInt' => 18, 'binaryVersionInt' => 18, 'supportsMapPacks' => true, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '1.9' => ['gameVersionInt' => 19, 'binaryVersionInt' => 19, 'supportsMapPacks' => true, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '2.0' => ['gameVersionInt' => 20, 'binaryVersionInt' => 20, 'supportsMapPacks' => true, 'supportsGauntlets' => false, 'maxGauntletId' => 0],
        '2.1' => ['gameVersionInt' => 21, 'binaryVersionInt' => 33, 'supportsMapPacks' => true, 'supportsGauntlets' => true, 'maxGauntletId' => 15],
        '2.11' => ['gameVersionInt' => 21, 'binaryVersionInt' => 35, 'supportsMapPacks' => true, 'supportsGauntlets' => true, 'maxGauntletId' => 15],
        '2.2' => ['gameVersionInt' => 22, 'binaryVersionInt' => 42, 'supportsMapPacks' => true, 'supportsGauntlets' => true, 'maxGauntletId' => 60],
    ];

    $caps = $map[$version] ?? $map['2.2'];
    $caps['version'] = isset($map[$version]) ? $version : '2.2';
    return $caps;
}

/**
 * Official Geometry Dash Gauntlet catalog names (IDs 1..60).
 * Matches GAUNTLET_CATALOG in src/shared/gdVersions.ts.
 */
function getGauntletCatalogNames(): array
{
    return [
        // GD 2.1 Official Gauntlets (1-15)
        1 => 'Fire Gauntlet',
        2 => 'Ice Gauntlet',
        3 => 'Poison Gauntlet',
        4 => 'Shadow Gauntlet',
        5 => 'Lava Gauntlet',
        6 => 'Bonus Gauntlet',
        7 => 'Chaos Gauntlet',
        8 => 'Demon Gauntlet',
        9 => 'Time Gauntlet',
        10 => 'Crystal Gauntlet',
        11 => 'Magic Gauntlet',
        12 => 'Spike Gauntlet',
        13 => 'Monster Gauntlet',
        14 => 'Doom Gauntlet',
        15 => 'Death Gauntlet',
        // GD 2.2 Official Gauntlets (16-60)
        16 => 'Forest Gauntlet',
        17 => 'Rune Gauntlet',
        18 => 'Force Gauntlet',
        19 => 'Spooky Gauntlet',
        20 => 'Dragon Gauntlet',
        21 => 'Water Gauntlet',
        22 => 'Haunted Gauntlet',
        23 => 'Acid Gauntlet',
        24 => 'Witch Gauntlet',
        25 => 'Power Gauntlet',
        26 => 'Potion Gauntlet',
        27 => 'Snake Gauntlet',
        28 => 'Toxic Gauntlet',
        29 => 'Halloween Gauntlet',
        30 => 'Treasure Gauntlet',
        31 => 'Ghost Gauntlet',
        32 => 'Spider Gauntlet',
        33 => 'Gem Gauntlet',
        34 => 'Inferno Gauntlet',
        35 => 'Portal Gauntlet',
        36 => 'Strange Gauntlet',
        37 => 'Fantasy Gauntlet',
        38 => 'Christmas Gauntlet',
        39 => 'Surprise Gauntlet',
        40 => 'Mystery Gauntlet',
        41 => 'Cursed Gauntlet',
        42 => 'Cyborg Gauntlet',
        43 => 'Castle Gauntlet',
        44 => 'Grave Gauntlet',
        45 => 'Temple Gauntlet',
        46 => 'World Gauntlet',
        47 => 'Galaxy Gauntlet',
        48 => 'Universe Gauntlet',
        49 => 'Discord Gauntlet',
        50 => 'Split Gauntlet',
        51 => 'NCS I Gauntlet',
        52 => 'NCS II Gauntlet',
        53 => 'Space Gauntlet',
        54 => 'Cosmos Gauntlet',
        55 => 'Random Gauntlet',
        56 => 'Chance Gauntlet',
        57 => 'Future Gauntlet',
        58 => 'Utopia Gauntlet',
        59 => 'Cinema Gauntlet',
        60 => 'Love Gauntlet',
    ];
}

/**
 * Ensure required runtime directories exist.
 */
function ensureGdpsDirectories(): void
{
    $dirs = [
        GDPS_DATA_DIR,
        GDPS_LEVELS_DIR,
        GDPS_SAVES_DIR,
        GDPS_DOWNLOADS_DIR,
    ];

    foreach ($dirs as $dir) {
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
    }
}

/**
 * Get the shared PDO SQLite connection and auto-initialize schema if needed.
 */
function getDb(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    ensureGdpsDirectories();

    $pdo = new PDO('sqlite:' . GDPS_DB_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    $pdo->exec('PRAGMA journal_mode = WAL;');
    $pdo->exec('PRAGMA foreign_keys = ON;');
    $pdo->exec('PRAGMA busy_timeout = 5000;');

    require_once GDPS_CORE_DIR . '/init_db.php';
    ensureDatabaseInitialized($pdo);

    return $pdo;
}

/**
 * Read a POST/GET string parameter safely.
 */
function gdParam(string $key, string $default = ''): string
{
    if (isset($_POST[$key])) {
        return (string)$_POST[$key];
    }
    if (isset($_GET[$key])) {
        return (string)$_GET[$key];
    }
    return $default;
}

/**
 * Read a POST/GET integer parameter safely.
 */
function gdIntParam(string $key, int $default = 0): int
{
    $val = gdParam($key, '');
    if ($val === '' || !is_numeric($val)) {
        return $default;
    }
    return (int)$val;
}

/**
 * Get client IP address.
 */
function gdClientIp(): string
{
    return (string)($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');
}
