<?php
declare(strict_types=1);

/**
 * GD Rate Level Stars / Difficulty Endpoint (GD 1.0 - 2.2)
 * Moderators/admins apply rating directly; regular players submit difficulty votes.
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

$levelID = gdIntParam('levelID', 0);
$stars = max(0, min(10, gdIntParam('stars', 0)));
$rating = max(0, min(5, gdIntParam('rating', 0)));

if ($levelID <= 0) {
    echo '-1';
    return;
}

$lStmt = $pdo->prepare('SELECT levelID, userID, starStars FROM levels WHERE levelID = ? AND isDeleted = 0 LIMIT 1');
$lStmt->execute([$levelID]);
$level = $lStmt->fetch();
if ($level === false) {
    echo '-1';
    return;
}

$isMod = (int)($user['isMod'] ?? 0) >= 1 || (int)($user['isAdmin'] ?? 0) === 1;
$now = time();

// Map GD star count (1..10) to difficulty fields
$starAuto = 0;
$starDemon = 0;
$starDemonDiff = 0;
$starDifficulty = 0;

if ($rating > 0) {
    // Demon difficulty vote (rateGJDemon21)
    $demonDiffMap = [1 => 3, 2 => 4, 3 => 0, 4 => 5, 5 => 6];
    $starDemon = 1;
    $starDifficulty = 50;
    $starDemonDiff = $demonDiffMap[$rating] ?? 0;
} else {
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
        default:
            $starDifficulty = 0;
            break;
    }
}

if ($isMod) {
    if ($rating > 0) {
        $upd = $pdo->prepare(
            'UPDATE levels SET starDemon = 1, starAuto = 0, starDifficulty = 50, starDemonDiff = ?, rateDate = ? WHERE levelID = ?'
        );
        $upd->execute([$starDemonDiff, $now, $levelID]);
    } else {
        $upd = $pdo->prepare(
            'UPDATE levels SET starStars = ?, starDifficulty = ?, starAuto = ?, starDemon = ?, rateDate = ? WHERE levelID = ?'
        );
        $upd->execute([$stars, $starDifficulty, $starAuto, $starDemon, $now, $levelID]);
    }
    recalculateCreatorPoints($pdo, (int)$level['userID']);
} else {
    $ins = $pdo->prepare(
        'INSERT INTO rate_suggestions (levelID, accountID, userID, suggestStars, suggestFeatured, suggestDifficulty, timestamp)
         VALUES (?, ?, ?, ?, 0, ?, ?)'
    );
    $ins->execute([
        $levelID,
        (int)($user['accountID'] ?? 0),
        (int)$user['userID'],
        $stars,
        $starDifficulty,
        $now,
    ]);
}

echo '1';
