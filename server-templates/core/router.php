<?php
declare(strict_types=1);

/**
 * EasyGDPS Studio PHP Built-in Server Router
 * Handles URL padding slashes (/db/////////endpoint.php), /db/ and /database/ prefixes,
 * client downloads (/downloads/<file>), Friend Portal (/), Admin API (/admin_api.php),
 * and GD 1.0 - 2.2 protocol endpoints.
 */

$requestUri = $_SERVER['REQUEST_URI'] ?? '/';
$rawPath = parse_url($requestUri, PHP_URL_PATH);
if (!is_string($rawPath) || $rawPath === '') {
    $rawPath = '/';
}

// Collapse duplicate slashes (critical for binary-padded URLs ending in /////...)
$normalized = preg_replace('#/+#', '/', $rawPath) ?? '/';

// Strip /db/ or /database/ prefix (including repeated slashes)
$normalized = preg_replace('#^/(db|database)(/|$)#', '/', $normalized) ?? '/';

if ($normalized === '' || $normalized[0] !== '/') {
    $normalized = '/' . $normalized;
}

$GLOBALS['GDPS_REQUEST_PATH'] = $normalized;

if ($normalized === '/favicon.ico') {
    http_response_code(204);
    exit;
}

// Serve downloadable client builds from /downloads/<filename>
if (preg_match('#^/downloads/([^/]+)$#', $normalized, $matches)) {
    $requestedName = rawurldecode($matches[1]);
    $safeName = basename($requestedName);

    if (
        $safeName === '' ||
        $safeName === '.' ||
        $safeName === '..' ||
        $safeName !== $requestedName ||
        str_contains($safeName, "\0") ||
        str_contains($safeName, '\\')
    ) {
        http_response_code(400);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Invalid download filename.';
        exit;
    }

    $downloadDirs = [
        __DIR__ . '/../public/downloads',
        __DIR__ . '/../data/downloads',
    ];

    $resolvedFile = null;
    foreach ($downloadDirs as $dir) {
        $dirReal = realpath($dir);
        if ($dirReal === false) {
            continue;
        }
        $candidate = realpath($dirReal . DIRECTORY_SEPARATOR . $safeName);
        if (
            $candidate !== false &&
            is_file($candidate) &&
            str_starts_with($candidate, $dirReal . DIRECTORY_SEPARATOR)
        ) {
            $resolvedFile = $candidate;
            break;
        }
    }

    if ($resolvedFile === null) {
        http_response_code(404);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Download file not found.';
        exit;
    }

    $ext = strtolower(pathinfo($resolvedFile, PATHINFO_EXTENSION));
    $mimeTypes = [
        'apk' => 'application/vnd.android.package-archive',
        'zip' => 'application/zip',
        'exe' => 'application/octet-stream',
    ];
    $contentType = $mimeTypes[$ext] ?? 'application/octet-stream';
    $headerFileName = str_replace(['"', "\r", "\n"], '', $safeName);

    header('Content-Type: ' . $contentType);
    header('Content-Disposition: attachment; filename="' . $headerFileName . '"');
    header('Content-Length: ' . (string)filesize($resolvedFile));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');

    readfile($resolvedFile);
    exit;
}

// Portal & Admin routes
if ($normalized === '/' || $normalized === '/index.php') {
    require __DIR__ . '/index.php';
    exit;
}

if ($normalized === '/admin_api.php') {
    require __DIR__ . '/admin_api.php';
    exit;
}

// Disallow direct HTTP access to internal scripts
$blockedPaths = [
    '/router.php',
    '/config.php',
    '/init_db.php',
];
if (in_array($normalized, $blockedPaths, true) || str_starts_with($normalized, '/lib/')) {
    http_response_code(403);
    echo '-1';
    exit;
}

// Resolve exact PHP endpoint inside core/ or core/accounts/
$coreReal = realpath(__DIR__);
if ($coreReal === false) {
    http_response_code(500);
    echo '-1';
    exit;
}

