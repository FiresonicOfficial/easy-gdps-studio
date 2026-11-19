<?php
declare(strict_types=1);

/**
 * EasyGDPS Studio - Friend Web Download Portal
 */

require_once __DIR__ . '/config.php';

$config = getServerConfig();
$pdo = getDb();

$levelsStmt = $pdo->prepare('SELECT COUNT(*) FROM levels WHERE isDeleted = 0');
$levelsStmt->execute();
$levelsCount = (int)$levelsStmt->fetchColumn();

$playersStmt = $pdo->prepare('SELECT COUNT(*) FROM users WHERE isBanned = 0');
$playersStmt->execute();
$playersCount = (int)$playersStmt->fetchColumn();

$accountsStmt = $pdo->prepare('SELECT COUNT(*) FROM accounts WHERE isActive = 1');
$accountsStmt->execute();
$accountsCount = (int)$accountsStmt->fetchColumn();

$commentsStmt = $pdo->prepare('SELECT COUNT(*) FROM comments');
$commentsStmt->execute();
$commentsCount = (int)$commentsStmt->fetchColumn();

function formatBytesHuman(int $bytes): string
{
    if ($bytes < 1024) {
        return $bytes . ' B';
    }
    if ($bytes < 1048576) {
        return number_format($bytes / 1024, 1) . ' KB';
    }
    return number_format($bytes / 1048576, 2) . ' MB';
}

function escapeHtml(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

$allowedExtensions = ['exe', 'zip', 'apk'];
$downloads = [];
$seenNames = [];

$scanDirs = [
    GDPS_DOWNLOADS_DIR,
    GDPS_DATA_DIR . '/downloads',
];

foreach ($scanDirs as $dir) {
    if (!is_dir($dir)) {
        continue;
    }
    $items = scandir($dir);
    if ($items === false) {
        continue;
    }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..' || str_starts_with($item, '.')) {
            continue;
        }
        if (isset($seenNames[$item])) {
            continue;
        }
        $fullPath = $dir . '/' . $item;
        if (!is_file($fullPath)) {
            continue;
        }
        $ext = strtolower(pathinfo($item, PATHINFO_EXTENSION));
        if (!in_array($ext, $allowedExtensions, true)) {
            continue;
        }
        $seenNames[$item] = true;
        $size = filesize($fullPath);
        $platform = match ($ext) {
            'apk' => 'Android Package (.apk)',
            'exe' => 'Windows Executable (.exe)',
            'zip' => 'Windows Portable Archive (.zip)',
            default => 'Client Build',
        };
        $badge = match ($ext) {
            'apk' => 'Android',
            'exe', 'zip' => 'Windows',
            default => 'Download',
        };

        $downloads[] = [
            'name' => $item,
            'ext' => strtoupper($ext),
            'platform' => $platform,
            'badge' => $badge,
            'size' => formatBytesHuman($size !== false ? $size : 0),
            'url' => '/downloads/' . rawurlencode($item),
        ];
    }
}

