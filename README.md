# Arknights: Endfield Playtime Tracker

A lightweight, automatic game time tracker for Arknights: Endfield that runs silently in the background and tracks your total playtime.

## What It Does

- **Automatic tracking**: Monitors the `Endfield.exe` process and automatically tracks how long you play
- **Session notifications**: Shows a Windows toast notification when you close the game, displaying your session time and total playtime
- **Crash recovery**: Safely handles unexpected shutdowns or crashes without losing your data
- **Zero maintenance**: Once installed, it runs automatically on login and requires no user interaction

## How It Works

The tracker polls every 5 seconds to check if `Endfield.exe` is running. When the game starts, it begins timing the session. When the game closes, it saves the session data and shows a notification with your playtime statistics. All data is stored locally in JSON format.

## Installation

### Testing Manually

To test the tracker before installing:

```bash
node tracker.js
```

The tracker will run in your terminal and display log messages. Start and stop the game to verify it's working correctly.

### Installing for Auto-Start

1. Right-click `install.bat` and select **Run as administrator**
2. The tracker will be configured to start automatically when you log in to Windows
3. No additional setup required

The installer creates a scheduled task that launches the tracker silently using the VBScript launcher.

### Uninstalling

Run `uninstall.bat` to remove the automatic startup task. Your playtime data will be preserved in case you want to reinstall later.

## Usage

- **Background operation**: The tracker runs silently with no visible window
- **Automatic notifications**: When you close the game, a notification appears showing:
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

**Option 1**: Look at the notification when you close the game

**Option 2**: Open `data.json` in a text editor to see:
- `totalSeconds`: Your total playtime in seconds
- `sessions`: Array of all your gaming sessions with timestamps
- `activeSession`: Present if a session is currently running (interim saves)

**Option 3**: Check Task Manager for the `node.exe` process running `tracker.js` (if active)

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

### Resource Usage

- **Memory**: ~35MB RAM (minimal footprint)
- **CPU**: Negligible (polls every 5 seconds)
- **Disk**: <1MB (data file is typically a few KB)

### Features

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

## File Structure

```
endfield-tracker/
├── tracker.js       # Main tracker script
├── launcher.vbs     # Silent launcher (no console window)
├── install.bat      # Installation script
├── uninstall.bat    # Uninstallation script
└── README.md        # This file
```

Data directory:
```
%LOCALAPPDATA%\endfield-tracker/
└── data.json        # Playtime data and session history
```

## License

Free to use and modify.
