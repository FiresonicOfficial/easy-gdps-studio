<?php
declare(strict_types=1);

/**
 * Shared Level Upload Handler (GD 1.0 - 2.2)
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/gd_crypto.php';

function handleLevelUpload(int $protocolVersion): void
{
    header('Content-Type: text/plain; charset=utf-8');

    $pdo = getDb();
    $user = resolveRequestUser($pdo, $protocolVersion < 20 || gdIntParam('accountID', 0) <= 0);
    if ($user === null) {
        echo '-1';
        return;
    }

    if ((int)($user['isCreatorBanned'] ?? 0) === 1) {
        echo '-1';
        return;
    }

    $levelString = gdParam('levelString', '');
    $levelName = gdCleanString(gdParam('levelName', ''));
    if ($levelString === '' || $levelName === '') {
        echo '-1';
        return;
    }

    $levelID = gdIntParam('levelID', 0);
    $userID = (int)$user['userID'];
    $extID = (string)$user['extID'];
    $userName = (string)$user['userName'];
    $levelDesc = gdCleanString(gdParam('levelDesc', ''));
    $levelVersion = max(1, gdIntParam('levelVersion', 1));
    $levelLength = max(0, gdIntParam('levelLength', 0));
    $audioTrack = max(0, gdIntParam('audioTrack', 0));
    $auto = gdIntParam('auto', 0) ? 1 : 0;
    $password = gdCleanString(gdParam('password', '0'));
    if ($password === '') {
        $password = '0';
    }
    $original = max(0, gdIntParam('original', 0));
    $twoPlayer = gdIntParam('twoPlayer', 0) ? 1 : 0;
    $songID = max(0, gdIntParam('songID', 0));
    $songIDs = gdCleanString(gdParam('songIDs', ''));
    $sfxIDs = gdCleanString(gdParam('sfxIDs', ''));
    $objects = max(0, gdIntParam('objects', 0));
    $coins = max(0, min(3, gdIntParam('coins', 0)));
    $requestedStars = max(0, min(10, gdIntParam('requestedStars', 0)));
    $extraString = gdCleanString(gdParam('extraString', ''));
    $levelInfo = gdCleanString(gdParam('levelInfo', ''));
    $secret = gdCleanString(gdParam('secret', ''));
    $gameVersion = max(1, gdIntParam('gameVersion', $protocolVersion > 0 ? $protocolVersion : 21));
    $binaryVersion = max(1, gdIntParam('binaryVersion', 35));
    $ldm = gdIntParam('ldm', 0) ? 1 : 0;
    $wt = max(0, gdIntParam('wt', 0));
    $wt2 = max(0, gdIntParam('wt2', 0));
    $ts = max(0, gdIntParam('ts', 0));
    $unlisted = gdIntParam('unlisted', 0) ? 1 : 0;
    $unlisted2 = gdIntParam('unlisted2', 0) ? 1 : 0;
    $friendsOnly = gdIntParam('friendsOnly', 0) ? 1 : 0;
    $now = time();
    $ip = gdClientIp();

    if ($levelID > 0) {
        $chk = $pdo->prepare('SELECT levelID, userID, extID FROM levels WHERE levelID = ? AND isDeleted = 0 LIMIT 1');
        $chk->execute([$levelID]);
        $existing = $chk->fetch();

        if ($existing === false || (int)$existing['userID'] !== $userID) {
            echo '-1';
            return;
        }

        $upd = $pdo->prepare(
            'UPDATE levels SET
                userName = ?,
                levelName = ?,
                levelDesc = ?,
                levelVersion = ?,
                levelLength = ?,
                audioTrack = ?,
                auto = ?,
                password = ?,
                original = ?,
                twoPlayer = ?,
                songID = ?,
                songIDs = ?,
                sfxIDs = ?,
                objects = ?,
                coins = ?,
                requestedStars = ?,
                extraString = ?,
                levelInfo = ?,
                secret = ?,
                gameVersion = ?,
                binaryVersion = ?,
                ldm = ?,
                wt = ?,
                wt2 = ?,
                ts = ?,
                unlisted = ?,
                unlisted2 = ?,
                friendsOnly = ?,
                updateDate = ?,
                hostname = ?
            WHERE levelID = ? AND userID = ?'
        );
        $upd->execute([
            $userName,
            $levelName,
            $levelDesc,
            $levelVersion,
            $levelLength,
            $audioTrack,
            $auto,
            $password,
            $original,
            $twoPlayer,
            $songID,
            $songIDs,
            $sfxIDs,
            $objects,
            $coins,
            $requestedStars,
            $extraString,
            $levelInfo,
            $secret,
            $gameVersion,
            $binaryVersion,
            $ldm,
            $wt,
            $wt2,
            $ts,
            $unlisted,
            $unlisted2,
            $friendsOnly,
            $now,
            $ip,
            $levelID,
            $userID,
        ]);

        ensureGdpsDirectories();
        $levelFile = GDPS_LEVELS_DIR . '/' . $levelID;
        if (file_put_contents($levelFile, $levelString, LOCK_EX) === false) {
            echo '-1';
            return;
        }

        echo (string)$levelID;
        return;
    }

    $ins = $pdo->prepare(
        'INSERT INTO levels (
            extID, userID, userName, levelName, levelDesc, levelVersion, levelLength,
            audioTrack, auto, password, original, twoPlayer, songID, songIDs, sfxIDs,
            objects, coins, requestedStars, extraString, levelInfo, secret,
            gameVersion, binaryVersion, ldm, wt, wt2, ts,
            unlisted, unlisted2, friendsOnly, uploadDate, updateDate, hostname
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?
        )'
    );
    $ins->execute([
        $extID,
        $userID,
        $userName,
        $levelName,
        $levelDesc,
        $levelVersion,
        $levelLength,
        $audioTrack,
        $auto,
        $password,
        $original,
        $twoPlayer,
        $songID,
        $songIDs,
        $sfxIDs,
        $objects,
        $coins,
        $requestedStars,
        $extraString,
        $levelInfo,
        $secret,
        $gameVersion,
        $binaryVersion,
        $ldm,
        $wt,
        $wt2,
        $ts,
        $unlisted,
        $unlisted2,
        $friendsOnly,
        $now,
        $now,
        $ip,
    ]);

    $newLevelID = (int)$pdo->lastInsertId();
    ensureGdpsDirectories();
    $levelFile = GDPS_LEVELS_DIR . '/' . $newLevelID;
    if (file_put_contents($levelFile, $levelString, LOCK_EX) === false) {
        $del = $pdo->prepare('DELETE FROM levels WHERE levelID = ?');
        $del->execute([$newLevelID]);
        echo '-1';
        return;
    }

    echo (string)$newLevelID;
}
