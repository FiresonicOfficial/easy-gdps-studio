<?php
declare(strict_types=1);

/**
 * GD Moderator Access Verification Endpoint (GD 2.0 - 2.2)
 * Returns modBadge (1 or 2) if moderator, or -1 if not.
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

$isMod = (int)($user['isMod'] ?? 0);
$modBadge = (int)($user['modBadge'] ?? 0);
$isAdmin = (int)($user['isAdmin'] ?? 0);

if ($isAdmin === 1 && $modBadge <= 0) {
    $modBadge = 2;
}
if ($isMod > 0 && $modBadge <= 0) {
    $modBadge = min(2, $isMod);
}

if ($modBadge <= 0) {
    echo '-1';
    return;
}

echo (string)$modBadge;
