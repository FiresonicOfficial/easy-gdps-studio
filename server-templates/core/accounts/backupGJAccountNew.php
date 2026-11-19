<?php
declare(strict_types=1);

/**
 * GD Account Cloud Backup Endpoint (GD 2.0 - 2.2)
 * Stores save data per account in data/saves/<accountID>.
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$accountID = gdIntParam('accountID', 0);
$userName = gdCleanString(gdParam('userName', ''));
$saveData = gdParam('saveData', '');
$credential = gdParam('gjp2', '');
if ($credential === '') {
    $credential = gdParam('password', '');
}
if ($credential === '') {
    $credential = gdParam('gjp', '');
}

if ($saveData === '' || $credential === '' || ($accountID <= 0 && $userName === '')) {
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

    ensureGdpsDirectories();
    $saveFile = GDPS_SAVES_DIR . '/' . $resolvedAccountID;
    if (file_put_contents($saveFile, $saveData, LOCK_EX) === false) {
        echo '-1';
        return;
    }

    echo '1';
} catch (Throwable $e) {
    echo '-1';
}
