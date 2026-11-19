<?php
declare(strict_types=1);

/**
 * GD Top Creators Leaderboard Endpoint (GD 1.9 - 2.2)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$count = max(1, min(100, gdIntParam('count', 100)));

$stmt = $pdo->prepare(
    'SELECT * FROM users WHERE isBanned = 0 AND creatorPoints > 0 ORDER BY creatorPoints DESC, stars DESC, userID ASC LIMIT ?'
);
$stmt->execute([$count]);
$rows = $stmt->fetchAll();

if ($rows === []) {
    echo '';
    return;
}

$entries = [];
$rank = 1;
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
    ]);
    $rank++;
}

echo implode('|', $entries);
