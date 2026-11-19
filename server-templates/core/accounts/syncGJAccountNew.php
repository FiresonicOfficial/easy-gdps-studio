<?php
declare(strict_types=1);

/**
 * GD Account Cloud Sync Endpoint (GD 2.0 - 2.2)
 * Returns save data stored in data/saves/<accountID>.
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$accountID = gdIntParam('accountID', 0);
$userName = gdCleanString(gdParam('userName', ''));
$credential = gdParam('gjp2', '');
if ($credential === '') {
    $credential = gdParam('password', '');
}
if ($credential === '') {
    $credential = gdParam('gjp', '');
}

if ($credential === '' || ($accountID <= 0 && $userName === '')) {
    echo '-1';
    return;
}

try {
    $pdo = getDb();

    if ($accountID > 0) {
        $stmt = $pdo->prepare('SELECT * FROM accounts WHERE accountID = ? LIMIT 1');
        $stmt->execute([$accountID]);
    } else {
        $stmt = $pdo->prepare('SELECT * FROM accounts WHERE userName = ? LIMIT 1');
        $stmt->execute([$userName]);
    }

    $account = $stmt->fetch();
    if ($account === false || (int)$account['isActive'] === 0) {
        echo '-1';
        return;
    }

    if (!verifyAccountPassword($credential, (string)$account['passwordHash'], (string)$account['gjp2Hash'])) {
        echo '-1';
        return;
    }

    $resolvedAccountID = (int)$account['accountID'];
    $uStmt = $pdo->prepare('SELECT isBanned FROM users WHERE accountID = ? LIMIT 1');
    $uStmt->execute([$resolvedAccountID]);
    $isBanned = $uStmt->fetchColumn();
    if ($isBanned !== false && (int)$isBanned === 1) {
        echo '-1';
        return;
    }

    $saveFile = GDPS_SAVES_DIR . '/' . $resolvedAccountID;
    if (!is_file($saveFile)) {
        echo '-1';
        return;
    }

    $saveData = file_get_contents($saveFile);
    if ($saveData === false || $saveData === '') {
        echo '-1';
        return;
    }

    if (str_ends_with($saveData, ';21;30;a;a')) {
        echo $saveData;
    } else {
        echo $saveData . ';21;30;a;a';
    }
} catch (Throwable $e) {
    echo '-1';
}
