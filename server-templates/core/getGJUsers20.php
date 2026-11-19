<?php
declare(strict_types=1);

/**
 * GD User Search Endpoint (GD 1.0 - 2.2)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$str = trim(gdParam('str', ''));
$page = max(0, gdIntParam('page', 0));
$pageSize = 10;
$offset = $page * $pageSize;

$where = 'isBanned = 0';
$params = [];

if ($str !== '') {
    if (ctype_digit($str)) {
        $where .= ' AND (userID = ? OR accountID = ? OR userName LIKE ?)';
        $params[] = (int)$str;
        $params[] = (int)$str;
        $params[] = '%' . $str . '%';
    } else {
        $where .= ' AND userName LIKE ?';
        $params[] = '%' . $str . '%';
    }
}

$cStmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE {$where}");
$cStmt->execute($params);
$total = (int)$cStmt->fetchColumn();

if ($total === 0) {
    echo '#0:' . $offset . ':' . $pageSize;
    return;
}

$queryParams = $params;
$queryParams[] = $pageSize;
$queryParams[] = $offset;
$stmt = $pdo->prepare("SELECT * FROM users WHERE {$where} ORDER BY stars DESC, userID ASC LIMIT ? OFFSET ?");
$stmt->execute($queryParams);
$rows = $stmt->fetchAll();

$entries = [];
foreach ($rows as $u) {
    $ext = (string)$u['extID'] !== '' ? (string)$u['extID'] : (string)$u['userID'];
    $entries[] = implode(':', [
        '1', gdCleanString((string)$u['userName']),
        '2', (int)$u['userID'],
        '3', (int)$u['stars'],
        '4', (int)$u['demons'],
        '8', (int)$u['creatorPoints'],
        '9', (int)$u['icon'],
        '10', (int)$u['color1'],
        '11', (int)$u['color2'],
        '13', (int)$u['coins'],
        '14', (int)$u['iconType'],
        '15', (int)$u['special'],
        '16', $ext,
        '17', (int)$u['userCoins'],
    ]);
}

echo implode('|', $entries) . '#' . $total . ':' . $offset . ':' . $pageSize;
