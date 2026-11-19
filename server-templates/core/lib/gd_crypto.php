<?php
declare(strict_types=1);

/**
 * Geometry Dash Protocol Cryptography & User Helpers (GD 1.0 - 2.2)
 */

/**
 * Repeating-key XOR cipher used by Geometry Dash (GJP, level password, etc.).
 */
function xorCipher(string $data, string $key): string
{
    $keyLen = strlen($key);
    if ($keyLen === 0 || $data === '') {
        return $data;
    }

    $out = '';
    $dataLen = strlen($data);
    for ($i = 0; $i < $dataLen; $i++) {
        $out .= $data[$i] ^ $key[$i % $keyLen];
    }
    return $out;
}

/**
 * URL-safe Base64 encode (+/ -> -_).
 */
function gdBase64UrlEncode(string $data): string
{
    return strtr(base64_encode($data), '+/', '-_');
}

/**
 * URL-safe Base64 decode (-_ -> +/).
 */
function gdBase64UrlDecode(string $data): string
{
    if ($data === '') {
        return '';
    }
    $normalized = strtr($data, '-_', '+/');
    $pad = strlen($normalized) % 4;
    if ($pad > 0) {
        $normalized .= str_repeat('=', 4 - $pad);
    }
    $decoded = base64_decode($normalized, false);
    return $decoded === false ? '' : $decoded;
}

/**
 * Strictly determine whether a stored string is valid Base64url-encoded printable UTF-8 text.
 * Rejects short or plain English strings such as "hi", "test", "cool", or "hello world".
 */
function gdLooksLikeBase64UrlText(string $str): bool
{
    $len = strlen($str);
    if ($len < 4 || ($len % 4) === 1) {
        return false;
    }
    if (!preg_match('/^[A-Za-z0-9+_-]+={0,2}$/', $str)) {
        return false;
    }
    if (str_contains($str, '=') && ($len % 4) !== 0) {
        return false;
    }

    $decoded = gdBase64UrlDecode($str);
    if ($decoded === '') {
        return false;
    }

    $normalizedInput = rtrim(strtr($str, '+/', '-_'), '=');
    $reencoded = rtrim(gdBase64UrlEncode($decoded), '=');
    if (!hash_equals($reencoded, $normalizedInput)) {
        return false;
    }

    if (!mb_check_encoding($decoded, 'UTF-8')) {
        return false;
    }

    // Reject control characters and DEL so random binary from plain words is never accepted
    if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $decoded)) {
        return false;
    }

    return true;
}

/**
 * Decode a stored comment (Base64url or legacy plaintext) into plaintext for < 2.0 clients & Admin API.
 */
function gdDecodeStoredCommentToPlain(string $stored): string
{
    if ($stored === '') {
        return '';
    }
    if (gdLooksLikeBase64UrlText($stored)) {
        return gdBase64UrlDecode($stored);
    }
    return $stored;
}

/**
 * Encode a stored comment (Base64url or legacy plaintext) into Base64url for >= 2.0 clients.
 */
function gdEncodeStoredCommentToBase64(string $stored): string
{
    if ($stored === '') {
        return '';
    }
    if (gdLooksLikeBase64UrlText($stored)) {
        return gdBase64UrlEncode(gdBase64UrlDecode($stored));
    }
    return gdBase64UrlEncode($stored);
}

/**
 * Safely decode GD base64url text for Admin API display; preserves plain text (1.0-1.9).
 */
function gdSafeBase64DecodeForDisplay(string $str): string
{
    return gdDecodeStoredCommentToPlain($str);
}

/**
 * Generate GD Solo SHA1 hash from levelString (40 evenly sampled chars + salt).
 */
function generateSoloHash(string $levelString): string
{
    $len = strlen($levelString);
    if ($len < 41) {
        return sha1($levelString . 'xI25fpAapCQg');
    }

    $hash = '';
    $step = intdiv($len, 40);
    for ($i = 0; $i < 40; $i++) {
        $hash .= $levelString[$i * $step];
    }
    return sha1($hash . 'xI25fpAapCQg');
}

/**
 * Generate GD Solo2 SHA1 hash.
 * Accepts either a pre-built string or an array of level rows from getGJLevels.
 */
function generateSolo2Hash(string|array $objects): string
{
    if (is_array($objects)) {
        $acc = '';
        foreach ($objects as $lvl) {
            $idStr = (string)($lvl['levelID'] ?? '0');
            $first = $idStr[0] ?? '0';
            $last = $idStr[strlen($idStr) - 1] ?? '0';
            $stars = (int)($lvl['starStars'] ?? 0);
            $coins = (int)($lvl['starCoins'] ?? 0);
            $acc .= $first . $last . $stars . $coins;
        }
        return sha1($acc . 'xI25fpAapCQg');
    }

    return sha1($objects . 'xI25fpAapCQg');
}

/**
 * Generate GD Solo3 SHA1 hash (Gauntlets / Lists).
 */
