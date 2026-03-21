/**
 * Arknights: Endfield Game Time Tracker
 * Tracks game process runtime and maintains session history
 */

const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  processName: 'Endfield.exe',
  pollInterval: 5000,
  interimSaveInterval: 60000, // 60 seconds
  initialOffset: 0,
  maxSessions: 100,
  dataDir: path.join(process.env.LOCALAPPDATA, 'endfield-tracker'),
  get dataFile() {
    return path.join(this.dataDir, 'data.json');
  },
  get playtimeFile() {
    return path.join(__dirname, 'playtime.txt');
  },
  get dashboardFile() {
    return path.join(__dirname, 'dashboard.html');
  }
};

// State variables
let isGameRunning = false;
let sessionStartTime = null;
let tickCount = 0;
let data = null; // loaded once, kept in memory
let dashboardOpened = false; // whether browser was opened for current session
const TICKS_PER_SAVE = CONFIG.interimSaveInterval / CONFIG.pollInterval; // 12 ticks

/**
 * Formats seconds into "Xh Ym" format
 * @param {number} seconds - Total seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours + 'h ' + minutes + 'm';
}

/**
 * Logs a message with timestamp
 * @param {string} msg - Message to log
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
 * @returns {Object} Data object with totalSeconds, sessions, lastSaveTime, version
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

  // Return initial state if file doesn't exist or is corrupted
  return {
    version: '1.0',
    totalSeconds: CONFIG.initialOffset,
    sessions: [],
    lastSaveTime: new Date().toISOString()
  };
}

/**
 * Saves the in-memory data to JSON file
 * @param {boolean} isActiveSession - Whether to include active session marker for crash recovery
 */
function saveData(isActiveSession = false) {
  ensureDataDirectory();

  const dataToSave = { ...data };
  dataToSave.lastSaveTime = new Date().toISOString();

  // Add active session marker for crash recovery (time is NOT added to totalSeconds yet)
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

  // Trim sessions to max limit
  if (dataToSave.sessions.length > CONFIG.maxSessions) {
    dataToSave.sessions = dataToSave.sessions.slice(-CONFIG.maxSessions);
  }

  fs.writeFileSync(CONFIG.dataFile, JSON.stringify(dataToSave, null, 2), 'utf8');
}

/**
 * Checks if the game process is running
 * @returns {boolean} True if process is running
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
 * @param {number} sessionSeconds - Duration of completed session
 * @param {number} totalSeconds - Total tracked time
 */
function showNotification(sessionSeconds, totalSeconds) {
  const sessionTime = formatTime(sessionSeconds);
  const totalTime = formatTime(totalSeconds);

  // Write a temporary .ps1 script to avoid quote escaping issues
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
    if (err) {
      log('Notification error: ' + err.message);
    }
  });
}

/**
 * Opens the dashboard HTML file in the default browser
 */
function openDashboard() {
  exec('start "" "' + CONFIG.dashboardFile + '"', { windowsHide: true });
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

    if (!sessionsByDate.has(dateKey)) {
      sessionsByDate.set(dateKey, []);
    }
    sessionsByDate.get(dateKey).push(session);
  }

  let runningTotal = CONFIG.initialOffset;

  for (const [dateStr, sessions] of sessionsByDate) {
    lines.push(dateStr);

    for (const session of sessions) {
      const start = new Date(session.startTime);
      const end = new Date(session.endTime);
      const startTime = start.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });
      const endTime = end.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: false
      });

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

/**
 * Generates a dark-themed HTML dashboard from session history
 * @param {Object} [liveSession] - Current live session info for real-time display
 * @param {number} liveSession.duration - Current session duration in seconds
 * @param {number} liveSession.startTime - Session start timestamp
 */
