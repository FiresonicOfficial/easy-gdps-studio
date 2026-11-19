<?php
declare(strict_types=1);

/**
 * Shared Level Search Handler (GD 1.0 - 2.2)
 * Supports type:
 *  0 = Search / Query, 1 = Most Downloaded, 2 = Most Liked, 3 = Trending,
 *  4 = Recent, 5 = User Levels, 6 = Featured, 7 = Magic,
 *  10 = Level ID List, 11 = Awarded, 12 = Followed, 13 = Friends, 16 = Hall of Fame
 */

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/gd_crypto.php';

function handleLevelsSearch(int $protocolVersion): void
{
    header('Content-Type: text/plain; charset=utf-8');

    $pdo = getDb();
    $gauntletId = gdIntParam('gauntlet', 0);
    $type = gdIntParam('type', 0);
    $str = trim(gdParam('str', ''));
    $page = max(0, gdIntParam('page', 0));
    $pageSize = 10;
    $offset = $page * $pageSize;
    $orderedIds = [];

    if ($gauntletId > 0) {
        $caps = getServerCapabilities();
        if (!$caps['supportsGauntlets'] || $gauntletId > (int)$caps['maxGauntletId']) {
            echo '-1';
            return;
        }

        $gStmt = $pdo->prepare(
            'SELECT level1, level2, level3, level4, level5 FROM gauntlets WHERE ID = ? LIMIT 1'
        );
        $gStmt->execute([$gauntletId]);
        $gRow = $gStmt->fetch();
        if ($gRow === false) {
            echo '-1';
            return;
        }

        $gLevels = [
            (int)$gRow['level1'],
            (int)$gRow['level2'],
            (int)$gRow['level3'],
            (int)$gRow['level4'],
            (int)$gRow['level5'],
        ];
        foreach ($gLevels as $glId) {
            if ($glId <= 0) {
                echo '-1';
                return;
            }
        }

        $type = 10;
        $str = implode(',', $gLevels);
    }

    $where = ['isDeleted = 0'];
    $params = [];
    $orderBy = 'likes DESC, levelID DESC';
    $allowUnlisted = false;

    // Search type handling
    switch ($type) {
        case 0: // Search
            if ($str !== '') {
                if (ctype_digit($str)) {
                    $where[] = 'levelID = ?';
                    $params[] = (int)$str;
                    $allowUnlisted = true;
                } else {
                    $where[] = 'levelName LIKE ?';
                    $params[] = '%' . $str . '%';
                }
            }
            $orderBy = 'likes DESC, downloads DESC, levelID DESC';
            break;

        case 1: // Most Downloaded
            $orderBy = 'downloads DESC, levelID DESC';
            break;

        case 2: // Most Liked
            $orderBy = 'likes DESC, levelID DESC';
            break;

        case 3: // Trending (last 7 days)
            $where[] = 'uploadDate >= ?';
            $params[] = time() - 604800;
            $orderBy = 'likes DESC, downloads DESC, levelID DESC';
            break;

        case 4: // Recent
            $orderBy = 'levelID DESC';
            break;

        case 5: // User Levels
            $targetUserId = (int)$str;
            if ($targetUserId <= 0) {
                $targetUserId = gdIntParam('userID', 0);
            }
            $where[] = 'userID = ?';
            $params[] = $targetUserId;
            $orderBy = 'levelID DESC';
            $reqAcc = gdIntParam('accountID', 0);
            if ($reqAcc > 0) {
                $allowUnlisted = true;
            }
            break;

        case 6: // Featured
            $where[] = 'starFeatured > 0';
            $orderBy = 'rateDate DESC, levelID DESC';
            break;

        case 7: // Magic
            $where[] = 'objects >= 10000';
            $orderBy = 'levelID DESC';
            break;

        case 10: // Explicit list of level IDs (Gauntlets / Map Packs / Lists)
            $idParts = array_values(array_filter(array_map('intval', explode(',', $str)), static fn(int $id): bool => $id > 0));
            if ($idParts === []) {
                renderEmptyLevelsResult($protocolVersion, $offset, $pageSize);
                return;
            }
            $orderedIds = $idParts;
            $placeholders = implode(',', array_fill(0, count($idParts), '?'));
            $where[] = "levelID IN ($placeholders)";
            foreach ($idParts as $idVal) {
                $params[] = $idVal;
            }
            $allowUnlisted = true;
            $orderBy = 'levelID ASC';
            break;

        case 11: // Awarded (Star Rated)
            $where[] = 'starStars > 0';
            $orderBy = 'rateDate DESC, levelID DESC';
            break;

        case 12: // Followed creators
            $followedRaw = gdParam('followed', '');
            $idParts = array_values(array_filter(array_map('intval', explode(',', $followedRaw)), static fn(int $id): bool => $id > 0));
            if ($idParts === []) {
                renderEmptyLevelsResult($protocolVersion, $offset, $pageSize);
                return;
            }
            $placeholders = implode(',', array_fill(0, count($idParts), '?'));
            $where[] = "userID IN ($placeholders)";
            foreach ($idParts as $idVal) {
                $params[] = $idVal;
            }
            $orderBy = 'levelID DESC';
            break;

        case 13: // Friends
            $friendsRaw = gdParam('friends', '');
            $idParts = array_values(array_filter(array_map('strval', array_map('intval', explode(',', $friendsRaw))), static fn(string $id): bool => $id !== '0'));
            if ($idParts === []) {
                renderEmptyLevelsResult($protocolVersion, $offset, $pageSize);
                return;
            }
            $placeholders = implode(',', array_fill(0, count($idParts), '?'));
            $where[] = "extID IN ($placeholders)";
            foreach ($idParts as $idVal) {
                $params[] = $idVal;
            }
            $orderBy = 'levelID DESC';
            break;

        case 16: // Hall of Fame (Epic+)
            $where[] = 'starEpic > 0';
            $orderBy = 'rateDate DESC, levelID DESC';
            break;

        default:
            $orderBy = 'levelID DESC';
            break;
    }

    if (!$allowUnlisted) {
        $where[] = 'unlisted = 0';
        $where[] = 'unlisted2 = 0';
    }

    // Difficulty filter
    $diff = gdParam('diff', '-');
    if ($diff !== '-' && $diff !== '') {
        if ($diff === '-1') {
            $where[] = 'starDifficulty = 0 AND starDemon = 0 AND starAuto = 0';
        } elseif ($diff === '-2') {
            $where[] = 'starDemon = 1';
            $demonFilter = gdIntParam('demonFilter', 0);
            $demonMap = [1 => 3, 2 => 4, 3 => 0, 4 => 5, 5 => 6];
            if (isset($demonMap[$demonFilter])) {
                $where[] = 'starDemonDiff = ?';
                $params[] = $demonMap[$demonFilter];
            }
        } elseif ($diff === '-3') {
            $where[] = 'starAuto = 1';
        } else {
            $diffParts = array_values(array_filter(array_map('intval', explode(',', $diff)), static fn(int $d): bool => $d >= 1 && $d <= 5));
            if ($diffParts !== []) {
                $diffValues = array_map(static fn(int $d): int => $d * 10, $diffParts);
                $placeholders = implode(',', array_fill(0, count($diffValues), '?'));
                $where[] = "starDifficulty IN ($placeholders) AND starDemon = 0 AND starAuto = 0";
                foreach ($diffValues as $dv) {
                    $params[] = $dv;
                }
            }
        }
    }

    // Length filter
    $len = gdParam('len', '-');
    if ($len !== '-' && $len !== '') {
        $lenParts = array_values(array_filter(array_map('intval', explode(',', $len)), static fn(int $l): bool => $l >= 0 && $l <= 5));
        if ($lenParts !== []) {
            $placeholders = implode(',', array_fill(0, count($lenParts), '?'));
            $where[] = "levelLength IN ($placeholders)";
            foreach ($lenParts as $lv) {
                $params[] = $lv;
            }
        }
    }

    // Boolean filters
    if (gdIntParam('featured', 0) === 1) {
        $where[] = 'starFeatured > 0';
    }
    if (gdIntParam('epic', 0) === 1) {
        $where[] = 'starEpic > 0';
    }
    if (gdIntParam('legendary', 0) === 1) {
        $where[] = 'starEpic = 2';
    }
    if (gdIntParam('mythic', 0) === 1) {
        $where[] = 'starEpic = 3';
    }
    if (gdIntParam('star', 0) === 1) {
        $where[] = 'starStars > 0';
    }
    if (gdIntParam('noStar', 0) === 1) {
        $where[] = 'starStars = 0';
    }
    if (gdIntParam('coins', 0) === 1) {
        $where[] = 'starCoins = 1';
    }
    if (gdIntParam('twoPlayer', 0) === 1) {
        $where[] = 'twoPlayer = 1';
    }
    if (gdIntParam('original', 0) === 1) {
        $where[] = 'original = 0';
    }

    // Song filter
    $songFilter = gdIntParam('song', 0);
    $customSong = gdIntParam('customSong', 0);
    if ($songFilter > 0) {
        if ($customSong === 1) {
            $where[] = 'songID = ?';
            $params[] = $songFilter;
        } else {
            $where[] = 'audioTrack = ? AND songID = 0';
            $params[] = max(0, $songFilter - 1);
        }
    }

    $whereSql = implode(' AND ', $where);

    if ($orderedIds !== []) {
        $dataStmt = $pdo->prepare("SELECT * FROM levels WHERE {$whereSql}");
        $dataStmt->execute($params);
        $fetchedRows = $dataStmt->fetchAll();

        $rowsById = [];
        foreach ($fetchedRows as $fetchedRow) {
            $rowsById[(int)$fetchedRow['levelID']] = $fetchedRow;
        }

        $reordered = [];
        foreach ($orderedIds as $wantedId) {
            if (isset($rowsById[$wantedId])) {
                $reordered[] = $rowsById[$wantedId];
            }
        }

        $total = count($reordered);
        if ($total === 0) {
            renderEmptyLevelsResult($protocolVersion, $offset, $pageSize);
            return;
        }

        $rows = array_slice($reordered, $offset, $pageSize);
        if ($rows === []) {
            renderEmptyLevelsResult($protocolVersion, $offset, $pageSize);
            return;
        }
    } else {
        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM levels WHERE {$whereSql}");
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();

        if ($total === 0) {
            renderEmptyLevelsResult($protocolVersion, $offset, $pageSize);
            return;
        }

        $queryParams = $params;
        $queryParams[] = $pageSize;
        $queryParams[] = $offset;

        $dataStmt = $pdo->prepare(
            "SELECT * FROM levels WHERE {$whereSql} ORDER BY {$orderBy} LIMIT ? OFFSET ?"
        );
        $dataStmt->execute($queryParams);
        $rows = $dataStmt->fetchAll();

        if ($rows === []) {
            renderEmptyLevelsResult($protocolVersion, $offset, $pageSize);
            return;
        }
    }

    $levelStrings = [];
    $creatorMap = [];
    $songIdMap = [];

    foreach ($rows as $lvl) {
        $denom = ((int)$lvl['starDifficulty'] > 0 || (int)$lvl['starAuto'] === 1 || (int)$lvl['starDemon'] === 1) ? 10 : 0;

        $fields = [
            '1' => (int)$lvl['levelID'],
            '2' => (string)$lvl['levelName'],
            '3' => (string)$lvl['levelDesc'],
            '5' => (int)$lvl['levelVersion'],
            '6' => (int)$lvl['userID'],
            '8' => $denom,
            '9' => (int)$lvl['starDifficulty'],
            '10' => (int)$lvl['downloads'],
            '12' => (int)$lvl['audioTrack'],
            '13' => (int)$lvl['gameVersion'],
            '14' => (int)$lvl['likes'],
            '15' => (int)$lvl['levelLength'],
            '17' => (int)$lvl['starDemon'],
            '18' => (int)$lvl['starStars'],
            '19' => (int)$lvl['starFeatured'],
            '25' => (int)$lvl['starAuto'],
            '30' => (int)$lvl['original'],
            '31' => (int)$lvl['twoPlayer'],
            '35' => (int)$lvl['songID'],
            '37' => (int)$lvl['coins'],
            '38' => (int)$lvl['starCoins'],
            '39' => (int)$lvl['requestedStars'],
            '42' => (int)$lvl['starEpic'],
            '43' => (int)$lvl['starDemonDiff'],
            '44' => $gauntletId > 0 ? $gauntletId : 0,
            '45' => (int)$lvl['objects'],
            '46' => (int)$lvl['wt'],
            '47' => (int)$lvl['wt2'],
        ];

        if ($protocolVersion >= 21) {
            $fields['52'] = (string)$lvl['songIDs'];
            $fields['53'] = (string)$lvl['sfxIDs'];
            $fields['57'] = (int)$lvl['ts'];
        }

        $pairs = [];
        foreach ($fields as $k => $v) {
            $pairs[] = $k . ':' . $v;
        }
        $levelStrings[] = implode(':', $pairs);

        $uid = (int)$lvl['userID'];
        if (!isset($creatorMap[$uid])) {
            $ext = (string)$lvl['extID'];
            if ($ext === '') {
                $ext = (string)$uid;
            }
            $creatorMap[$uid] = $uid . ':' . gdCleanString((string)$lvl['userName']) . ':' . $ext;
        }

        $sid = (int)$lvl['songID'];
        if ($sid > 0) {
            $songIdMap[$sid] = true;
        }
        if ((string)$lvl['songIDs'] !== '') {
            foreach (explode(',', (string)$lvl['songIDs']) as $extraSid) {
                $extraInt = (int)trim($extraSid);
                if ($extraInt > 0) {
                    $songIdMap[$extraInt] = true;
                }
            }
        }
    }

    $levelsOut = implode('|', $levelStrings);
    $creatorsOut = implode('|', array_values($creatorMap));

    $songsOut = '';
    if ($protocolVersion >= 19 && $songIdMap !== []) {
        $songIds = array_keys($songIdMap);
        $sPlaceholders = implode(',', array_fill(0, count($songIds), '?'));
        $sStmt = $pdo->prepare("SELECT * FROM songs WHERE ID IN ($sPlaceholders) AND isDisabled = 0");
        $sStmt->execute($songIds);
        $songRows = $sStmt->fetchAll();

        $songParts = [];
        foreach ($songRows as $s) {
            $songParts[] = implode('~|~', [
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
        $songsOut = implode('~:~', $songParts);
    }

    $pagination = $total . ':' . $offset . ':' . $pageSize;

    if ($protocolVersion <= 18) {
        echo $levelsOut . '#' . $creatorsOut . '#' . $pagination;
        return;
    }

    if ($protocolVersion === 19) {
        echo $levelsOut . '#' . $creatorsOut . '#' . $songsOut . '#' . $pagination;
        return;
    }

    $hash = generateSolo2Hash($rows);
    echo $levelsOut . '#' . $creatorsOut . '#' . $songsOut . '#' . $pagination . '#' . $hash;
}

function renderEmptyLevelsResult(int $protocolVersion, int $offset, int $pageSize): void
{
    $pagination = '0:' . $offset . ':' . $pageSize;
    if ($protocolVersion <= 18) {
        echo '##' . $pagination;
        return;
    }
    if ($protocolVersion === 19) {
        echo '###' . $pagination;
        return;
    }
    echo '###' . $pagination . '#' . generateSolo2Hash('');
}
