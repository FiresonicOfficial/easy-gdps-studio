<?php
declare(strict_types=1);

/**
 * EasyGDPS Studio SQLite Schema Initializer
 * Every newly created server starts 100% clean and empty.
 */

require_once __DIR__ . '/config.php';

/**
 * Initialize SQLite schema if core tables do not exist yet.
 */
function ensureDatabaseInitialized(PDO $pdo): void
{
    ensureGdpsDirectories();

    $stmt = $pdo->prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?");
    $stmt->execute(['accounts']);
    $exists = $stmt->fetchColumn();

    if ($exists !== false) {
        return;
    }

    if (!is_file(GDPS_SCHEMA_PATH)) {
        throw new RuntimeException('Schema file not found at: ' . GDPS_SCHEMA_PATH);
    }

    $schemaSql = file_get_contents(GDPS_SCHEMA_PATH);
    if ($schemaSql === false || trim($schemaSql) === '') {
        throw new RuntimeException('Failed to read schema.sql.');
    }

    $pdo->exec($schemaSql);
}

if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        $pdo = getDb();
        ensureDatabaseInitialized($pdo);
        echo "Database initialized successfully.\n";
    } catch (Throwable $e) {
        fwrite(STDERR, 'Initialization error: ' . $e->getMessage() . "\n");
        exit(1);
    }
}