function writeDashboard(liveSession) {
  // Group sessions by date
  const sessionsByDate = new Map();
  for (const session of data.sessions) {
    const start = new Date(session.startTime);
    const dateKey = start.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    if (!sessionsByDate.has(dateKey)) {
      sessionsByDate.set(dateKey, []);
    }
    sessionsByDate.get(dateKey).push(session);
  }

  // Build live session banner
  var liveBannerHtml = '';
  var displayTotal = data.totalSeconds;
  if (liveSession) {
    displayTotal += liveSession.duration;
    var liveStartTime = new Date(liveSession.startTime).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    liveBannerHtml = '      <div class="live-banner">\n' +
      '        <div class="live-dot"></div>\n' +
      '        <span class="live-label">NOW PLAYING</span>\n' +
      '        <span class="live-info">Started ' + liveStartTime + ' &middot; Session: ' + formatTime(liveSession.duration) + '</span>\n' +
      '      </div>\n';
  }

  // Build date sections HTML (newest first)
  var runningTotals = [];
  var runningTotal = CONFIG.initialOffset;
  for (const [dateStr, sessions] of sessionsByDate) {
    var dayTotal = 0;
    for (const session of sessions) {
      runningTotal += session.duration;
      dayTotal += session.duration;
    }
    runningTotals.push({ dateStr: dateStr, sessions: sessions, dayTotal: dayTotal, runningTotal: runningTotal });
  }
  runningTotals.reverse();

  var daysHtml = '';
  for (var i = 0; i < runningTotals.length; i++) {
    var day = runningTotals[i];
    var rowsHtml = '';
    for (var j = 0; j < day.sessions.length; j++) {
      var session = day.sessions[j];
      var start = new Date(session.startTime);
      var end = new Date(session.endTime);
      var startTime = start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      var endTime = end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      rowsHtml += '          <tr>\n' +
        '            <td>' + startTime + '</td>\n' +
        '            <td>' + endTime + '</td>\n' +
        '            <td>' + formatTime(session.duration) + '</td>\n' +
        '          </tr>\n';
    }

    var sessionCount = day.sessions.length;
    var sessionLabel = sessionCount > 1 ? sessionCount + ' sessions' : '1 session';
    daysHtml += '      <div class="day">\n' +
      '        <div class="day-header">\n' +
      '          <span class="day-date">' + day.dateStr + '</span>\n' +
      '          <span class="day-stats">' + sessionLabel + ' &middot; ' + formatTime(day.dayTotal) + ' &middot; Total: ' + formatTime(day.runningTotal) + '</span>\n' +
      '        </div>\n' +
      '        <table>\n' +
      '          <thead><tr><th>Start</th><th>End</th><th>Duration</th></tr></thead>\n' +
      '          <tbody>\n' +
      rowsHtml +
      '          </tbody>\n' +
      '        </table>\n' +
      '      </div>\n';
  }

  var totalHours = Math.floor(displayTotal / 3600);
  var totalMinutes = Math.floor((displayTotal % 3600) / 60);
  var lastUpdated = new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  var refreshTag = liveSession ? '\n  <meta http-equiv="refresh" content="5">' : '';

  var html = '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">' + refreshTag + '\n' +
    '  <title>Endfield Playtime Tracker</title>\n' +
    '  <style>\n' +
    '    * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
    '    body {\n' +
    '      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;\n' +
    '      background: #0f0f0f;\n' +
    '      color: #e0e0e0;\n' +
    '      min-height: 100vh;\n' +
    '      padding: 2rem;\n' +
    '    }\n' +
    '    .bg-character {\n' +
    '      position: fixed;\n' +
    '      left: -60px;\n' +
    '      bottom: 0;\n' +
    '      height: 100vh;\n' +
    '      width: auto;\n' +
    '      opacity: 0.08;\n' +
    '      pointer-events: none;\n' +
    '      z-index: 0;\n' +
    '      -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%);\n' +
    '      mask-image: linear-gradient(to right, rgba(0,0,0,1) 40%, rgba(0,0,0,0) 100%);\n' +
    '    }\n' +
    '    .container { max-width: 720px; margin: 0 auto; position: relative; z-index: 1; }\n' +
    '    header {\n' +
    '      text-align: center;\n' +
    '      margin-bottom: 2.5rem;\n' +
    '      padding-bottom: 1.5rem;\n' +
    '      border-bottom: 1px solid #2a2a2a;\n' +
    '    }\n' +
    '    h1 {\n' +
    '      font-size: 1.4rem;\n' +
    '      font-weight: 500;\n' +
    '      color: #888;\n' +
    '      margin-bottom: 1rem;\n' +
    '      letter-spacing: 0.05em;\n' +
    '      text-transform: uppercase;\n' +
    '    }\n' +
    '    .total-time {\n' +
    '      font-size: 3.5rem;\n' +
    '      font-weight: 700;\n' +
    '      color: #fff;\n' +
    '      line-height: 1;\n' +
    '    }\n' +
    '    .total-time .unit { font-size: 1.5rem; color: #666; font-weight: 400; }\n' +
    '    .subtitle {\n' +
    '      color: #555;\n' +
    '      font-size: 0.85rem;\n' +
    '      margin-top: 0.75rem;\n' +
    '    }\n' +
    '    .stats-row {\n' +
    '      display: flex;\n' +
    '      justify-content: center;\n' +
    '      gap: 2rem;\n' +
    '      margin-top: 1.25rem;\n' +
    '    }\n' +
    '    .stat { text-align: center; }\n' +
    '    .stat-value { font-size: 1.3rem; font-weight: 600; color: #ccc; }\n' +
    '    .stat-label { font-size: 0.75rem; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.15rem; }\n' +
    '    .live-banner {\n' +
    '      display: flex;\n' +
    '      align-items: center;\n' +
    '      gap: 0.75rem;\n' +
    '      padding: 0.85rem 1rem;\n' +
    '      margin-bottom: 1rem;\n' +
    '      background: #1a1a1a;\n' +
    '      border: 1px solid #2d5a1e;\n' +
    '      border-radius: 8px;\n' +
    '    }\n' +
    '    .live-dot {\n' +
    '      width: 10px; height: 10px;\n' +
    '      background: #4caf50;\n' +
    '      border-radius: 50%;\n' +
    '      animation: pulse 2s infinite;\n' +
    '    }\n' +
    '    @keyframes pulse {\n' +
    '      0%, 100% { opacity: 1; }\n' +
    '      50% { opacity: 0.4; }\n' +
    '    }\n' +
    '    .live-label {\n' +
    '      font-size: 0.75rem;\n' +
    '      font-weight: 700;\n' +
    '      color: #4caf50;\n' +
    '      letter-spacing: 0.08em;\n' +
    '    }\n' +
    '    .live-info { color: #888; font-size: 0.85rem; }\n' +
    '    .day {\n' +
    '      margin-bottom: 1rem;\n' +
    '      background: #181818;\n' +
    '      border-radius: 8px;\n' +
    '      overflow: hidden;\n' +
    '      border: 1px solid #222;\n' +
    '    }\n' +
    '    .day-header {\n' +
    '      display: flex;\n' +
    '      justify-content: space-between;\n' +
    '      align-items: center;\n' +
    '      padding: 0.75rem 1rem;\n' +
    '      background: #1e1e1e;\n' +
    '      border-bottom: 1px solid #222;\n' +
    '    }\n' +
    '    .day-date { font-weight: 600; color: #ddd; font-size: 0.95rem; }\n' +
    '    .day-stats { color: #666; font-size: 0.8rem; }\n' +
    '    table { width: 100%; border-collapse: collapse; }\n' +
    '    th {\n' +
    '      text-align: left;\n' +
    '      padding: 0.5rem 1rem;\n' +
    '      font-size: 0.7rem;\n' +
    '      color: #555;\n' +
    '      text-transform: uppercase;\n' +
    '      letter-spacing: 0.05em;\n' +
    '      font-weight: 500;\n' +
    '    }\n' +
    '    td {\n' +
    '      padding: 0.5rem 1rem;\n' +
    '      font-size: 0.9rem;\n' +
    '      color: #bbb;\n' +
    '      border-top: 1px solid #1a1a1a;\n' +
    '      font-variant-numeric: tabular-nums;\n' +
    '    }\n' +
    '    tr:hover td { background: #1c1c1c; }\n' +
    '    td:last-child { color: #fff; font-weight: 500; }\n' +
    '  </style>\n' +
    '</head>\n' +
    '<body>\n' +
    '  <img class="bg-character" src="https://endfield.wiki.gg/images/Laevatain_Splash_Art.png?2400ae" alt="">\n' +
    '  <div class="container">\n' +
    '    <header>\n' +
    '      <h1>Arknights: Endfield</h1>\n' +
    '      <div class="total-time">' + totalHours + '<span class="unit">h</span> ' + totalMinutes + '<span class="unit">m</span></div>\n' +
    '      <div class="stats-row">\n' +
    '        <div class="stat">\n' +
    '          <div class="stat-value">' + data.sessions.length + '</div>\n' +
    '          <div class="stat-label">Sessions</div>\n' +
    '        </div>\n' +
    '        <div class="stat">\n' +
    '          <div class="stat-value">' + sessionsByDate.size + '</div>\n' +
    '          <div class="stat-label">Days Played</div>\n' +
    '        </div>\n' +
    '      </div>\n' +
    '      <div class="subtitle">Last updated: ' + lastUpdated + '</div>\n' +
    '    </header>\n' +
    liveBannerHtml + daysHtml +
    '  </div>\n' +
    '</body>\n' +
    '</html>';

  try {
    fs.writeFileSync(CONFIG.dashboardFile, html, 'utf8');
  } catch (e) {
    log('Error writing dashboard: ' + e.message);
  }
}

