# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Windows-only game time tracker for Arknights: Endfield. Monitors `Endfield.exe` via polling, tracks cumulative playtime, and shows Windows toast notifications on session end. Runs silently in the background via a VBScript launcher + Windows scheduled task.

## Running

```bash
node tracker.js
```

There is no build step, no package.json, no test framework, and zero external dependencies. The project uses only Node.js built-in modules (`child_process`, `fs`, `path`).

## Architecture

The entire application is a single file: `tracker.js` (~430 lines).

**Polling state machine** (`pollProcess()`, called every 5 seconds via `setInterval`):
1. Game just started → record `sessionStartTime`, set `isGameRunning = true`, open display window
2. Game still running → update `status.txt` every tick, interim save to disk every 60 seconds (12 ticks)
3. Game just stopped → calculate duration, add to `totalSeconds`, push to `sessions[]`, save, show notification, close display window, regenerate `playtime.txt`
4. Game not running → no-op

**Process detection**: `isProcessRunning()` shells out to Windows `tasklist` command via `execSync`.

**Notifications**: `showNotification()` writes a temporary PowerShell script to the data directory and executes it to create Windows Runtime toast notifications.

**Display window**: When the game starts, `openDisplayWindow()` writes a temporary `display.js` to the data directory and spawns a visible cmd window (`start "Endfield Tracker" cmd /c node display.js`) that reads and re-displays `status.txt` every 3 seconds. When the game stops, `closeDisplayWindow()` writes "SESSION_ENDED" to the status file (graceful exit) and uses `taskkill` by window title as fallback.

**Playtime log**: `writePlaytimeLog()` regenerates `playtime.txt` from `data.sessions` on every session end and on startup. Groups sessions by local date with start/end times, session duration, and running total. The running total starts at `initialOffset`.

**Crash recovery**: On startup, `loadData()` checks for an `activeSession` marker in the data file (written during interim saves). If found, the incomplete session is finalized and added to totals.

**Data persistence**: JSON file at `%LOCALAPPDATA%\endfield-tracker\data.json`. Data is loaded once into memory at startup and written back on session events and interim saves.

## Runtime Files (in data directory)

- `data.json` — authoritative session data and totals
- `playtime.txt` — human-readable playtime log, regenerated from `data.sessions`
- `status.txt` — live session status, updated every 5 seconds while playing
- `display.js` — temporary display script, overwritten each session start
- `notify.ps1` — temporary PowerShell notification script

## Configuration

All config is in the `CONFIG` object at the top of `tracker.js`:
- `processName`: executable to monitor (default: `Endfield.exe`)
- `pollInterval`: polling frequency in ms (default: 5000)
- `interimSaveInterval`: how often to save while game is running (default: 60000)
- `initialOffset`: seconds to add as baseline for pre-tracker playtime (default: 240600 = 66h 50m)
- `maxSessions`: session history cap (default: 100)

## Supporting Files

- `launcher.vbs` — runs `node tracker.js` without a console window (hardcoded paths)
- `install.bat` — creates Windows scheduled task `"EndfieldTracker"` to run on logon (requires admin)
- `uninstall.bat` — removes the scheduled task (preserves data)

Note: `launcher.vbs` and `install.bat` contain hardcoded absolute paths. If the repo is moved, these files must be updated.
