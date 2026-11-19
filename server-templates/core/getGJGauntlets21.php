<?php
declare(strict_types=1);

/**
 * GD Gauntlets Endpoint (GD 2.1 - 2.2)
 * Version-gated: returns -1 on GD versions < 2.1.
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$caps = getServerCapabilities();
if (!$caps['supportsGauntlets'] || (int)$caps['maxGauntletId'] <= 0) {
    echo '-1';
    return;
}

$pdo = getDb();
$stmt = $pdo->prepare(
    'SELECT ID, level1, level2, level3, level4, level5
     FROM gauntlets
     WHERE ID >= 1
       AND ID <= ?
       AND level1 > 0
       AND level2 > 0
       AND level3 > 0
       AND level4 > 0
       AND level5 > 0
     ORDER BY ID ASC'
);
$stmt->execute([(int)$caps['maxGauntletId']]);
$rows = $stmt->fetchAll();

if ($rows === []) {
    echo '#' . generateSolo3Hash('');
    return;
}

// Verify every referenced level exists and is not deleted so GD never crashes on a missing level
$allLevelIds = [];
foreach ($rows as $row) {
    $allLevelIds[(int)$row['level1']] = true;
    $allLevelIds[(int)$row['level2']] = true;
    $allLevelIds[(int)$row['level3']] = true;
    $allLevelIds[(int)$row['level4']] = true;
    $allLevelIds[(int)$row['level5']] = true;
}

$idList = array_keys($allLevelIds);
$placeholders = implode(',', array_fill(0, count($idList), '?'));
$checkStmt = $pdo->prepare(
    "SELECT levelID FROM levels WHERE isDeleted = 0 AND levelID IN ({$placeholders})"
);
$checkStmt->execute($idList);
$validLevelSet = [];
foreach ($checkStmt->fetchAll(PDO::FETCH_COLUMN) as $validId) {
    $validLevelSet[(int)$validId] = true;
}

$entries = [];
$hashInput = '';
foreach ($rows as $row) {
    $l1 = (int)$row['level1'];
    $l2 = (int)$row['level2'];
    $l3 = (int)$row['level3'];
    $l4 = (int)$row['level4'];
    $l5 = (int)$row['level5'];

    if (
        !isset($validLevelSet[$l1]) ||
        !isset($validLevelSet[$l2]) ||
        !isset($validLevelSet[$l3]) ||
        !isset($validLevelSet[$l4]) ||
        !isset($validLevelSet[$l5])
    ) {
        continue;
    }

    $id = (int)$row['ID'];
    $levelsCsv = implode(',', [$l1, $l2, $l3, $l4, $l5]);
    $entries[] = '1:' . $id . ':3:' . $levelsCsv;
    $hashInput .= $id . $levelsCsv;
}

if ($entries === []) {
    echo '#' . generateSolo3Hash('');
    return;
}

echo implode('|', $entries) . '#' . generateSolo3Hash($hashInput);
