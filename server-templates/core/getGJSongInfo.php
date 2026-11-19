<?php
declare(strict_types=1);

/**
 * GD Custom Song Info Endpoint (GD 1.9 - 2.2)
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$songID = gdIntParam('songID', 0);
if ($songID <= 0) {
    echo '-1';
    return;
}

$pdo = getDb();
$stmt = $pdo->prepare('SELECT * FROM songs WHERE ID = ? LIMIT 1');
$stmt->execute([$songID]);
$song = $stmt->fetch();

if ($song === false) {
    echo '-1';
    return;
}

if ((int)$song['isDisabled'] === 1) {
    echo '-2';
    return;
}

echo implode('~|~', [
    '1', (int)$song['ID'],
    '2', gdCleanString((string)$song['name']),
    '3', (int)$song['authorID'],
    '4', gdCleanString((string)$song['authorName']),
    '5', (string)$song['size'],
    '6', (string)$song['hash'],
    '10', rawurlencode((string)$song['download']),
    '7', '',
    '8', '1',
]);
