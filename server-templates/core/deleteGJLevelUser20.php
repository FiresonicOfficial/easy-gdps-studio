<?php
declare(strict_types=1);

/**
 * GD Delete User Level Endpoint (GD 1.0 - 2.2)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$user = resolveRequestUser($pdo, gdIntParam('accountID', 0) <= 0);
if ($user === null) {
    echo '-1';
    return;
}

$levelID = gdIntParam('levelID', 0);
if ($levelID <= 0) {
    echo '-1';
    return;
}

$userID = (int)$user['userID'];
$isAdmin = (int)($user['isAdmin'] ?? 0) === 1;

$stmt = $pdo->prepare('SELECT levelID, userID FROM levels WHERE levelID = ? AND isDeleted = 0 LIMIT 1');
$stmt->execute([$levelID]);
$level = $stmt->fetch();

if ($level === false) {
    echo '-1';
    return;
}

if ((int)$level['userID'] !== $userID && !$isAdmin) {
    echo '-1';
    return;
}

$authorID = (int)$level['userID'];

$del = $pdo->prepare('DELETE FROM levels WHERE levelID = ?');
$del->execute([$levelID]);

$delComments = $pdo->prepare('DELETE FROM comments WHERE levelID = ?');
$delComments->execute([$levelID]);

$delDaily = $pdo->prepare('DELETE FROM daily_features WHERE levelID = ?');
$delDaily->execute([$levelID]);

$levelFile = GDPS_LEVELS_DIR . '/' . $levelID;
if (is_file($levelFile)) {
    @unlink($levelFile);
}

recalculateCreatorPoints($pdo, $authorID);
echo '1';
