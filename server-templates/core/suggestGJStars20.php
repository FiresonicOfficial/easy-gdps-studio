<?php
declare(strict_types=1);

/**
 * GD Suggest Stars / Moderator Send Endpoint (GD 2.0 - 2.2)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$user = authenticateAccountRequest($pdo);
if ($user === null) {
    echo '-1';
    return;
}

$levelID = gdIntParam('levelID', 0);
$stars = max(0, min(10, gdIntParam('stars', 0)));
$feature = max(0, gdIntParam('feature', 0));

if ($levelID <= 0) {
    echo '-1';
    return;
}

$lStmt = $pdo->prepare('SELECT levelID, userID FROM levels WHERE levelID = ? AND isDeleted = 0 LIMIT 1');
$lStmt->execute([$levelID]);
$level = $lStmt->fetch();
if ($level === false) {
    echo '-1';
    return;
}

$isElderOrAdmin = (int)($user['isMod'] ?? 0) >= 2 || (int)($user['isAdmin'] ?? 0) === 1;
$now = time();

$starAuto = 0;
$starDemon = 0;
$starDifficulty = 0;
switch ($stars) {
    case 1:
        $starAuto = 1;
        $starDifficulty = 50;
        break;
    case 2:
        $starDifficulty = 10;
        break;
    case 3:
        $starDifficulty = 20;
        break;
    case 4:
    case 5:
        $starDifficulty = 30;
        break;
    case 6:
    case 7:
        $starDifficulty = 40;
        break;
    case 8:
    case 9:
        $starDifficulty = 50;
        break;
    case 10:
        $starDifficulty = 50;
        $starDemon = 1;
        break;
}

if ($isElderOrAdmin) {
    $starFeatured = $feature >= 1 ? 1 : 0;
    $starEpic = $feature >= 2 ? min(3, $feature - 1) : 0;

    $upd = $pdo->prepare(
        'UPDATE levels SET
            starStars = ?, starDifficulty = ?, starAuto = ?, starDemon = ?,
            starFeatured = ?, starEpic = ?, rateDate = ?
         WHERE levelID = ?'
    );
    $upd->execute([$stars, $starDifficulty, $starAuto, $starDemon, $starFeatured, $starEpic, $now, $levelID]);
    recalculateCreatorPoints($pdo, (int)$level['userID']);
    echo '1';
    return;
}

$ins = $pdo->prepare(
    'INSERT INTO rate_suggestions (levelID, accountID, userID, suggestStars, suggestFeatured, suggestDifficulty, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)'
);
$ins->execute([
    $levelID,
    (int)$user['accountID'],
    (int)$user['userID'],
    $stars,
    $feature,
    $starDifficulty,
    $now,
]);

echo '1';