$serverName = $config['name'] !== '' ? $config['name'] : 'EasyGDPS Server';
$gdVersion = $config['version'] !== '' ? $config['version'] : '2.2';
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title><?php echo escapeHtml($serverName); ?> — GDPS Portal</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --surface: #131b31;
      --surface-alt: #19233f;
      --border: #27355d;
      --text: #eef2ff;
      --muted: #9aa8cc;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --green: #22c55e;
      --amber: #f59e0b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      background: radial-gradient(circle at top, #172447 0%, var(--bg) 55%);
      color: var(--text);
      line-height: 1.55;
      min-height: 100vh;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 36px 20px 64px;
    }
    .hero {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
    }
    .hero-title {
      margin: 0 0 8px;
      font-size: clamp(1.5rem, 3vw, 2.1rem);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .badges {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 5px 12px;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .status-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 10px var(--green);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 14px;
      margin-top: 22px;
    }
    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px 20px;
    }
    .stat-label {
      font-size: 0.82rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text);
    }
    .section {
      margin-top: 28px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
    }
    .section h2 {
      margin: 0 0 6px;
      font-size: 1.25rem;
    }
    .section-subtitle {
      margin: 0 0 18px;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .downloads-list {
      display: grid;
      gap: 12px;
    }
    .download-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
    }
    .download-meta {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .download-name {
      font-weight: 600;
      font-size: 1rem;
      word-break: break-word;
    }
    .download-info {
      font-size: 0.85rem;
      color: var(--muted);
    }
    .download-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 18px;
      border-radius: 10px;
      background: var(--accent);
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.92rem;
      transition: background 0.15s ease;
    }
    .download-btn:hover {
      background: var(--accent-hover);
    }
    .empty-box {
      border: 1px dashed var(--border);
      border-radius: 12px;
      padding: 22px;
      text-align: center;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .steps-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }
    .step-card {
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px;
    }
    .step-card h3 {
      margin: 0 0 10px;
      font-size: 1.05rem;
      color: #bfdbfe;
    }
    .step-card ol {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 0.92rem;
    }
    .step-card li + li {
      margin-top: 6px;
    }
    footer {
      margin-top: 28px;
      text-align: center;
      font-size: 0.82rem;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main class="container">
    <header class="hero">
      <div>
        <h1 class="hero-title"><?php echo escapeHtml($serverName); ?></h1>
        <div class="badges">
          <span class="badge"><span class="status-dot" aria-hidden="true"></span> Online</span>
          <span class="badge">Geometry Dash <?php echo escapeHtml($gdVersion); ?></span>
        </div>
      </div>
    </header>

    <section class="stats-grid" aria-label="Server Statistics">
      <div class="stat-card">
        <div class="stat-label">Uploaded Levels</div>
        <div class="stat-value"><?php echo number_format($levelsCount); ?></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Players</div>
        <div class="stat-value"><?php echo number_format($playersCount); ?></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Accounts</div>
        <div class="stat-value"><?php echo number_format($accountsCount); ?></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Comments</div>
        <div class="stat-value"><?php echo number_format($commentsCount); ?></div>
      </div>
    </section>

    <section class="section" aria-labelledby="downloads-heading">
      <h2 id="downloads-heading">Download Game Client</h2>
      <p class="section-subtitle">
        Download the pre-patched client for your device to connect directly to this server.
      </p>

      <?php if ($downloads === []): ?>
        <div class="empty-box">
          No client builds are currently published in <code>public/downloads/</code>.
          Ask the server host to build Windows or Android clients in EasyGDPS Studio.
        </div>
      <?php else: ?>
        <div class="downloads-list">
          <?php foreach ($downloads as $file): ?>
            <div class="download-row">
              <div class="download-meta">
                <span class="download-name"><?php echo escapeHtml($file['name']); ?></span>
                <span class="download-info">
                  <?php echo escapeHtml($file['platform']); ?> &bull; <?php echo escapeHtml($file['size']); ?>
                </span>
              </div>
              <a class="download-btn" href="<?php echo escapeHtml($file['url']); ?>" download>
                Download <?php echo escapeHtml($file['ext']); ?> (<?php echo escapeHtml($file['badge']); ?>)
              </a>
            </div>
          <?php endforeach; ?>
        </div>
      <?php endif; ?>
    </section>

    <section class="section" aria-labelledby="setup-heading">
      <h2 id="setup-heading">Quick Setup Instructions</h2>
      <p class="section-subtitle">
        Follow the guide for your platform to start playing with your friends.
      </p>
      <div class="steps-grid">
        <div class="step-card">
          <h3>Windows PC (.exe / .zip)</h3>
          <ol>
            <li>Download the Windows <strong>.zip</strong> or <strong>.exe</strong> file above.</li>
            <li>If you downloaded a <strong>.zip</strong> archive, extract all files into a new folder first.</li>
            <li>Launch the patched <strong>GeometryDash.exe</strong> inside the folder.</li>
            <li>Open Settings &rarr; Account &rarr; Register (for GD 2.0+) or set your player name and start playing.</li>
          </ol>
        </div>
        <div class="step-card">
          <h3>Android (.apk)</h3>
          <ol>
            <li>Download the <strong>.apk</strong> package above onto your Android device.</li>
            <li>Allow installation from unknown sources when prompted by Android.</li>
            <li>Install and open the app—it is already configured to connect to this server.</li>
            <li>Register or sign in (GD 2.0+) and browse, upload, and rate levels.</li>
          </ol>
        </div>
      </div>
    </section>

    <footer>
      Powered by EasyGDPS Studio &bull; Geometry Dash Private Server (1.0&ndash;2.2 Compatible)
    </footer>
  </main>
</body>
</html>