function generateSolo3Hash(string $data): string
{
    return sha1($data . 'xI25fpAapCQg');
}

/**
 * Generate GD Solo4 SHA1 hash (Map Packs).
 */
function generateSolo4Hash(array $packs): string
{
    $acc = '';
    foreach ($packs as $pack) {
        $idStr = (string)($pack['ID'] ?? '0');
        $first = $idStr[0] ?? '0';
        $last = $idStr[strlen($idStr) - 1] ?? '0';
        $stars = (int)($pack['stars'] ?? 0);
        $coins = (int)($pack['coins'] ?? 0);
        $acc .= $first . $last . $stars . $coins;
    }
    return sha1($acc . 'xI25fpAapCQg');
}

/**
 * Generate GD 2.2 GJP2 hash from plaintext password.
 */
function generateGjp2(string $password): string
{
    return sha1($password . 'mI29fmAnxgTs');
}

/**
 * Verify plaintext password, GJP1 (XOR 37526 + base64), or GJP2 (SHA1) against stored hash(es).
 */
function verifyAccountPassword(string $plainOrGjp, string $storedHash, ?string $storedGjp2Hash = null): bool
{
    if ($plainOrGjp === '' || $storedHash === '') {
        return false;
    }

    // 1. Direct match against primary password hash (plaintext password or gjp2 if stored directly)
    if (password_verify($plainOrGjp, $storedHash)) {
        return true;
    }

    // 2. Match against stored GJP2 bcrypt hash (GD 2.2 clients send gjp2)
    if ($storedGjp2Hash !== null && $storedGjp2Hash !== '') {
        if (password_verify($plainOrGjp, $storedGjp2Hash)) {
            return true;
        }
        if (password_verify(generateGjp2($plainOrGjp), $storedGjp2Hash)) {
            return true;
        }
    }

    // 3. Try decoding GJP1 (GD 2.0 / 2.1 / 2.11): base64url -> XOR "37526"
    $decodedRaw = gdBase64UrlDecode($plainOrGjp);
    if ($decodedRaw !== '') {
        $decodedPassword = xorCipher($decodedRaw, '37526');
        if ($decodedPassword !== '' && password_verify($decodedPassword, $storedHash)) {
            return true;
        }
        if (
            $storedGjp2Hash !== null &&
            $storedGjp2Hash !== '' &&
            $decodedPassword !== '' &&
            password_verify(generateGjp2($decodedPassword), $storedGjp2Hash)
        ) {
            return true;
        }
    }

    // 4. Legacy raw SHA1 hex fallback if caller passed a raw GJP2 hash as $storedHash
    if (strlen($storedHash) === 40 && ctype_xdigit($storedHash)) {
        if (hash_equals(strtolower($storedHash), strtolower($plainOrGjp))) {
            return true;
        }
        if (hash_equals(strtolower($storedHash), strtolower(generateGjp2($plainOrGjp)))) {
            return true;
        }
    }

    return false;
}

/**
 * Strip GD protocol delimiter characters (:, #, |, ~, newlines, NUL).
 */
function gdCleanString(string $str): string
{
    $cleaned = str_replace([':', '#', '|', '~', "\r", "\n", "\0"], '', $str);
    return trim($cleaned);
}

/**
 * Format Unix timestamp into RobTop-style relative time string.
 */
function gdRelativeTime(int $timestamp): string
{
    if ($timestamp <= 0) {
        return '1 second';
    }
    $diff = max(1, time() - $timestamp);
    $units = [
        31536000 => 'year',
        2592000 => 'month',
        604800 => 'week',
        86400 => 'day',
        3600 => 'hour',
        60 => 'minute',
        1 => 'second',
    ];
    foreach ($units as $secs => $label) {
        if ($diff >= $secs) {
            $count = intdiv($diff, $secs);
            return $count . ' ' . $label . ($count === 1 ? '' : 's');
        }
    }
    return '1 second';
}

/**
 * Look up or create a legacy user record (GD 1.0 - 1.9 without accountID).
 */
