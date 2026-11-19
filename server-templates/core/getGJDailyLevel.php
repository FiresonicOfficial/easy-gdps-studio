<?php
declare(strict_types=1);

/**
 * GD Daily / Weekly / Event Level Endpoint (GD 2.1 - 2.2)
 * Returns: "<feaID>|<secondsRemaining>" or "-1" if none configured.
 */

require_once __DIR__ . '/config.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$type = gdIntParam('type', -1);
if ($type < 0) {
    $type = gdIntParam('weekly', 0) === 1 ? 1 : 0;
}

$now = time();
$stmt = $pdo->prepare(
    'SELECT feaID, levelID, timestamp FROM daily_features WHERE type = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1'
);
$stmt->execute([$type, $now]);
$row = $stmt->fetch();

if ($row === false) {
    echo '-1';
    return;
}

$duration = $type === 1 ? 604800 : 86400;
$expiresAt = (int)$row['timestamp'] + $duration;
$secondsLeft = max(1, $expiresAt - $now);
$feaID = (int)$row['feaID'] + ($type === 1 ? 100001 : 0);

echo $feaID . '|' . $secondsLeft;
