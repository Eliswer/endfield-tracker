/**
 * Arknights: Endfield Game Time Tracker
 * Tracks game process runtime and maintains session history
 * Serves a live dashboard via local HTTP server with Server-Sent Events
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const CONFIG = {
  processName: 'Endfield.exe',
  pollInterval: 5000,
  interimSaveInterval: 60000, // 60 seconds
  initialOffset: 0,
  maxSessions: 100,
  port: 27182,
  dataDir: path.join(process.env.LOCALAPPDATA, 'endfield-tracker'),
  get dataFile() {
    return path.join(this.dataDir, 'data.json');
  },
  get playtimeFile() {
    return path.join(__dirname, 'playtime.txt');
  }
};

// State variables
let isGameRunning = false;
let sessionStartTime = null;
let tickCount = 0;
let data = null; // loaded once, kept in memory
let dashboardOpened = false; // whether browser was opened this tracker run
let sseClients = []; // active SSE connections
const TICKS_PER_SAVE = CONFIG.interimSaveInterval / CONFIG.pollInterval; // 12 ticks

/**
 * Formats seconds into "Xh Ym" format
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours + 'h ' + minutes + 'm';
}

/**
 * Logs a message with timestamp
 */
function log(msg) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log('[' + timestamp + '] ' + msg);
}

/**
 * Ensures data directory exists
 */
function ensureDataDirectory() {
  if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
    log('Created data directory: ' + CONFIG.dataDir);
  }
}

/**
 * Loads data from JSON file (called once at startup)
 */
function loadData() {
  ensureDataDirectory();

  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      const rawData = fs.readFileSync(CONFIG.dataFile, 'utf8');
      const parsed = JSON.parse(rawData);

      // Crash recovery: finalize any active session from a previous unclean shutdown
      if (parsed.activeSession) {
        log('Detected active session from previous run - finalizing');
        const sessionDuration = parsed.activeSession.duration;
        parsed.totalSeconds += sessionDuration;
        parsed.sessions.push({
          startTime: parsed.activeSession.startTime,
          endTime: parsed.activeSession.lastUpdateTime,
          duration: sessionDuration
        });
        delete parsed.activeSession;
      }

      return parsed;
    }
  } catch (err) {
    log('Error loading data (starting fresh): ' + err.message);
  }

  return {
    version: '1.0',
    totalSeconds: CONFIG.initialOffset,
    sessions: [],
    lastSaveTime: new Date().toISOString()
  };
}

/**
 * Saves the in-memory data to JSON file
 */
function saveData(isActiveSession = false) {
  ensureDataDirectory();

  const dataToSave = { ...data };
  dataToSave.lastSaveTime = new Date().toISOString();

  if (isActiveSession && sessionStartTime) {
    const currentDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
    dataToSave.activeSession = {
      startTime: new Date(sessionStartTime).toISOString(),
      lastUpdateTime: new Date().toISOString(),
      duration: currentDuration
    };
  } else {
    delete dataToSave.activeSession;
  }

  if (dataToSave.sessions.length > CONFIG.maxSessions) {
    dataToSave.sessions = dataToSave.sessions.slice(-CONFIG.maxSessions);
  }

  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(dataToSave, null, 2), 'utf8');
}

/**
 * Checks if the game process is running
 */
function isProcessRunning() {
  try {
    const output = execSync(
      'tasklist /FI "IMAGENAME eq ' + CONFIG.processName + '" /FO CSV /NH',
      { encoding: 'utf8', windowsHide: true }
    );
    return output.includes('"' + CONFIG.processName + '"');
  } catch (err) {
    log('Error checking process: ' + err.message);
    return false;
  }
}

/**
 * Shows Windows toast notification
 */