function getUserOrCreateLegacyUser(PDO $pdo, string $udid, string $userName): array
{
    $cleanUdid = gdCleanString($udid);
    $cleanName = gdCleanString($userName);
    if ($cleanName === '') {
        $cleanName = 'Player';
    }
    if ($cleanUdid === '') {
        $cleanUdid = 'legacy_' . md5(gdClientIp() . '_' . $cleanName);
    }

    $stmt = $pdo->prepare('SELECT * FROM users WHERE (extID = ? OR udid = ?) AND accountID = 0 LIMIT 1');
    $stmt->execute([$cleanUdid, $cleanUdid]);
    $user = $stmt->fetch();

    if ($user !== false) {
        if ($cleanName !== 'Player' && $user['userName'] !== $cleanName) {
            $upd = $pdo->prepare('UPDATE users SET userName = ?, lastPlayed = ?, ip = ? WHERE userID = ?');
            $upd->execute([$cleanName, time(), gdClientIp(), (int)$user['userID']]);
            $user['userName'] = $cleanName;
        } else {
            $upd = $pdo->prepare('UPDATE users SET lastPlayed = ?, ip = ? WHERE userID = ?');
            $upd->execute([time(), gdClientIp(), (int)$user['userID']]);
        }
        return $user;
    }

    $ins = $pdo->prepare(
        'INSERT INTO users (accountID, extID, udid, userName, lastPlayed, ip) VALUES (0, ?, ?, ?, ?, ?)'
    );
    $ins->execute([$cleanUdid, $cleanUdid, $cleanName, time(), gdClientIp()]);
    $newId = (int)$pdo->lastInsertId();

    $fetch = $pdo->prepare('SELECT * FROM users WHERE userID = ? LIMIT 1');
    $fetch->execute([$newId]);
    $created = $fetch->fetch();

    return $created !== false ? $created : [
        'userID' => $newId,
        'accountID' => 0,
        'extID' => $cleanUdid,
        'udid' => $cleanUdid,
        'userName' => $cleanName,
        'isMod' => 0,
        'modBadge' => 0,
        'isBanned' => 0,
    ];
}

/**
 * Authenticate a GD 2.0 - 2.2 account request using accountID + gjp2/gjp/password.
 * Returns null on invalid credentials, disabled account, or banned user.
 */
function authenticateAccountRequest(PDO $pdo): ?array
{
    $accountID = gdIntParam('accountID', 0);
    if ($accountID <= 0) {
        return null;
    }

    $credential = gdParam('gjp2', '');
    if ($credential === '') {
        $credential = gdParam('gjp', '');
    }
    if ($credential === '') {
        $credential = gdParam('password', '');
    }
    if ($credential === '') {
        return null;
    }

    $stmt = $pdo->prepare('SELECT * FROM accounts WHERE accountID = ? LIMIT 1');
    $stmt->execute([$accountID]);
    $account = $stmt->fetch();
    if ($account === false || (int)$account['isActive'] === 0) {
        return null;
    }

    if (!verifyAccountPassword($credential, (string)$account['passwordHash'], (string)$account['gjp2Hash'])) {
        return null;
    }

    $uStmt = $pdo->prepare('SELECT * FROM users WHERE accountID = ? LIMIT 1');
    $uStmt->execute([$accountID]);
    $user = $uStmt->fetch();

    if ($user === false) {
        $ins = $pdo->prepare(
            'INSERT INTO users (accountID, extID, udid, userName, lastPlayed, ip) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $accountID,
            (string)$accountID,
            gdCleanString(gdParam('udid', '')),
            (string)$account['userName'],
            time(),
            gdClientIp(),
        ]);
        $userID = (int)$pdo->lastInsertId();
        $uStmt2 = $pdo->prepare('SELECT * FROM users WHERE userID = ? LIMIT 1');
        $uStmt2->execute([$userID]);
        $user = $uStmt2->fetch();
    }

    if ($user === false || (int)$user['isBanned'] === 1) {
        return null;
    }

    $user['isAdmin'] = (int)$account['isAdmin'];
    $user['accountUserName'] = (string)$account['userName'];
    return $user;
}

/**
 * Resolve user for both authenticated 2.0-2.2 requests and legacy 1.0-1.9 udid requests.
 */
function resolveRequestUser(PDO $pdo, bool $allowLegacy = true): ?array
{
    $accountID = gdIntParam('accountID', 0);
    if ($accountID > 0) {
        return authenticateAccountRequest($pdo);
    }

    if (!$allowLegacy) {
        return null;
    }

    $udid = gdCleanString(gdParam('udid', ''));
    $userName = gdCleanString(gdParam('userName', 'Player'));
    if ($udid === '' && $userName === '') {
        return null;
    }

    $user = getUserOrCreateLegacyUser($pdo, $udid, $userName);
    if ((int)($user['isBanned'] ?? 0) === 1) {
        return null;
    }
    return $user;
}

/**
 * Recalculate creatorPoints for a user based on their non-deleted rated levels.
 */
function recalculateCreatorPoints(PDO $pdo, int $userID): void
{
    if ($userID <= 0) {
        return;
    }

    $stmt = $pdo->prepare(
        'SELECT starStars, starFeatured, starEpic FROM levels WHERE userID = ? AND isDeleted = 0'
    );
    $stmt->execute([$userID]);
    $rows = $stmt->fetchAll();

    $cp = 0;
    foreach ($rows as $row) {
        if ((int)$row['starStars'] > 0) {
            $cp += 1;
        }
        if ((int)$row['starFeatured'] > 0) {
            $cp += 1;
        }
        $epic = (int)$row['starEpic'];
        if ($epic > 0) {
            $cp += $epic;
        }
    }

    $upd = $pdo->prepare('UPDATE users SET creatorPoints = ? WHERE userID = ?');
    $upd->execute([$cp, $userID]);
}