$targetCandidate = realpath(__DIR__ . $normalized);
if (
    $targetCandidate !== false &&
    is_file($targetCandidate) &&
    str_starts_with($targetCandidate, $coreReal . DIRECTORY_SEPARATOR) &&
    strtolower(pathinfo($targetCandidate, PATHINFO_EXTENSION)) === 'php'
) {
    require $targetCandidate;
    exit;
}

// Version-suffix compatibility aliases for older/intermediate GD clients (1.0 - 2.2)
$legacyAliases = [
    '/accounts/syncGJAccount.php' => '/accounts/syncGJAccountNew.php',
    '/accounts/syncGJAccount20.php' => '/accounts/syncGJAccountNew.php',
    '/accounts/backupGJAccount.php' => '/accounts/backupGJAccountNew.php',
    '/accounts/backupGJAccount20.php' => '/accounts/backupGJAccountNew.php',
    '/deleteGJLevelUser.php' => '/deleteGJLevelUser20.php',
    '/deleteGJLevelUser19.php' => '/deleteGJLevelUser20.php',
    '/getGJScores.php' => '/getGJScores20.php',
    '/getGJScores19.php' => '/getGJScores20.php',
    '/updateGJUserScore.php' => '/updateGJUserScore20.php',
    '/updateGJUserScore19.php' => '/updateGJUserScore20.php',
    '/getGJUsers.php' => '/getGJUsers20.php',
    '/getGJUsers19.php' => '/getGJUsers20.php',
    '/getGJUserInfo.php' => '/getGJUserInfo20.php',
    '/uploadGJComment.php' => '/uploadGJComment21.php',
    '/uploadGJComment19.php' => '/uploadGJComment21.php',
    '/uploadGJComment20.php' => '/uploadGJComment21.php',
    '/getGJComments.php' => '/getGJComments21.php',
    '/getGJComments19.php' => '/getGJComments21.php',
    '/getGJComments20.php' => '/getGJComments21.php',
    '/likeGJItem.php' => '/likeGJItem211.php',
    '/likeGJItem19.php' => '/likeGJItem211.php',
    '/likeGJItem20.php' => '/likeGJItem211.php',
    '/likeGJItem21.php' => '/likeGJItem211.php',
    '/rateGJStars.php' => '/rateGJStars21.php',
    '/rateGJStars19.php' => '/rateGJStars21.php',
    '/rateGJStars20.php' => '/rateGJStars21.php',
    '/rateGJDemon21.php' => '/rateGJStars21.php',
    '/getGJMapPacks.php' => '/getGJMapPacks21.php',
    '/getGJMapPacks19.php' => '/getGJMapPacks21.php',
    '/getGJMapPacks20.php' => '/getGJMapPacks21.php',
    '/getGJGauntlets.php' => '/getGJGauntlets21.php',
    '/getGJGauntlets19.php' => '/getGJGauntlets21.php',
    '/getGJGauntlets20.php' => '/getGJGauntlets21.php',
    '/getGJCreators.php' => '/getGJCreators19.php',
    '/getGJCreators20.php' => '/getGJCreators19.php',
    '/rateGJLevel.php' => '/rateGJStars21.php',
    '/rateGJLevel20.php' => '/rateGJStars21.php',
];

if (isset($legacyAliases[$normalized])) {
    $aliasTarget = realpath(__DIR__ . $legacyAliases[$normalized]);
    if ($aliasTarget !== false && is_file($aliasTarget)) {
        require $aliasTarget;
        exit;
    }
}

// Benign 1.0 - 1.9 acknowledgement endpoints that return '1'
$ackEndpoints = [
    '/reportGJLevel.php',
    '/submitGJUserInfo.php',
    '/restoreGJItems.php',
    '/deleteGJComment.php',
];
if (in_array($normalized, $ackEndpoints, true)) {
    header('Content-Type: text/plain; charset=utf-8');
    echo '1';
    exit;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo '-1';
exit;
