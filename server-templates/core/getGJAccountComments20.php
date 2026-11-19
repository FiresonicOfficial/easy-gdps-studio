<?php
declare(strict_types=1);

/**
 * GD Get Account Profile Comments Endpoint (GD 2.0 - 2.2)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$accountID = gdIntParam('accountID', 0);
$page = max(0, gdIntParam('page', 0));
$pageSize = 10;
$offset = $page * $pageSize;

if ($accountID <= 0) {
    echo '#0:' . $offset . ':' . $pageSize;
    return;
}

$cStmt = $pdo->prepare('SELECT COUNT(*) FROM account_comments WHERE accountID = ?');
$cStmt->execute([$accountID]);
$total = (int)$cStmt->fetchColumn();

if ($total === 0) {
    echo '#0:' . $offset . ':' . $pageSize;
    return;
}

$stmt = $pdo->prepare(
    'SELECT * FROM account_comments WHERE accountID = ? ORDER BY commentID DESC LIMIT ? OFFSET ?'
);
$stmt->execute([$accountID, $pageSize, $offset]);
$rows = $stmt->fetchAll();

$entries = [];
foreach ($rows as $row) {
    $entries[] = implode('~', [
        '2', gdCleanString((string)$row['comment']),
        '4', (int)$row['likes'],
        '9', gdRelativeTime((int)$row['timestamp']),
        '6', (int)$row['commentID'],
    ]);
}

echo implode('|', $entries) . '#' . $total . ':' . $offset . ':' . $pageSize;
