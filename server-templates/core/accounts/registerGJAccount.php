<?php
declare(strict_types=1);

/**
 * GD Account Registration Endpoint (GD 2.0 - 2.2)
 * Responses: 1 (success), -2 (username taken), -3 (email taken), -4 (invalid username), -6 (invalid email), -9 (short password), -1 (error)
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$userName = gdCleanString(gdParam('userName', ''));
$password = gdParam('password', '');
$email = trim(gdParam('email', ''));
$secret = gdCleanString(gdParam('secret', ''));

if ($userName === '' || strlen($userName) < 3 || strlen($userName) > 20 || preg_match('/[^A-Za-z0-9_ -]/', $userName)) {
    echo '-4';
    return;
}

if (strlen($password) < 6) {
    echo '-9';
    return;
}

if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    echo '-6';
    return;
}

try {
    $pdo = getDb();

    $chkUser = $pdo->prepare('SELECT accountID FROM accounts WHERE userName = ? LIMIT 1');
    $chkUser->execute([$userName]);
    if ($chkUser->fetchColumn() !== false) {
        echo '-2';
        return;
    }

    if ($email !== '') {
        $chkEmail = $pdo->prepare('SELECT accountID FROM accounts WHERE email = ? LIMIT 1');
        $chkEmail->execute([$email]);
        if ($chkEmail->fetchColumn() !== false) {
            echo '-3';
            return;
        }
    }

    $passwordHash = password_hash($password, PASSWORD_BCRYPT);
    $gjp2Hash = password_hash(generateGjp2($password), PASSWORD_BCRYPT);
    $now = time();

    $pdo->beginTransaction();

    $insAcc = $pdo->prepare(
        'INSERT INTO accounts (userName, passwordHash, gjp2Hash, email, secret, isActive, registerDate)
         VALUES (?, ?, ?, ?, ?, 1, ?)'
    );
    $insAcc->execute([$userName, $passwordHash, $gjp2Hash, $email, $secret, $now]);
    $accountID = (int)$pdo->lastInsertId();

    $insUser = $pdo->prepare(
        'INSERT INTO users (accountID, extID, udid, userName, lastPlayed, ip)
         VALUES (?, ?, ?, ?, ?, ?)'
    );
    $insUser->execute([$accountID, (string)$accountID, '', $userName, $now, gdClientIp()]);

    $pdo->commit();
    echo '1';
} catch (Throwable $e) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo '-1';
}
