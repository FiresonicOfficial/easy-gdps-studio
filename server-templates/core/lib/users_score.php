<?php
declare(strict_types=1);

/**
 * Shared User Score Update Handler (GD 1.0 - 2.2)
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/gd_crypto.php';

function handleUpdateUserScore(int $protocolVersion): void
{
    header('Content-Type: text/plain; charset=utf-8');

    $pdo = getDb();
    $user = resolveRequestUser($pdo, true);
    if ($user === null) {
        echo '-1';
        return;
    }

    $userID = (int)$user['userID'];
    $accountID = (int)($user['accountID'] ?? 0);
    $userName = gdCleanString(gdParam('userName', (string)$user['userName']));
    if ($userName === '') {
        $userName = (string)$user['userName'];
    }

    $stars = max(0, gdIntParam('stars', (int)($user['stars'] ?? 0)));
    $moons = max(0, gdIntParam('moons', (int)($user['moons'] ?? 0)));
    $demons = max(0, gdIntParam('demons', (int)($user['demons'] ?? 0)));
    $diamonds = max(0, gdIntParam('diamonds', (int)($user['diamonds'] ?? 0)));
    $coins = max(0, gdIntParam('coins', (int)($user['coins'] ?? 0)));
    $userCoins = max(0, gdIntParam('userCoins', (int)($user['userCoins'] ?? 0)));
    $icon = max(0, gdIntParam('icon', (int)($user['icon'] ?? 1)));
    $color1 = max(0, gdIntParam('color1', (int)($user['color1'] ?? 0)));
    $color2 = max(0, gdIntParam('color2', (int)($user['color2'] ?? 3)));
    $color3 = max(0, gdIntParam('color3', (int)($user['color3'] ?? 0)));
    $iconType = max(0, gdIntParam('iconType', (int)($user['iconType'] ?? 0)));
    $special = max(0, gdIntParam('special', (int)($user['special'] ?? 0)));

    $accIcon = max(0, gdIntParam('accIcon', (int)($user['accIcon'] ?? 1)));
    $accShip = max(0, gdIntParam('accShip', (int)($user['accShip'] ?? 1)));
    $accBall = max(0, gdIntParam('accBall', (int)($user['accBall'] ?? 1)));
    $accBird = max(0, gdIntParam('accBird', (int)($user['accBird'] ?? 1)));
    $accDart = max(0, gdIntParam('accDart', (int)($user['accDart'] ?? 1)));
    $accRobot = max(0, gdIntParam('accRobot', (int)($user['accRobot'] ?? 1)));
    $accGlow = max(0, gdIntParam('accGlow', (int)($user['accGlow'] ?? 0)));
    $accSpider = max(0, gdIntParam('accSpider', (int)($user['accSpider'] ?? 1)));
    $accExplosion = max(0, gdIntParam('accExplosion', (int)($user['accExplosion'] ?? 1)));
    $accSwing = max(0, gdIntParam('accSwing', (int)($user['accSwing'] ?? 1)));
    $accJetpack = max(0, gdIntParam('accJetpack', (int)($user['accJetpack'] ?? 1)));

    $dinfo = gdCleanString(gdParam('dinfo', (string)($user['demonInfo'] ?? '')));
    $sinfo = gdCleanString(gdParam('sinfo', (string)($user['classicLevelsCompleted'] ?? '')));
    $pinfo = gdCleanString(gdParam('pinfo', (string)($user['platformerLevelsCompleted'] ?? '')));

    $now = time();

    $upd = $pdo->prepare(
        'UPDATE users SET
            userName = ?, stars = ?, moons = ?, demons = ?, diamonds = ?,
            coins = ?, userCoins = ?, icon = ?, color1 = ?, color2 = ?, color3 = ?,
            iconType = ?, special = ?, accIcon = ?, accShip = ?, accBall = ?,
            accBird = ?, accDart = ?, accRobot = ?, accGlow = ?, accSpider = ?,
            accExplosion = ?, accSwing = ?, accJetpack = ?,
            demonInfo = ?, classicLevelsCompleted = ?, platformerLevelsCompleted = ?,
            lastPlayed = ?, ip = ?
        WHERE userID = ?'
    );
    $upd->execute([
        $userName, $stars, $moons, $demons, $diamonds,
        $coins, $userCoins, $icon, $color1, $color2, $color3,
        $iconType, $special, $accIcon, $accShip, $accBall,
        $accBird, $accDart, $accRobot, $accGlow, $accSpider,
        $accExplosion, $accSwing, $accJetpack,
        $dinfo, $sinfo, $pinfo,
        $now, gdClientIp(), $userID,
    ]);

    if ($stars > 0 || $moons > 0 || $demons > 0) {
        $scoreStmt = $pdo->prepare(
            'INSERT INTO scores (accountID, userID, stars, demons, diamonds, moons, uploadDate) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $scoreStmt->execute([$accountID, $userID, $stars, $demons, $diamonds, $moons, $now]);
    }

    echo (string)$userID;
}
