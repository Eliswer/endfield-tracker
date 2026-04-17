# Arknights: Endfield Playtime Tracker

A lightweight, automatic game time tracker for Arknights: Endfield that runs silently in the background and tracks your total playtime.

## What It Does

- **Automatic tracking**: Monitors the `Endfield.exe` process and automatically tracks how long you play
- **Live dashboard**: Opens a real-time dashboard in your browser when the game starts, with a live timer, session history, and "NOW PLAYING" banner — updates instantly via Server-Sent Events, no page reloads
- **Session notifications**: Shows a Windows toast notification when you close the game, displaying your session time and total playtime
- **Playtime log**: Generates a human-readable `playtime.txt` with sessions grouped by date
- **Crash recovery**: Safely handles unexpected shutdowns or crashes without losing your data
- **Zero maintenance**: Once installed, it runs automatically on login and requires no user interaction

## How It Works

The tracker polls every 5 seconds to check if `Endfield.exe` is running. When the game starts, it begins timing the session and opens a dashboard at `http://127.0.0.1:27182`. When the game closes, it saves the session data and shows a notification with your playtime statistics. All data is stored locally in JSON format.

## Installation

### Prerequisites

- [Node.js](https://nodejs.org) must be installed (LTS version recommended)

### Setup

1. Right-click `setup.bat` and select **Run as administrator**

That's it — the script creates a Windows scheduled task and starts the tracker immediately. On future logins, it starts automatically. Alternatively, you can run `install.bat` (same thing but without auto-launching) and then double-click `launcher.vbs` to start manually.

### Testing Manually

To test the tracker with visible log output:

```bash
node tracker.js
```

The tracker will run in your terminal and display log messages. Start and stop the game to verify it's working correctly.

### Uninstalling

Run `uninstall.bat` to remove the automatic startup task. Your playtime data will be preserved in case you want to reinstall later.

## Usage

- **Background operation**: The tracker runs silently with no visible window
- **Live dashboard**: When the game starts, a dashboard opens at `http://127.0.0.1:27182` with real-time session info — the timer ticks live every second, no page refreshes needed
- **Automatic notifications**: When you close the game, a Windows toast notification appears showing:
  - Session time (how long you played this session)
  - Total time (your cumulative playtime)
- **No interaction needed**: Everything happens automatically

## Data Storage

### Location

All data is stored at:
```
%LOCALAPPDATA%\endfield-tracker\data.json
```

Full path: `C:\Users\<YourUsername>\AppData\Local\endfield-tracker\data.json`

### Checking Your Playtime

**Option 1**: Open `http://127.0.0.1:27182` in your browser (while the tracker is running) for the full dashboard

**Option 2**: Check `playtime.txt` in the project folder — a human-readable log grouped by date

**Option 3**: Look at the notification when you close the game

**Option 4**: Open `data.json` in a text editor to see:
- `totalSeconds`: Your total playtime in seconds
- `sessions`: Array of all your gaming sessions with timestamps
- `activeSession`: Present if a session is currently running (interim saves)

### Initial Offset

You can set an `initialOffset` (in seconds) in `tracker.js` if you want to account for playtime before the tracker was installed. Default is `0`.

## Troubleshooting

### How to check if the tracker is running

1. Open Task Manager (Ctrl + Shift + Esc)
2. Go to the **Details** tab
3. Look for `node.exe` with command line containing `tracker.js`

Alternatively, check if the scheduled task exists:
```bash
schtasks /query /tn "EndfieldTracker"
```

### Dashboard doesn't load

- Make sure the tracker is running (see above)
- Try opening `http://127.0.0.1:27182` manually in your browser
- If the port is in use, the tracker will try the next port — check the log output for the actual URL

### Notifications don't appear

- Ensure Windows notifications are enabled for your system
- Check that Focus Assist is not blocking notifications
- Verify the tracker is running (see above)
- Test by manually running `node tracker.js` and starting/stopping the game

### Manually checking playtime

Open the data file at `%LOCALAPPDATA%\endfield-tracker\data.json` and look at the `totalSeconds` field. Divide by 3600 to convert to hours.

### Resetting or adjusting playtime

1. Stop the tracker if it's running (close the node.exe process)
2. Edit `data.json` and modify the `totalSeconds` value
3. Restart the tracker

### The tracker isn't detecting the game

- Verify the game executable is named `Endfield.exe`
- Ensure Node.js is installed and in your system PATH
- Check the tracker logs if running manually with `node tracker.js`

## Technical Details

### Dependencies

**Zero external dependencies** - uses only built-in Node.js modules:
- `child_process`: Process monitoring via Windows `tasklist`
- `fs`: File system operations for data persistence
- `path`: Path handling
- `http`: Local dashboard server

### Resource Usage

- **Memory**: ~35MB RAM (minimal footprint)
- **CPU**: Negligible (polls every 5 seconds)
- **Disk**: <1MB (data file is typically a few KB)
- **Network**: Local only — the HTTP server binds to `127.0.0.1` and is not accessible from other machines

### Features

- **Live dashboard**: Real-time updates via Server-Sent Events (no page reloads)
- **Interim saves**: Every 60 seconds while playing (prevents data loss)
- **Crash recovery**: Automatically finalizes incomplete sessions on next startup
- **Session history**: Maintains last 100 sessions with timestamps
- **Silent operation**: No console window or UI (uses VBScript launcher)
- **Clean shutdown handling**: Properly saves data on system shutdown/restart

### Configuration

Default settings (in `tracker.js`):
- Process name: `Endfield.exe`
- Poll interval: 5 seconds
- Interim save: Every 60 seconds
- Initial offset: 0 (configurable)
- Max sessions: 100
- Dashboard port: 27182

## File Structure

```
endfield-tracker/
├── tracker.js       # Main tracker script (includes HTTP server)
├── dashboard.html   # Dashboard page structure
├── dashboard.css    # Dashboard styles
├── dashboard.js     # Dashboard client-side logic
├── launcher.vbs     # Silent launcher (no console window)
├── setup.bat        # Installation + auto-launch (recommended)
├── install.bat      # Installation only (alternative)
├── uninstall.bat    # Uninstallation script
└── README.md        # This file
```

Data directory:

```
%LOCALAPPDATA%\endfield-tracker/
├── data.json        # Playtime data and session history
└── playtime.txt     # Auto-generated human-readable playtime log
```

## License

Free to use and modify.
