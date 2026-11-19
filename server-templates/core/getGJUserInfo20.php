<?php
declare(strict_types=1);

/**
 * GD User Profile Info Endpoint (GD 2.0 - 2.2)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$targetAccountID = gdIntParam('targetAccountID', 0);
if ($targetAccountID <= 0) {
    $targetAccountID = gdIntParam('accountID', 0);
}

if ($targetAccountID <= 0) {
    echo '-1';
    return;
}

$stmt = $pdo->prepare(
    'SELECT u.*, a.mS, a.frS, a.cS, a.youtubeurl, a.twitter, a.twitch, a.discord
     FROM users u
     LEFT JOIN accounts a ON a.accountID = u.accountID
     WHERE u.accountID = ?
     LIMIT 1'
);
$stmt->execute([$targetAccountID]);
$user = $stmt->fetch();

if ($user === false || (int)$user['isBanned'] === 1) {
    echo '-1';
    return;
}

$rank = 0;
if ((int)$user['stars'] > 0) {
    $rStmt = $pdo->prepare('SELECT COUNT(*) + 1 FROM users WHERE stars > ? AND isBanned = 0');
    $rStmt->execute([(int)$user['stars']]);
    $rank = (int)$rStmt->fetchColumn();
}

$fields = [
    '1' => gdCleanString((string)$user['userName']),
    '2' => (int)$user['userID'],
    '3' => (int)$user['stars'],
    '4' => (int)$user['demons'],
    '6' => $rank,
    '7' => (int)$user['creatorPoints'],
    '8' => (int)$user['creatorPoints'],
    '9' => (int)$user['icon'],
    '10' => (int)$user['color1'],
    '11' => (int)$user['color2'],
    '13' => (int)$user['coins'],
    '14' => (int)$user['iconType'],
    '15' => (int)$user['special'],
    '16' => (int)$user['accountID'],
    '17' => (int)$user['userCoins'],
    '18' => (int)($user['mS'] ?? 0),
    '19' => (int)($user['frS'] ?? 0),
    '20' => gdCleanString((string)($user['youtubeurl'] ?? '')),
    '21' => (int)$user['accIcon'],
    '22' => (int)$user['accShip'],
    '23' => (int)$user['accBall'],
    '24' => (int)$user['accBird'],
    '25' => (int)$user['accDart'],
    '26' => (int)$user['accRobot'],
    '28' => (int)$user['accGlow'],
    '29' => 1,
    '30' => $rank,
    '31' => 0,
    '43' => (int)$user['accSpider'],
    '44' => gdCleanString((string)($user['twitter'] ?? '')),
    '45' => gdCleanString((string)($user['twitch'] ?? '')),
    '46' => (int)$user['diamonds'],
    '48' => (int)$user['accExplosion'],
    '49' => (int)$user['modBadge'],
    '50' => (int)($user['cS'] ?? 0),
    '51' => (int)$user['color3'],
    '52' => (int)$user['moons'],
    '53' => (int)$user['accSwing'],
    '54' => (int)$user['accJetpack'],
    '55' => gdCleanString((string)$user['demonInfo']),
    '56' => gdCleanString((string)$user['classicLevelsCompleted']),
    '57' => gdCleanString((string)$user['platformerLevelsCompleted']),
];

$pairs = [];
foreach ($fields as $k => $v) {
    $pairs[] = $k . ':' . $v;
}

echo implode(':', $pairs);
