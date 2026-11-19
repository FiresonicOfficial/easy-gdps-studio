<?php
declare(strict_types=1);

/**
 * GD Leaderboards Endpoint (GD 1.0 - 2.2)
 * Supports type: top, relative, creators, friends, week
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$type = gdCleanString(gdParam('type', 'top'));
$count = max(1, min(100, gdIntParam('count', 100)));
$rows = [];
$startRank = 1;

switch ($type) {
    case 'creators':
        $stmt = $pdo->prepare(
            'SELECT * FROM users WHERE isBanned = 0 AND creatorPoints > 0 ORDER BY creatorPoints DESC, stars DESC, userID ASC LIMIT ?'
        );
        $stmt->execute([$count]);
        $rows = $stmt->fetchAll();
        break;

    case 'relative':
        $accountID = gdIntParam('accountID', 0);
        $udid = gdCleanString(gdParam('udid', ''));
        $self = null;

        if ($accountID > 0) {
            $sStmt = $pdo->prepare('SELECT * FROM users WHERE accountID = ? AND isBanned = 0 LIMIT 1');
            $sStmt->execute([$accountID]);
            $self = $sStmt->fetch();
        } elseif ($udid !== '') {
            $sStmt = $pdo->prepare('SELECT * FROM users WHERE (extID = ? OR udid = ?) AND isBanned = 0 LIMIT 1');
            $sStmt->execute([$udid, $udid]);
            $self = $sStmt->fetch();
        }

        if ($self === false || $self === null) {
            $stmt = $pdo->prepare(
                'SELECT * FROM users WHERE isBanned = 0 AND stars > 0 ORDER BY stars DESC, userID ASC LIMIT ?'
            );
            $stmt->execute([$count]);
            $rows = $stmt->fetchAll();
        } else {
            $myStars = (int)$self['stars'];
            $aboveStmt = $pdo->prepare(
                'SELECT * FROM users WHERE isBanned = 0 AND stars >= ? AND userID != ? ORDER BY stars ASC, userID DESC LIMIT 50'
            );
            $aboveStmt->execute([$myStars, (int)$self['userID']]);
            $above = array_reverse($aboveStmt->fetchAll());

            $belowStmt = $pdo->prepare(
                'SELECT * FROM users WHERE isBanned = 0 AND stars < ? ORDER BY stars DESC, userID ASC LIMIT 49'
            );
            $belowStmt->execute([$myStars]);
            $below = $belowStmt->fetchAll();

            $rows = array_merge($above, [$self], $below);
            if ($rows !== []) {
                $firstStars = (int)$rows[0]['stars'];
                $rankStmt = $pdo->prepare('SELECT COUNT(*) + 1 FROM users WHERE isBanned = 0 AND stars > ?');
                $rankStmt->execute([$firstStars]);
                $startRank = (int)$rankStmt->fetchColumn();
            }
        }
        break;

    case 'friends':
        $accountID = gdIntParam('accountID', 0);
        if ($accountID > 0) {
            $stmt = $pdo->prepare(
                'SELECT * FROM users WHERE isBanned = 0 AND accountID = ? ORDER BY stars DESC LIMIT ?'
            );
            $stmt->execute([$accountID, $count]);
            $rows = $stmt->fetchAll();
        }
        break;

    case 'top':
    case 'week':
    default:
        $stmt = $pdo->prepare(
            'SELECT * FROM users WHERE isBanned = 0 AND stars > 0 ORDER BY stars DESC, userID ASC LIMIT ?'
        );
        $stmt->execute([$count]);
        $rows = $stmt->fetchAll();
        break;
}

if ($rows === []) {
    echo '';
    return;
}

$entries = [];
$rank = $startRank;
foreach ($rows as $u) {
    $ext = (string)$u['extID'] !== '' ? (string)$u['extID'] : (string)$u['userID'];
    $entries[] = implode(':', [
        '1', gdCleanString((string)$u['userName']),
        '2', (int)$u['userID'],
        '3', (int)$u['stars'],
        '4', (int)$u['demons'],
        '6', $rank,
        '7', $ext,
        '8', (int)$u['creatorPoints'],
        '9', (int)$u['icon'],
        '10', (int)$u['color1'],
        '11', (int)$u['color2'],
        '13', (int)$u['coins'],
        '14', (int)$u['iconType'],
        '15', (int)$u['special'],
        '16', (int)$u['accountID'],
        '17', (int)$u['userCoins'],
        '46', (int)$u['diamonds'],
        '52', (int)$u['moons'],
    ]);
    $rank++;
}

echo implode('|', $entries);
