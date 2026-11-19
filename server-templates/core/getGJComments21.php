<?php
declare(strict_types=1);

/**
 * GD Get Level Comments / User Comment History Endpoint (GD 1.1 - 2.2)
 * Handles /getGJComments.php, /getGJComments19.php, /getGJComments20.php, /getGJComments21.php
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$reqPath = (string)($GLOBALS['GDPS_REQUEST_PATH'] ?? '');
$gameVersion = gdIntParam('gameVersion', 0);
$binaryVersion = gdIntParam('binaryVersion', 0);

if ($reqPath === '/getGJComments.php') {
    $gameVersion = $gameVersion > 0 ? $gameVersion : 18;
    $binaryVersion = $binaryVersion > 0 ? $binaryVersion : 0;
} elseif ($reqPath === '/getGJComments19.php') {
    $gameVersion = $gameVersion > 0 ? $gameVersion : 19;
    $binaryVersion = $binaryVersion > 0 ? $binaryVersion : 0;
} elseif ($reqPath === '/getGJComments20.php') {
    $gameVersion = $gameVersion > 0 ? $gameVersion : 20;
    $binaryVersion = $binaryVersion > 0 ? $binaryVersion : 20;
} else {
    $caps = getServerCapabilities();
    $gameVersion = $gameVersion > 0 ? $gameVersion : max(21, (int)$caps['gameVersionInt']);
    $binaryVersion = $binaryVersion > 0 ? $binaryVersion : 35;
}

$levelID = gdIntParam('levelID', 0);
$userID = gdIntParam('userID', 0);
$page = max(0, gdIntParam('page', 0));
$mode = gdIntParam('mode', 0); // 0 = newest, 1 = most liked
$pageSize = max(1, min(50, gdIntParam('count', 10)));
$offset = $page * $pageSize;

if ($levelID !== 0) {
    $whereSql = 'c.levelID = ?';
    $whereVal = $levelID;
    $displayLevelID = false;
} elseif ($userID > 0) {
    $whereSql = 'c.userID = ?';
    $whereVal = $userID;
    $displayLevelID = true;
} else {
    echo '-1';
    return;
}

$cStmt = $pdo->prepare("SELECT COUNT(*) FROM comments c WHERE {$whereSql}");
$cStmt->execute([$whereVal]);
$total = (int)$cStmt->fetchColumn();

if ($total === 0) {
    echo '-2';
    return;
}

$orderBy = $mode === 1 ? 'c.likes DESC, c.commentID DESC' : 'c.commentID DESC';

$stmt = $pdo->prepare(
    "SELECT c.*, u.icon, u.color1, u.color2, u.iconType, u.special, u.extID, u.modBadge, u.userName AS currentUserName
     FROM comments c
     LEFT JOIN users u ON u.userID = c.userID
     WHERE {$whereSql}
     ORDER BY {$orderBy}
     LIMIT ? OFFSET ?"
);
$stmt->execute([$whereVal, $pageSize, $offset]);
$rows = $stmt->fetchAll();

if ($rows === []) {
    echo '-2';
    return;
}

$entries = [];
$userMap = [];
$isModernFormat = $binaryVersion >= 32;

foreach ($rows as $row) {
    $uName = (string)($row['currentUserName'] ?: $row['userName']);
    $ext = (string)($row['extID'] ?? '');
    $numericExtID = ctype_digit($ext) ? $ext : '0';

    $commentText = $gameVersion < 20
        ? gdCleanString(gdDecodeStoredCommentToPlain((string)$row['comment']))
        : gdCleanString(gdEncodeStoredCommentToBase64((string)$row['comment']));

    $commentFields = [];
    if ($displayLevelID) {
        $commentFields[] = '1';
        $commentFields[] = (string)(int)$row['levelID'];
    }

    array_push(
        $commentFields,
        '2', $commentText,
        '3', (string)(int)$row['userID'],
        '4', (string)(int)$row['likes'],
        '5', '0',
        '7', (string)(int)$row['isSpam'],
        '9', gdRelativeTime((int)$row['timestamp']),
        '6', (string)(int)$row['commentID']
    );

    if ($gameVersion >= 21 || $binaryVersion >= 32) {
        $commentFields[] = '10';
        $commentFields[] = (string)(int)$row['percent'];
    }

    if ($isModernFormat) {
        $modBadge = (int)($row['modBadge'] ?? 0);
        $commentFields[] = '11';
        $commentFields[] = (string)$modBadge;
        if ($modBadge > 0) {
            $commentFields[] = '12';
            $commentFields[] = $modBadge >= 2 ? '75,255,75' : '255,255,75';
        }

        $userPart = implode('~', [
            '1', gdCleanString($uName),
            '7', '1',
            '9', (string)(int)($row['icon'] ?? 1),
            '10', (string)(int)($row['color1'] ?? 0),
            '11', (string)(int)($row['color2'] ?? 3),
            '14', (string)(int)($row['iconType'] ?? 0),
            '15', (string)(int)($row['special'] ?? 0),
            '16', $numericExtID,
        ]);

        $entries[] = implode('~', $commentFields) . ':' . $userPart;
    } else {
        $entries[] = implode('~', $commentFields);

        $uid = (int)$row['userID'];
        if (!isset($userMap[$uid])) {
            $userMap[$uid] = $uid . ':' . gdCleanString($uName) . ':' . $numericExtID;
        }
    }
}

$returnedCount = count($rows);

if ($isModernFormat) {
    echo implode('|', $entries) . '#' . $total . ':' . $offset . ':' . $returnedCount;
    return;
}

echo implode('|', $entries) . '#' . implode('|', array_values($userMap)) . '#' . $total . ':' . $offset . ':' . $returnedCount;
