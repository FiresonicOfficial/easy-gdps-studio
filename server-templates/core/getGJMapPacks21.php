<?php
declare(strict_types=1);

/**
 * GD Map Packs Endpoint (GD 1.6 - 2.2)
 * Version-gated: returns -1 on GD versions < 1.6.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$caps = getServerCapabilities();
if (!$caps['supportsMapPacks']) {
    echo '-1';
    return;
}

$pdo = getDb();
$page = max(0, gdIntParam('page', 0));
$pageSize = 10;
$offset = $page * $pageSize;

$cStmt = $pdo->prepare('SELECT COUNT(*) FROM mappacks');
$cStmt->execute();
$total = (int)$cStmt->fetchColumn();

if ($total === 0) {
    echo '#0:' . $offset . ':' . $pageSize . '#' . generateSolo4Hash([]);
    return;
}

$stmt = $pdo->prepare('SELECT * FROM mappacks ORDER BY ID ASC LIMIT ? OFFSET ?');
$stmt->execute([$pageSize, $offset]);
$rows = $stmt->fetchAll();

if ($rows === []) {
    echo '#' . $total . ':' . $offset . ':' . $pageSize . '#' . generateSolo4Hash([]);
    return;
}

$entries = [];
foreach ($rows as $pack) {
    $rgb = gdCleanString((string)$pack['rgbcolors']);
    if ($rgb === '') {
        $rgb = '255,255,255';
    }

    $colors2Raw = gdCleanString((string)$pack['colors2']);
    $colors2 = ($colors2Raw === '' || strtolower($colors2Raw) === 'none') ? $rgb : $colors2Raw;

    $entries[] = implode(':', [
        '1', (int)$pack['ID'],
        '2', gdCleanString((string)$pack['name']),
        '3', gdCleanString((string)$pack['levels']),
        '4', (int)$pack['stars'],
        '5', (int)$pack['coins'],
        '6', (int)$pack['difficulty'],
        '7', $rgb,
        '8', $colors2,
    ]);
}

echo implode('|', $entries) . '#' . $total . ':' . $offset . ':' . $pageSize . '#' . generateSolo4Hash($rows);
