<?php
declare(strict_types=1);

/**
 * EasyGDPS Studio - Localhost-Only JSON Admin API
 * Matches EasyGdpsBridge / shared TypeScript contracts in src/shared/types.ts.
 * Hardened against Cloudflare Tunnel, reverse-proxy, and VPS exposure.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function sendJsonResponse(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

// 1. Strict loopback-only check
$remoteAddr = (string)($_SERVER['REMOTE_ADDR'] ?? '');
if (!in_array($remoteAddr, ['127.0.0.1', '::1', '::ffff:127.0.0.1'], true)) {
    sendJsonResponse([
        'ok' => false,
        'error' => 'Forbidden: Admin API is restricted to localhost.',
    ], 403);
}

// 2. Reject any proxied / tunneled request (Cloudflare, Nginx, Caddy, Traefik, etc.)
$proxyHeaders = [
    'HTTP_CF_CONNECTING_IP',
    'HTTP_CF_RAY',
    'HTTP_X_FORWARDED_FOR',
    'HTTP_X_REAL_IP',
    'HTTP_FORWARDED',
    'HTTP_TRUE_CLIENT_IP',
];
foreach ($proxyHeaders as $proxyHeader) {
    if (array_key_exists($proxyHeader, $_SERVER)) {
        sendJsonResponse([
            'ok' => false,
            'error' => 'Forbidden: Admin API cannot be accessed through a proxy or tunnel.',
        ], 403);
    }
}

// 3. Enforce per-server admin authentication token when configured
$serverConfig = getServerConfig();
$expectedAdminToken = (string)($serverConfig['adminToken'] ?? '');
if ($expectedAdminToken !== '') {
    $providedAdminToken = (string)($_SERVER['HTTP_X_EASYGDPS_ADMIN_TOKEN'] ?? '');
    if ($providedAdminToken === '' || !hash_equals($expectedAdminToken, $providedAdminToken)) {
        sendJsonResponse([
            'ok' => false,
            'error' => 'Forbidden: Invalid or missing admin authentication token.',
        ], 403);
    }
}

/**
 * Validate and normalize an "R,G,B" string where each channel is 0..255.
 */
function parseValidRgbColor(string $raw): ?string
{
    $trimmed = trim($raw);
    if (!preg_match('/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/', $trimmed, $m)) {
        return null;
    }
    $r = (int)$m[1];
    $g = (int)$m[2];
    $b = (int)$m[3];
    if ($r < 0 || $r > 255 || $g < 0 || $g > 255 || $b < 0 || $b > 255) {
        return null;
    }
    return $r . ',' . $g . ',' . $b;
}

/**
 * Verify that all given level IDs exist in levels (isDeleted = 0).
 * Returns an array of missing level IDs.
 */
function findMissingLevelIds(PDO $pdo, array $levelIds): array
{
    if ($levelIds === []) {
        return [];
    }
    $uniqueIds = array_values(array_unique(array_map('intval', $levelIds)));
    $placeholders = implode(',', array_fill(0, count($uniqueIds), '?'));
    $stmt = $pdo->prepare(
        "SELECT levelID FROM levels WHERE isDeleted = 0 AND levelID IN ({$placeholders})"
    );
    $stmt->execute($uniqueIds);
    $found = [];
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $existingId) {
        $found[(int)$existingId] = true;
    }
    $missing = [];
    foreach ($uniqueIds as $id) {
        if (!isset($found[$id])) {
            $missing[] = $id;
        }
    }
    return $missing;
}

