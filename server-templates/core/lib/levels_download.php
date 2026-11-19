<?php
declare(strict_types=1);

/**
 * Shared Level Download Handler (GD 1.0 - 2.2)
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/gd_crypto.php';

function handleLevelDownload(int $protocolVersion): void
{
    header('Content-Type: text/plain; charset=utf-8');

    $pdo = getDb();
    $requestedId = gdIntParam('levelID', 0);
    $feaID = 0;

    // -1 = Daily level, -2 = Weekly demon
    if ($requestedId === -1 || $requestedId === -2) {
        $dailyType = $requestedId === -2 ? 1 : 0;
        $dStmt = $pdo->prepare(
            'SELECT feaID, levelID FROM daily_features WHERE type = ? AND timestamp <= ? ORDER BY timestamp DESC LIMIT 1'
        );
        $dStmt->execute([$dailyType, time()]);
        $daily = $dStmt->fetch();
        if ($daily === false) {
            echo '-1';
            return;
        }
        $levelID = (int)$daily['levelID'];
        $feaID = (int)$daily['feaID'] + ($dailyType === 1 ? 100001 : 0);
    } else {
        $levelID = $requestedId;
    }

    if ($levelID <= 0) {
        echo '-1';
        return;
    }

    $stmt = $pdo->prepare('SELECT * FROM levels WHERE levelID = ? AND isDeleted = 0 LIMIT 1');
    $stmt->execute([$levelID]);
    $level = $stmt->fetch();

    if ($level === false) {
        echo '-1';
        return;
    }

    $levelFile = GDPS_LEVELS_DIR . '/' . $levelID;
    if (!is_file($levelFile)) {
        echo '-1';
        return;
    }

    $levelString = file_get_contents($levelFile);
    if ($levelString === false || $levelString === '') {
        echo '-1';
        return;
    }

    $upd = $pdo->prepare('UPDATE levels SET downloads = downloads + 1 WHERE levelID = ?');
    $upd->execute([$levelID]);
    $downloads = (int)$level['downloads'] + 1;

    $xorPassword = gdBase64UrlEncode(xorCipher((string)$level['password'], '26364'));
    $denom = ((int)$level['starDifficulty'] > 0 || (int)$level['starAuto'] === 1 || (int)$level['starDemon'] === 1) ? 10 : 0;

    $fields = [
        '1' => (int)$level['levelID'],
        '2' => (string)$level['levelName'],
        '3' => (string)$level['levelDesc'],
        '4' => $levelString,
        '5' => (int)$level['levelVersion'],
        '6' => (int)$level['userID'],
        '8' => $denom,
        '9' => (int)$level['starDifficulty'],
        '10' => $downloads,
        '11' => 1,
        '12' => (int)$level['audioTrack'],
        '13' => (int)$level['gameVersion'],
        '14' => (int)$level['likes'],
        '15' => (int)$level['levelLength'],
        '17' => (int)$level['starDemon'],
        '18' => (int)$level['starStars'],
        '19' => (int)$level['starFeatured'],
        '25' => (int)$level['starAuto'],
        '28' => gdRelativeTime((int)$level['uploadDate']),
        '29' => gdRelativeTime((int)$level['updateDate']),
        '30' => (int)$level['original'],
        '31' => (int)$level['twoPlayer'],
        '35' => (int)$level['songID'],
        '36' => (string)$level['extraString'],
        '37' => (int)$level['coins'],
        '38' => (int)$level['starCoins'],
        '39' => (int)$level['requestedStars'],
        '40' => (int)$level['ldm'],
        '42' => (int)$level['starEpic'],
        '43' => (int)$level['starDemonDiff'],
        '45' => (int)$level['objects'],
        '46' => (int)$level['wt'],
        '47' => (int)$level['wt2'],
        '48' => 1,
    ];

    if ($protocolVersion >= 19) {
        $fields['27'] = $xorPassword;
    }

    if ($feaID > 0) {
        $fields['41'] = $feaID;
    }

    if ($protocolVersion >= 21) {
        $fields['52'] = (string)$level['songIDs'];
        $fields['53'] = (string)$level['sfxIDs'];
        $fields['57'] = (int)$level['ts'];
    }

    $pairs = [];
    foreach ($fields as $k => $v) {
        $pairs[] = $k . ':' . $v;
    }
    $response = implode(':', $pairs);

    if ($protocolVersion <= 18) {
        echo $response;
        return;
    }

    $soloHash = generateSoloHash($levelString);
    if ($protocolVersion === 19) {
        echo $response . '#' . $soloHash;
        return;
    }

    $solo2Input = sprintf(
        '%d,%d,%d,%d,%d,%d,%s,%d',
        (int)$level['userID'],
        (int)$level['starStars'],
        (int)$level['starDemon'],
        (int)$level['levelID'],
        (int)$level['starCoins'],
        (int)$level['starFeatured'],
        (string)$level['password'],
        $feaID
    );
    $solo2Hash = generateSolo2Hash($solo2Input);

    if ($feaID > 0) {
        $ext = (string)$level['extID'] !== '' ? (string)$level['extID'] : (string)$level['userID'];
        $creatorStr = (int)$level['userID'] . ':' . gdCleanString((string)$level['userName']) . ':' . $ext;
        $songStr = '';
        if ((int)$level['songID'] > 0) {
            $sStmt = $pdo->prepare('SELECT * FROM songs WHERE ID = ? AND isDisabled = 0 LIMIT 1');
            $sStmt->execute([(int)$level['songID']]);
            $s = $sStmt->fetch();
            if ($s !== false) {
                $songStr = implode('~|~', [
                    '1', (int)$s['ID'],
                    '2', gdCleanString((string)$s['name']),
                    '3', (int)$s['authorID'],
                    '4', gdCleanString((string)$s['authorName']),
                    '5', (string)$s['size'],
                    '6', (string)$s['hash'],
                    '10', rawurlencode((string)$s['download']),
                    '7', '',
                    '8', '1',
                ]);
            }
        }
        echo $response . '#' . $soloHash . '#' . $solo2Hash . '#' . $creatorStr . '#' . $songStr;
        return;
    }

    echo $response . '#' . $soloHash . '#' . $solo2Hash;
}
