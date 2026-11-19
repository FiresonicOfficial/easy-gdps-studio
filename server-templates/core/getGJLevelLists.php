<?php
declare(strict_types=1);

/**
 * GD 2.2 Level Lists Endpoint
 */

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/gd_crypto.php';

header('Content-Type: text/plain; charset=utf-8');

$pdo = getDb();
$type = gdIntParam('type', 0);
$str = trim(gdParam('str', ''));
$page = max(0, gdIntParam('page', 0));
$pageSize = 10;
$offset = $page * $pageSize;

$where = ['unlisted = 0'];
$params = [];
$orderBy = 'likes DESC, listID DESC';

switch ($type) {
    case 0: // Search
        if ($str !== '') {
            if (ctype_digit($str)) {
                $where = ['listID = ?'];
                $params[] = (int)$str;
            } else {
                $where[] = 'listName LIKE ?';
                $params[] = '%' . $str . '%';
            }
        }
        $orderBy = 'likes DESC, downloads DESC, listID DESC';
        break;
    case 1: // Most downloaded
        $orderBy = 'downloads DESC, listID DESC';
        break;
    case 2: // Most liked
        $orderBy = 'likes DESC, listID DESC';
        break;
    case 4: // Recent
        $orderBy = 'listID DESC';
        break;
    case 5: // User lists
        $where = ['accountID = ?'];
        $params[] = (int)$str;
        $orderBy = 'listID DESC';
        break;
    case 6: // Featured
        $where[] = 'starFeatured > 0';
        $orderBy = 'listID DESC';
        break;
    case 11: // Awarded
        $where[] = 'starReward > 0';
        $orderBy = 'listID DESC';
        break;
    default:
        $orderBy = 'listID DESC';
        break;
}

$whereSql = implode(' AND ', $where);
$cStmt = $pdo->prepare("SELECT COUNT(*) FROM level_lists WHERE {$whereSql}");
$cStmt->execute($params);
$total = (int)$cStmt->fetchColumn();

if ($total === 0) {
    echo '##0:' . $offset . ':' . $pageSize . '#' . generateSolo3Hash('');
    return;
}

$queryParams = $params;
$queryParams[] = $pageSize;
$queryParams[] = $offset;
$stmt = $pdo->prepare("SELECT * FROM level_lists WHERE {$whereSql} ORDER BY {$orderBy} LIMIT ? OFFSET ?");
$stmt->execute($queryParams);
$rows = $stmt->fetchAll();

$entries = [];
$creators = [];

foreach ($rows as $list) {
    $accID = (int)$list['accountID'];
    $uStmt = $pdo->prepare('SELECT userID, userName FROM users WHERE accountID = ? LIMIT 1');
    $uStmt->execute([$accID]);
    $uRow = $uStmt->fetch();
    $uid = $uRow !== false ? (int)$uRow['userID'] : 0;
    $uname = $uRow !== false ? (string)$uRow['userName'] : (string)$list['userName'];

    $entries[] = implode(':', [
        '1', (int)$list['listID'],
        '2', gdCleanString((string)$list['listName']),
        '3', gdCleanString((string)$list['listDesc']),
        '5', (int)$list['listVersion'],
        '7', (int)$list['starDifficulty'],
        '10', (int)$list['downloads'],
        '14', (int)$list['likes'],
        '19', (int)$list['starFeatured'],
        '28', (int)$list['uploadDate'],
        '29', (int)$list['updateDate'],
        '49', $accID,
        '50', gdCleanString($uname),
        '51', gdCleanString((string)$list['listLevels']),
        '55', (int)$list['starReward'],
        '56', (int)$list['countForReward'],
    ]);

    if ($uid > 0 && !isset($creators[$uid])) {
        $creators[$uid] = $uid . ':' . gdCleanString($uname) . ':' . $accID;
    }
}

$hash = generateSolo3Hash(implode('', array_column($rows, 'listID')));
echo implode('|', $entries) . '#' . implode('|', array_values($creators)) . '#' . $total . ':' . $offset . ':' . $pageSize . '#' . $hash;
