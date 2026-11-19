<?php
declare(strict_types=1);

/**
 * GD Like / Dislike Item Endpoint (GD 1.0 - 2.2)
 * type: 1 = Level, 2 = Level Comment, 3 = Account Comment, 4 = Level List
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$itemID = gdIntParam('itemID', 0);
$type = gdIntParam('type', 1);
$like = gdIntParam('like', 1) === 1 ? 1 : 0;

if ($itemID <= 0 || !in_array($type, [1, 2, 3, 4], true)) {
    echo '-1';
    return;
}

$accountID = gdIntParam('accountID', 0);
$userID = 0;
if ($accountID > 0) {
    $user = authenticateAccountRequest($pdo);
    if ($user === null) {
        echo '-1';
        return;
    }
    $userID = (int)$user['userID'];
}

$ip = gdClientIp();

if ($accountID > 0) {
    $chk = $pdo->prepare('SELECT likeID FROM likes WHERE itemID = ? AND type = ? AND accountID = ? LIMIT 1');
    $chk->execute([$itemID, $type, $accountID]);
} else {
    $chk = $pdo->prepare('SELECT likeID FROM likes WHERE itemID = ? AND type = ? AND ip = ? AND accountID = 0 LIMIT 1');
    $chk->execute([$itemID, $type, $ip]);
}

if ($chk->fetchColumn() !== false) {
    echo '1';
    return;
}

$delta = $like === 1 ? 1 : -1;

$ins = $pdo->prepare(
    'INSERT INTO likes (itemID, type, likeValue, accountID, userID, ip, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)'
);
$ins->execute([$itemID, $type, $like, $accountID, $userID, $ip, time()]);

switch ($type) {
    case 1:
        if ($like === 1) {
            $upd = $pdo->prepare('UPDATE levels SET likes = likes + 1 WHERE levelID = ?');
        } else {
            $upd = $pdo->prepare('UPDATE levels SET likes = likes - 1, dislikes = dislikes + 1 WHERE levelID = ?');
        }
        $upd->execute([$itemID]);
        break;

    case 2:
        $upd = $pdo->prepare('UPDATE comments SET likes = likes + ? WHERE commentID = ?');
        $upd->execute([$delta, $itemID]);
        break;

    case 3:
        $upd = $pdo->prepare('UPDATE account_comments SET likes = likes + ? WHERE commentID = ?');
        $upd->execute([$delta, $itemID]);
        break;

    case 4:
        $upd = $pdo->prepare('UPDATE level_lists SET likes = likes + ? WHERE listID = ?');
        $upd->execute([$delta, $itemID]);
        break;
}

echo '1';