try {
    $pdo = getDb();
    $caps = getServerCapabilities();
    $gauntletCatalog = getGauntletCatalogNames();
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));

    if ($method === 'GET') {
        $action = (string)($_GET['action'] ?? 'overview');
        if ($action !== 'overview') {
            sendJsonResponse(['ok' => false, 'error' => 'Unknown GET action.'], 400);
        }

        $accountsStmt = $pdo->prepare('SELECT COUNT(*) FROM accounts');
        $accountsStmt->execute();
        $accountsCount = (int)$accountsStmt->fetchColumn();

        $usersStmt = $pdo->prepare('SELECT COUNT(*) FROM users');
        $usersStmt->execute();
        $usersCount = (int)$usersStmt->fetchColumn();

        $levelsCountStmt = $pdo->prepare('SELECT COUNT(*) FROM levels WHERE isDeleted = 0');
        $levelsCountStmt->execute();
        $levelsCount = (int)$levelsCountStmt->fetchColumn();

        $commentsCountStmt = $pdo->prepare('SELECT COUNT(*) FROM comments');
        $commentsCountStmt->execute();
        $commentsCount = (int)$commentsCountStmt->fetchColumn();

        $songsCountStmt = $pdo->prepare('SELECT COUNT(*) FROM songs');
        $songsCountStmt->execute();
        $songsCount = (int)$songsCountStmt->fetchColumn();

        $mapPacksCount = 0;
        if ($caps['supportsMapPacks']) {
            $mpCountStmt = $pdo->prepare('SELECT COUNT(*) FROM mappacks');
            $mpCountStmt->execute();
            $mapPacksCount = (int)$mpCountStmt->fetchColumn();
        }

        $gauntletsCount = 0;
        if ($caps['supportsGauntlets'] && (int)$caps['maxGauntletId'] > 0) {
            $gCountStmt = $pdo->prepare('SELECT COUNT(*) FROM gauntlets WHERE ID >= 1 AND ID <= ?');
            $gCountStmt->execute([(int)$caps['maxGauntletId']]);
            $gauntletsCount = (int)$gCountStmt->fetchColumn();
        }

        $levelsStmt = $pdo->prepare(
            'SELECT levelID, levelName, levelDesc, userID, userName, starStars, starFeatured,
                    starEpic, starDemon, starAuto, downloads, likes, gameVersion, uploadDate
             FROM levels
             WHERE isDeleted = 0
             ORDER BY levelID DESC
             LIMIT 200'
        );
        $levelsStmt->execute();
        $levelRows = $levelsStmt->fetchAll();

        $levels = array_map(static function (array $row): array {
            return [
                'levelID' => (int)$row['levelID'],
                'levelName' => (string)$row['levelName'],
                'levelDesc' => gdSafeBase64DecodeForDisplay((string)$row['levelDesc']),
                'userID' => (int)$row['userID'],
                'userName' => (string)$row['userName'],
                'starStars' => (int)$row['starStars'],
                'starFeatured' => (int)$row['starFeatured'],
                'starEpic' => (int)$row['starEpic'],
                'starDemon' => (int)$row['starDemon'],
                'starAuto' => (int)$row['starAuto'],
                'downloads' => (int)$row['downloads'],
                'likes' => (int)$row['likes'],
                'gameVersion' => (int)$row['gameVersion'],
                'uploadDate' => (int)$row['uploadDate'],
            ];
        }, $levelRows);

        $usersStmt2 = $pdo->prepare(
            'SELECT userID, accountID, userName, stars, demons, creatorPoints, isMod, isBanned
             FROM users
             ORDER BY userID DESC
             LIMIT 200'
        );
        $usersStmt2->execute();
        $userRows = $usersStmt2->fetchAll();

        $users = array_map(static function (array $row): array {
            return [
                'userID' => (int)$row['userID'],
                'accountID' => (int)$row['accountID'],
                'userName' => (string)$row['userName'],
                'stars' => (int)$row['stars'],
                'demons' => (int)$row['demons'],
                'creatorPoints' => (int)$row['creatorPoints'],
                'isMod' => (int)$row['isMod'],
                'isBanned' => (int)$row['isBanned'],
            ];
        }, $userRows);

        $commentsStmt2 = $pdo->prepare(
            'SELECT commentID, levelID, userID, userName, comment, likes, timestamp
             FROM comments
             ORDER BY commentID DESC
             LIMIT 200'
        );
        $commentsStmt2->execute();
        $commentRows = $commentsStmt2->fetchAll();

        $comments = array_map(static function (array $row): array {
            return [
                'commentID' => (int)$row['commentID'],
                'levelID' => (int)$row['levelID'],
                'userID' => (int)$row['userID'],
                'userName' => (string)$row['userName'],
                'comment' => gdDecodeStoredCommentToPlain((string)$row['comment']),
                'likes' => (int)$row['likes'],
                'timestamp' => (int)$row['timestamp'],
            ];
        }, $commentRows);

        $mapPacks = [];
        if ($caps['supportsMapPacks']) {
            $mpStmt = $pdo->prepare(
                'SELECT ID, name, levels, stars, coins, difficulty, rgbcolors, colors2
                 FROM mappacks
                 ORDER BY ID ASC'
            );
            $mpStmt->execute();
            $mpRows = $mpStmt->fetchAll();

            $mapPacks = array_map(static function (array $row): array {
                $parsedLevels = array_values(array_filter(
                    array_map('intval', explode(',', (string)$row['levels'])),
                    static fn(int $id): bool => $id > 0
                ));
                return [
                    'ID' => (int)$row['ID'],
                    'name' => (string)$row['name'],
                    'levels' => $parsedLevels,
                    'stars' => (int)$row['stars'],
                    'coins' => (int)$row['coins'],
                    'difficulty' => (int)$row['difficulty'],
                    'rgbcolors' => (string)$row['rgbcolors'],
                    'colors2' => (string)$row['colors2'],
                ];
            }, $mpRows);
        }

        $gauntlets = [];
        if ($caps['supportsGauntlets'] && (int)$caps['maxGauntletId'] > 0) {
            $gStmt = $pdo->prepare(
                'SELECT ID, level1, level2, level3, level4, level5, timestamp
                 FROM gauntlets
                 WHERE ID >= 1 AND ID <= ?
                 ORDER BY ID ASC'
            );
            $gStmt->execute([(int)$caps['maxGauntletId']]);
            $gRows = $gStmt->fetchAll();

            $gauntlets = array_map(static function (array $row) use ($gauntletCatalog): array {
                $gId = (int)$row['ID'];
                return [
                    'ID' => $gId,
                    'name' => $gauntletCatalog[$gId] ?? ('Gauntlet #' . $gId),
                    'levels' => [
                        (int)$row['level1'],
                        (int)$row['level2'],
                        (int)$row['level3'],
                        (int)$row['level4'],
                        (int)$row['level5'],
                    ],
                    'timestamp' => (int)$row['timestamp'],
                ];
            }, $gRows);
        }

        sendJsonResponse([
            'stats' => [
                'accountsCount' => $accountsCount,
                'usersCount' => $usersCount,
                'levelsCount' => $levelsCount,
                'commentsCount' => $commentsCount,
                'songsCount' => $songsCount,
                'mapPacksCount' => $mapPacksCount,
                'gauntletsCount' => $gauntletsCount,
            ],
            'levels' => $levels,
            'users' => $users,
            'comments' => $comments,
            'mapPacks' => $mapPacks,
            'gauntlets' => $gauntlets,
        ]);
    }

    if ($method === 'POST') {
        $rawBody = file_get_contents('php://input');
        $body = is_string($rawBody) && $rawBody !== '' ? json_decode($rawBody, true) : [];
        if (!is_array($body)) {
            $body = [];
        }

        $action = (string)($_GET['action'] ?? $body['action'] ?? '');

        switch ($action) {
            case 'rateLevel':
                $levelID = (int)($body['levelID'] ?? 0);
                $stars = max(0, min(10, (int)($body['stars'] ?? 0)));
                $featured = max(0, (int)($body['featured'] ?? 0));
                $epic = max(0, min(3, (int)($body['epic'] ?? 0)));
                $demon = (int)($body['demon'] ?? 0) > 0 ? 1 : 0;
                $auto = (int)($body['auto'] ?? 0) > 0 ? 1 : 0;

                if ($levelID <= 0) {
                    sendJsonResponse(['ok' => false, 'error' => 'Invalid levelID.'], 400);
                }

                $lStmt = $pdo->prepare('SELECT userID FROM levels WHERE levelID = ? AND isDeleted = 0 LIMIT 1');
                $lStmt->execute([$levelID]);
                $authorID = $lStmt->fetchColumn();
                if ($authorID === false) {
                    sendJsonResponse(['ok' => false, 'error' => 'Level not found.'], 404);
                }

                $starDifficulty = 0;
                if ($auto === 1) {
                    $starDifficulty = 50;
                    $demon = 0;
                } elseif ($demon === 1) {
                    $starDifficulty = 50;
                    $auto = 0;
                } else {
                    $starDifficulty = match ($stars) {
                        1 => 50,
                        2 => 10,
                        3 => 20,
                        4, 5 => 30,
                        6, 7 => 40,
                        8, 9, 10 => 50,
                        default => 0,
                    };
                    if ($stars === 1) {
                        $auto = 1;
                    } elseif ($stars === 10) {
                        $demon = 1;
                    }
                }

                $upd = $pdo->prepare(
                    'UPDATE levels SET
                        starStars = ?,
                        starFeatured = ?,
                        starEpic = ?,
                        starDemon = ?,
                        starAuto = ?,
                        starDifficulty = ?,
                        rateDate = ?
                     WHERE levelID = ?'
                );
                $upd->execute([
                    $stars,
                    $featured,
                    $epic,
                    $demon,
                    $auto,
                    $starDifficulty,
                    time(),
                    $levelID,
                ]);

                recalculateCreatorPoints($pdo, (int)$authorID);
                sendJsonResponse(['ok' => true]);

            case 'deleteLevel':
                $levelID = (int)($body['levelID'] ?? 0);
                if ($levelID <= 0) {
                    sendJsonResponse(['ok' => false, 'error' => 'Invalid levelID.'], 400);
                }

                // Prevent deleting a level currently referenced by a Gauntlet or Map Pack
                $refGauntlets = [];
                $gRefStmt = $pdo->prepare(
                    'SELECT ID FROM gauntlets
                     WHERE level1 = ? OR level2 = ? OR level3 = ? OR level4 = ? OR level5 = ?
                     ORDER BY ID ASC'
                );
                $gRefStmt->execute([$levelID, $levelID, $levelID, $levelID, $levelID]);
                foreach ($gRefStmt->fetchAll(PDO::FETCH_COLUMN) as $refGId) {
                    $gid = (int)$refGId;
                    $gName = $gauntletCatalog[$gid] ?? ('Gauntlet #' . $gid);
                    $refGauntlets[] = $gName . ' (#' . $gid . ')';
                }

                $refMapPacks = [];
                $mpRefStmt = $pdo->prepare('SELECT ID, name, levels FROM mappacks ORDER BY ID ASC');
                $mpRefStmt->execute();
                foreach ($mpRefStmt->fetchAll() as $mpRow) {
                    $packLevels = array_map('intval', explode(',', (string)$mpRow['levels']));
                    if (in_array($levelID, $packLevels, true)) {
                        $refMapPacks[] = (string)$mpRow['name'] . ' (#' . (int)$mpRow['ID'] . ')';
                    }
                }

                if ($refGauntlets !== [] || $refMapPacks !== []) {
                    $conflictParts = [];
                    if ($refGauntlets !== []) {
                        $conflictParts[] = 'Gauntlet(s): ' . implode(', ', $refGauntlets);
                    }
                    if ($refMapPacks !== []) {
                        $conflictParts[] = 'Map Pack(s): ' . implode(', ', $refMapPacks);
                    }
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Cannot delete level #' . $levelID . ' because it is referenced by '
                            . implode('; ', $conflictParts)
                            . '. Remove or replace this level there first.',
                    ], 409);
                }

                $lStmt = $pdo->prepare('SELECT userID FROM levels WHERE levelID = ? LIMIT 1');
                $lStmt->execute([$levelID]);
                $authorID = $lStmt->fetchColumn();

                $del = $pdo->prepare('DELETE FROM levels WHERE levelID = ?');
                $del->execute([$levelID]);

                $delComments = $pdo->prepare('DELETE FROM comments WHERE levelID = ?');
                $delComments->execute([$levelID]);

                $delDaily = $pdo->prepare('DELETE FROM daily_features WHERE levelID = ?');
                $delDaily->execute([$levelID]);

                $levelFile = GDPS_LEVELS_DIR . '/' . $levelID;
                if (is_file($levelFile)) {
                    @unlink($levelFile);
                }

                if ($authorID !== false) {
                    recalculateCreatorPoints($pdo, (int)$authorID);
                }
                sendJsonResponse(['ok' => true]);

            case 'deleteComment':
                $commentID = (int)($body['commentID'] ?? 0);
                if ($commentID <= 0) {
                    sendJsonResponse(['ok' => false, 'error' => 'Invalid commentID.'], 400);
                }

                $del = $pdo->prepare('DELETE FROM comments WHERE commentID = ?');
                $del->execute([$commentID]);
                sendJsonResponse(['ok' => true]);

            case 'toggleUserBan':
                $userID = (int)($body['userID'] ?? 0);
                $isBanned = (int)($body['isBanned'] ?? 0) > 0 ? 1 : 0;
                if ($userID <= 0) {
                    sendJsonResponse(['ok' => false, 'error' => 'Invalid userID.'], 400);
                }

                $upd = $pdo->prepare('UPDATE users SET isBanned = ? WHERE userID = ?');
                $upd->execute([$isBanned, $userID]);
                sendJsonResponse(['ok' => true]);

            case 'saveMapPack':
                if (!$caps['supportsMapPacks']) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Map Packs are only supported in Geometry Dash 1.6 and newer.',
                    ], 400);
                }

                $packID = (int)($body['ID'] ?? 0);
                $name = gdCleanString((string)($body['name'] ?? ''));
                $nameLen = mb_strlen($name, 'UTF-8');
                if ($nameLen < 2 || $nameLen > 40) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Map Pack name must be between 2 and 40 characters.',
                    ], 400);
                }

                $rawLevels = $body['levels'] ?? null;
                if (!is_array($rawLevels)) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Map Pack must specify an array of exactly 3 level IDs.',
                    ], 400);
                }

                $packLevels = [];
                foreach ($rawLevels as $lvlVal) {
                    if (!is_int($lvlVal) && !(is_string($lvlVal) && ctype_digit($lvlVal))) {
                        sendJsonResponse([
                            'ok' => false,
                            'error' => 'All Map Pack level IDs must be positive integers.',
                        ], 400);
                    }
                    $intVal = (int)$lvlVal;
                    if ($intVal <= 0) {
                        sendJsonResponse([
                            'ok' => false,
                            'error' => 'All Map Pack level IDs must be positive integers.',
                        ], 400);
                    }
                    $packLevels[] = $intVal;
                }

                if (count($packLevels) !== 3 || count(array_unique($packLevels)) !== 3) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'A Map Pack must contain exactly 3 distinct level IDs.',
                    ], 400);
                }

                $missingLevels = findMissingLevelIds($pdo, $packLevels);
                if ($missingLevels !== []) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Level ID(s) not found: ' . implode(', ', $missingLevels) . '.',
                    ], 400);
                }

                $stars = (int)($body['stars'] ?? 0);
                if ($stars < 1 || $stars > 10) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Map Pack stars must be between 1 and 10.',
                    ], 400);
                }

                $coins = (int)($body['coins'] ?? 0);
                if ($coins < 1 || $coins > 2) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Map Pack coins must be 1 or 2.',
                    ], 400);
                }

                $difficulty = (int)($body['difficulty'] ?? -1);
                if ($difficulty < 0 || $difficulty > 10) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Map Pack difficulty must be between 0 and 10.',
                    ], 400);
                }

                $rgbcolors = parseValidRgbColor((string)($body['rgbcolors'] ?? ''));
                if ($rgbcolors === null) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'rgbcolors must be formatted as R,G,B with values from 0 to 255.',
                    ], 400);
                }

                $colors2Input = trim((string)($body['colors2'] ?? 'none'));
                if ($colors2Input === '' || strtolower($colors2Input) === 'none') {
                    $colors2 = 'none';
                } else {
                    $parsedColors2 = parseValidRgbColor($colors2Input);
                    if ($parsedColors2 === null) {
                        sendJsonResponse([
                            'ok' => false,
                            'error' => 'colors2 must be "none" or formatted as R,G,B with values from 0 to 255.',
                        ], 400);
                    }
                    $colors2 = $parsedColors2;
                }

                $levelsCsv = implode(',', $packLevels);

                $existingId = false;
                if ($packID > 0) {
                    $existsStmt = $pdo->prepare('SELECT ID FROM mappacks WHERE ID = ? LIMIT 1');
                    $existsStmt->execute([$packID]);
                    $existingId = $existsStmt->fetchColumn();
                }

                if ($existingId !== false) {
                    $upd = $pdo->prepare(
                        'UPDATE mappacks
                         SET name = ?, levels = ?, stars = ?, coins = ?, difficulty = ?, rgbcolors = ?, colors2 = ?
                         WHERE ID = ?'
                    );
                    $upd->execute([
                        $name,
                        $levelsCsv,
                        $stars,
                        $coins,
                        $difficulty,
                        $rgbcolors,
                        $colors2,
                        $packID,
                    ]);
                    sendJsonResponse(['ok' => true, 'ID' => $packID]);
                }

                $ins = $pdo->prepare(
                    'INSERT INTO mappacks (name, levels, stars, coins, difficulty, rgbcolors, colors2)
                     VALUES (?, ?, ?, ?, ?, ?, ?)'
                );
                $ins->execute([
                    $name,
                    $levelsCsv,
                    $stars,
                    $coins,
                    $difficulty,
                    $rgbcolors,
                    $colors2,
                ]);
                sendJsonResponse(['ok' => true, 'ID' => (int)$pdo->lastInsertId()]);

            case 'deleteMapPack':
                if (!$caps['supportsMapPacks']) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Map Packs are only supported in Geometry Dash 1.6 and newer.',
                    ], 400);
                }

                $packID = (int)($body['packID'] ?? $body['ID'] ?? 0);
                if ($packID <= 0) {
                    sendJsonResponse(['ok' => false, 'error' => 'Invalid packID.'], 400);
                }

                $del = $pdo->prepare('DELETE FROM mappacks WHERE ID = ?');
                $del->execute([$packID]);
                sendJsonResponse(['ok' => true]);

            case 'saveGauntlet':
                $maxGauntletId = (int)$caps['maxGauntletId'];
                if (!$caps['supportsGauntlets'] || $maxGauntletId <= 0) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Gauntlets are only supported in Geometry Dash 2.1 and newer.',
                    ], 400);
                }

                $gauntletID = (int)($body['ID'] ?? 0);
                if ($gauntletID < 1 || $gauntletID > $maxGauntletId) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Gauntlet ID must be between 1 and ' . $maxGauntletId . ' for this Geometry Dash version.',
                    ], 400);
                }

                $gLevels = [
                    (int)($body['level1'] ?? 0),
                    (int)($body['level2'] ?? 0),
                    (int)($body['level3'] ?? 0),
                    (int)($body['level4'] ?? 0),
                    (int)($body['level5'] ?? 0),
                ];

                foreach ($gLevels as $glId) {
                    if ($glId <= 0) {
                        sendJsonResponse([
                            'ok' => false,
                            'error' => 'All 5 Gauntlet level slots must be valid positive level IDs.',
                        ], 400);
                    }
                }

                if (count(array_unique($gLevels)) !== 5) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'All 5 Gauntlet levels must be distinct.',
                    ], 400);
                }

                $missingLevels = findMissingLevelIds($pdo, $gLevels);
                if ($missingLevels !== []) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Level ID(s) not found: ' . implode(', ', $missingLevels) . '.',
                    ], 400);
                }

                $upsert = $pdo->prepare(
                    'INSERT INTO gauntlets (ID, level1, level2, level3, level4, level5, timestamp)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(ID) DO UPDATE SET
                        level1 = excluded.level1,
                        level2 = excluded.level2,
                        level3 = excluded.level3,
                        level4 = excluded.level4,
                        level5 = excluded.level5,
                        timestamp = excluded.timestamp'
                );
                $upsert->execute([
                    $gauntletID,
                    $gLevels[0],
                    $gLevels[1],
                    $gLevels[2],
                    $gLevels[3],
                    $gLevels[4],
                    time(),
                ]);

                sendJsonResponse(['ok' => true, 'ID' => $gauntletID]);

            case 'deleteGauntlet':
                if (!$caps['supportsGauntlets']) {
                    sendJsonResponse([
                        'ok' => false,
                        'error' => 'Gauntlets are only supported in Geometry Dash 2.1 and newer.',
                    ], 400);
                }

                $gauntletID = (int)($body['gauntletID'] ?? $body['ID'] ?? 0);
                if ($gauntletID <= 0) {
                    sendJsonResponse(['ok' => false, 'error' => 'Invalid gauntletID.'], 400);
                }

                $del = $pdo->prepare('DELETE FROM gauntlets WHERE ID = ?');
                $del->execute([$gauntletID]);
                sendJsonResponse(['ok' => true]);

            default:
                sendJsonResponse(['ok' => false, 'error' => 'Unknown POST action.'], 400);
        }
    }

    sendJsonResponse(['ok' => false, 'error' => 'Method not allowed.'], 405);
} catch (Throwable $e) {
    sendJsonResponse([
        'ok' => false,
        'error' => 'Internal server error: ' . $e->getMessage(),
    ], 500);
}