function showNotification(sessionSeconds, totalSeconds) {
  const sessionTime = formatTime(sessionSeconds);
  const totalTime = formatTime(totalSeconds);

  const ps1Path = path.join(CONFIG.dataDir, 'notify.ps1');
  const ps1Content = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    '',
    '$template = @"',
    '<toast>',
    '  <visual>',
    '    <binding template="ToastGeneric">',
    '      <text>Arknights: Endfield</text>',
    '      <text>Session: ' + sessionTime + '</text>',
    '      <text>Total playtime: ' + totalTime + '</text>',
    '    </binding>',
    '  </visual>',
    '  <audio silent="true"/>',
    '</toast>',
    '"@',
    '',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$xml.LoadXml($template)',
    '$toast = New-Object Windows.UI.Notifications.ToastNotification $xml',
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Endfield Tracker').Show($toast)"
  ].join('\n');

  fs.writeFileSync(ps1Path, ps1Content, 'utf8');
  exec('powershell -NoProfile -ExecutionPolicy Bypass -File "' + ps1Path + '"', { windowsHide: true }, (err) => {
    if (err) log('Notification error: ' + err.message);
  });
}

/**
 * Opens the dashboard in the default browser (only once per tracker run)
 */
function openDashboard() {
  if (dashboardOpened) return;
  exec('rundll32 url.dll,FileProtocolHandler http://127.0.0.1:' + CONFIG.port, { windowsHide: true });
  dashboardOpened = true;
  log('Opened dashboard in browser');
}

/**
 * Regenerates the human-readable playtime log from session history
 */
function writePlaytimeLog() {
  const lines = ['=== Arknights: Endfield - Playtime Log ===', ''];

  const sessionsByDate = new Map();
  for (const session of data.sessions) {
    const start = new Date(session.startTime);
    const dateKey = start.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    if (!sessionsByDate.has(dateKey)) sessionsByDate.set(dateKey, []);
    sessionsByDate.get(dateKey).push(session);
  }

  let runningTotal = CONFIG.initialOffset;
  for (const [dateStr, sessions] of sessionsByDate) {
    lines.push(dateStr);
    for (const session of sessions) {
      const start = new Date(session.startTime);
      const end = new Date(session.endTime);
      const startTime = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const endTime = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      runningTotal += session.duration;
      lines.push('  Session: ' + startTime + ' - ' + endTime + ' (' + formatTime(session.duration) + ')');
    }
    lines.push('  Total: ' + formatTime(runningTotal));
    lines.push('');
  }

  try {
    ensureDataDirectory();
    fs.writeFileSync(CONFIG.playtimeFile, lines.join('\n'), 'utf8');
  } catch (e) {
    log('Error writing playtime log: ' + e.message);
  }
}

// ── SSE ──────────────────────────────────────────────────────────────────────

/**
 * Broadcasts a Server-Sent Event to all connected clients
 */
function broadcastSSE(eventType, eventData) {
  const payload = 'event: ' + eventType + '\ndata: ' + JSON.stringify(eventData) + '\n\n';
  sseClients = sseClients.filter(function (res) {
    try { res.write(payload); return true; }
    catch (e) { return false; }
  });
}

/**
 * Returns a snapshot of the current tracker state for the dashboard
 */
function getDashboardData() {
  var liveSession = null;
  if (isGameRunning && sessionStartTime) {
    liveSession = {
      duration: Math.floor((Date.now() - sessionStartTime) / 1000),
      startTime: sessionStartTime
    };
  }
  return {
    totalSeconds: data.totalSeconds,
    sessions: data.sessions,
    initialOffset: CONFIG.initialOffset,
    liveSession: liveSession,
    lastUpdated: new Date().toISOString()
  };
}

