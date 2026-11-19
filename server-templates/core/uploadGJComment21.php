<?php
declare(strict_types=1);

/**
 * GD Upload Level / List Comment Endpoint (GD 1.1 - 2.2)
 * Handles /uploadGJComment.php, /uploadGJComment19.php, /uploadGJComment20.php, /uploadGJComment21.php
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$user = resolveRequestUser($pdo, gdIntParam('accountID', 0) <= 0);
if ($user === null) {
    echo '-1';
    return;
}

$reqPath = (string)($GLOBALS['GDPS_REQUEST_PATH'] ?? '');
$gameVersion = gdIntParam('gameVersion', 0);
if ($gameVersion <= 0) {
    $gameVersion = match ($reqPath) {
        '/uploadGJComment.php' => 18,
        '/uploadGJComment19.php' => 19,
        '/uploadGJComment20.php' => 20,
        '/uploadGJComment21.php' => 21,
        default => (int)getServerCapabilities()['gameVersionInt'],
    };
}

$levelID = gdIntParam('levelID', 0);
$rawComment = gdCleanString(gdParam('comment', ''));
$percent = max(0, min(100, gdIntParam('percent', 0)));

if ($levelID === 0 || $rawComment === '') {
    echo '-1';
    return;
}

// Normalize storage: always store comments as Base64url in SQLite
if ($gameVersion < 20) {
    $storedComment = gdBase64UrlEncode($rawComment);
} else {
    $storedComment = $rawComment;
}

if ($levelID > 0) {
    $lStmt = $pdo->prepare('SELECT levelID FROM levels WHERE levelID = ? AND isDeleted = 0 LIMIT 1');
    $lStmt->execute([$levelID]);
    if ($lStmt->fetchColumn() === false) {
        echo '-1';
        return;
    }
} else {
    // GD 2.2 Level Lists use negative levelIDs (-listID)
    $listID = abs($levelID);
    $listStmt = $pdo->prepare('SELECT listID FROM level_lists WHERE listID = ? LIMIT 1');
    $listStmt->execute([$listID]);
    if ($listStmt->fetchColumn() === false) {
        echo '-1';
        return;
    }
}

$ins = $pdo->prepare(
    'INSERT INTO comments (userID, userName, levelID, comment, percent, likes, isSpam, timestamp)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)'
);
$ins->execute([
    (int)$user['userID'],
    (string)$user['userName'],
    $levelID,
    $storedComment,
    $percent,
    time(),
]);

echo '1';
