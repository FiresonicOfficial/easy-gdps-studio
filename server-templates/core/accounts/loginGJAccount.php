<?php
declare(strict_types=1);

/**
 * GD Account Login Endpoint (GD 2.0 - 2.2)
 * Supports plaintext password (2.0-2.11) and gjp2 (2.2).
 * Returns: "<accountID>,<userID>" on success, "-1" / "-12" on failure.
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$userName = gdCleanString(gdParam('userName', ''));
$udid = gdCleanString(gdParam('udid', ''));
$credential = gdParam('gjp2', '');
if ($credential === '') {
    $credential = gdParam('password', '');
}
if ($credential === '') {
    $credential = gdParam('gjp', '');
}

if ($userName === '' || $credential === '') {
    echo '-1';
    return;
}

try {
    $pdo = getDb();

    $stmt = $pdo->prepare('SELECT * FROM accounts WHERE userName = ? LIMIT 1');
    $stmt->execute([$userName]);
    $account = $stmt->fetch();

    if ($account === false) {
        echo '-1';
        return;
    }

    if ((int)$account['isActive'] === 0) {
        echo '-12';
        return;
    }

    if (!verifyAccountPassword($credential, (string)$account['passwordHash'], (string)$account['gjp2Hash'])) {
        echo '-1';
        return;
    }

    $accountID = (int)$account['accountID'];
    $now = time();

    $uStmt = $pdo->prepare('SELECT * FROM users WHERE accountID = ? LIMIT 1');
    $uStmt->execute([$accountID]);
    $user = $uStmt->fetch();

    if ($user === false) {
        $insUser = $pdo->prepare(
            'INSERT INTO users (accountID, extID, udid, userName, lastPlayed, ip)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $insUser->execute([$accountID, (string)$accountID, $udid, (string)$account['userName'], $now, gdClientIp()]);
        $userID = (int)$pdo->lastInsertId();
    } else {
        if ((int)$user['isBanned'] === 1) {
            echo '-12';
            return;
        }
        $userID = (int)$user['userID'];
        $updUser = $pdo->prepare('UPDATE users SET udid = ?, lastPlayed = ?, ip = ? WHERE userID = ?');
        $updUser->execute([$udid !== '' ? $udid : (string)$user['udid'], $now, gdClientIp(), $userID]);
    }

    echo $accountID . ',' . $userID;
} catch (Throwable $e) {
    echo '-1';
}
