<?php
declare(strict_types=1);

/**
 * GD Upload Account Profile Comment Endpoint (GD 2.0 - 2.2)
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

$comment = gdCleanString(gdParam('comment', ''));
if ($comment === '') {
    echo '-1';
    return;
}

$ins = $pdo->prepare(
    'INSERT INTO account_comments (accountID, userID, comment, likes, isSpam, timestamp)
     VALUES (?, ?, ?, 0, 0, ?)'
);
$ins->execute([
    (int)$user['accountID'],
    (int)$user['userID'],
    $comment,
    time(),
]);

echo '1';