// Dashboard static files cached in memory at startup
var STATIC_FILES = {
  '/': { content: fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8'), type: 'text/html; charset=utf-8' },
  '/dashboard.css': { content: fs.readFileSync(path.join(__dirname, 'dashboard.css'), 'utf8'), type: 'text/css; charset=utf-8' },
  '/dashboard.js': { content: fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8'), type: 'application/javascript; charset=utf-8' },
  '/bg.png': { content: fs.readFileSync(path.join(__dirname, 'bg.png')), type: 'image/png', cache: 'public, max-age=86400' }
};

// ── HTTP Server ──────────────────────────────────────────────────────────────

/**
 * Starts the local HTTP server for the dashboard
 */
function startServer() {
  var server = http.createServer(function (req, res) {
    // Serve static dashboard files
    if (req.method === 'GET' && req.url in STATIC_FILES) {
      var file = STATIC_FILES[req.url];
      var headers = { 'Content-Type': file.type };
      if (file.cache) headers['Cache-Control'] = file.cache;
      res.writeHead(200, headers);
      res.end(file.content);
    }
    else if (req.method === 'GET' && req.url === '/data') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(getDashboardData()));
    }
    else if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write('event: init\ndata: ' + JSON.stringify(getDashboardData()) + '\n\n');
      sseClients.push(res);
      req.on('close', function () {
        sseClients = sseClients.filter(function (c) { return c !== res; });
      });
    }
    else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(CONFIG.port, '127.0.0.1', function () {
    log('Dashboard: http://127.0.0.1:' + CONFIG.port);
  });

  server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
      log('Port ' + CONFIG.port + ' in use, trying ' + (CONFIG.port + 1));
      CONFIG.port++;
      server.listen(CONFIG.port, '127.0.0.1');
    } else {
      log('Server error: ' + err.message);
    }
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Handles graceful shutdown
 */
function handleShutdown() {
  log('Shutting down gracefully...');
  broadcastSSE('shutdown', {});

  if (isGameRunning && sessionStartTime) {
    const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
    data.totalSeconds += sessionDuration;
    data.sessions.push({
      startTime: new Date(sessionStartTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: sessionDuration
    });
    saveData(false);
    writePlaytimeLog();
    log('Saved active session: ' + formatTime(sessionDuration));
  }

  log('Shutdown complete');
  process.exit(0);
}

/**
 * Main polling loop
 */
function pollProcess() {
  const currentlyRunning = isProcessRunning();

  // Game just started
  if (currentlyRunning && !isGameRunning) {
    isGameRunning = true;
    sessionStartTime = Date.now();
    tickCount = 0;
    log('Game started - session begin');
    broadcastSSE('session-start', { startTime: sessionStartTime });
    openDashboard();
  }
  // Game just stopped
  else if (!currentlyRunning && isGameRunning) {
    isGameRunning = false;
    const sessionDuration = Math.floor((Date.now() - sessionStartTime) / 1000);

    data.totalSeconds += sessionDuration;
    data.sessions.push({
      startTime: new Date(sessionStartTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: sessionDuration
    });
    saveData(false);

    log('Game stopped - session: ' + formatTime(sessionDuration) + ', total: ' + formatTime(data.totalSeconds));
    showNotification(sessionDuration, data.totalSeconds);
    writePlaytimeLog();
    broadcastSSE('session-end', {
      totalSeconds: data.totalSeconds,
      sessions: data.sessions,
      initialOffset: CONFIG.initialOffset
    });

    sessionStartTime = null;
    tickCount = 0;
  }
  // Game still running - interim save
  else if (currentlyRunning && isGameRunning) {
    tickCount++;
    if (tickCount >= TICKS_PER_SAVE) {
      var currentDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
      saveData(true);
      log('Interim save - session: ' + formatTime(currentDuration));
      tickCount = 0;
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

log('Arknights: Endfield Tracker started');
log('Process: ' + CONFIG.processName);
log('Poll interval: ' + CONFIG.pollInterval + 'ms');
log('Data file: ' + CONFIG.dataFile);

data = loadData();
log('Current total time: ' + formatTime(data.totalSeconds));
log('Sessions tracked: ' + data.sessions.length);

writePlaytimeLog();
log('Playtime log: ' + CONFIG.playtimeFile);

startServer();

process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

setInterval(pollProcess, CONFIG.pollInterval);
log('Polling started');