/**
 * Handles graceful shutdown
 */
function handleShutdown() {
  log('Shutting down gracefully...');

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
    writeDashboard();
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

  // State 1: Game just started
  if (currentlyRunning && !isGameRunning) {
    isGameRunning = true;
    sessionStartTime = Date.now();
    tickCount = 0;
    dashboardOpened = false;
    log('Game started - session begin');

    var liveSess = { duration: 0, startTime: sessionStartTime };
    writeDashboard(liveSess);
    openDashboard();
    dashboardOpened = true;
  }
  // State 2: Game just stopped
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
    writeDashboard(); // no live session = no auto-refresh
    dashboardOpened = false;

    sessionStartTime = null;
    tickCount = 0;
  }
  // State 3: Game still running - interim save every 60 seconds
  else if (currentlyRunning && isGameRunning) {
    var currentDuration = Math.floor((Date.now() - sessionStartTime) / 1000);
    writeDashboard({ duration: currentDuration, startTime: sessionStartTime });

    tickCount++;
    if (tickCount >= TICKS_PER_SAVE) {
      saveData(true);
      log('Interim save - session: ' + formatTime(currentDuration));
      tickCount = 0;
    }
  }
  // State 4: Game still not running - no action needed
}

// Main execution
log('Arknights: Endfield Tracker started');
log('Process: ' + CONFIG.processName);
log('Poll interval: ' + CONFIG.pollInterval + 'ms');
log('Data file: ' + CONFIG.dataFile);

// Load initial data and display status
data = loadData();
log('Current total time: ' + formatTime(data.totalSeconds));
log('Sessions tracked: ' + data.sessions.length);

// Regenerate playtime log and dashboard (handles crash recovery)
writePlaytimeLog();
writeDashboard();
log('Playtime log: ' + CONFIG.playtimeFile);

// Setup graceful shutdown handlers
process.on('SIGTERM', handleShutdown);
process.on('SIGINT', handleShutdown);

// Start polling
setInterval(pollProcess, CONFIG.pollInterval);
log('Polling started');
