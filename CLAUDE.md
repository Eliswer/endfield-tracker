# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Windows-only game time tracker for Arknights: Endfield. Monitors `Endfield.exe` via polling, tracks cumulative playtime, serves a live dashboard via local HTTP server with Server-Sent Events, and shows Windows toast notifications on session end. Runs silently in the background via a VBScript launcher + Windows scheduled task.

## Running

```bash
node tracker.js
```

There is no build step, no package.json, no test framework, and zero external dependencies. The project uses only Node.js built-in modules (`child_process`, `fs`, `path`, `http`).

## Architecture

The entire application is a single file: `tracker.js`.

**Polling state machine** (`pollProcess()`, called every 5 seconds via `setInterval`):
1. Game just started → record `sessionStartTime`, set `isGameRunning = true`, broadcast SSE `session-start`, open dashboard in browser
2. Game still running → interim save to disk every 60 seconds (12 ticks)
3. Game just stopped → calculate duration, add to `totalSeconds`, push to `sessions[]`, save, show notification, regenerate `playtime.txt`, broadcast SSE `session-end`
4. Game not running → no-op

**HTTP server**: A local HTTP server (Node's built-in `http` module) listens on `127.0.0.1:27182`. Serves the dashboard HTML at `/`, session data JSON at `/data`, and a Server-Sent Events stream at `/events`.

**Dashboard**: Dark-themed HTML dashboard served from memory (no file writes). Features collapsible day sections, pagination (top + bottom), live timer that ticks every second via client-side JS, and a "NOW PLAYING" banner. The browser connects to the SSE endpoint for real-time updates — session start/end events update the DOM without page reloads.

**Process detection**: `isProcessRunning()` shells out to Windows `tasklist` command via `execSync`.

**Notifications**: `showNotification()` writes a temporary PowerShell script to the data directory and executes it to create Windows Runtime toast notifications.

**Playtime log**: `writePlaytimeLog()` regenerates `playtime.txt` from `data.sessions` on every session end and on startup. Groups sessions by local date with start/end times, session duration, and running total.

**Crash recovery**: On startup, `loadData()` checks for an `activeSession` marker in the data file (written during interim saves). If found, the incomplete session is finalized and added to totals.

**Data persistence**: JSON file at `%LOCALAPPDATA%\endfield-tracker\data.json`. Data is loaded once into memory at startup and written back on session events and interim saves.

## Runtime Files (in data directory)

- `data.json` — authoritative session data and totals
- `playtime.txt` — human-readable playtime log, regenerated from `data.sessions`
- `notify.ps1` — temporary PowerShell notification script

## Configuration

All config is in the `CONFIG` object at the top of `tracker.js`:
- `processName`: executable to monitor (default: `Endfield.exe`)
- `pollInterval`: polling frequency in ms (default: 5000)
- `interimSaveInterval`: how often to save while game is running (default: 60000)
- `initialOffset`: seconds to add as baseline for pre-tracker playtime (default: 0)
- `maxSessions`: session history cap (default: 100)
- `port`: HTTP server port (default: 27182)

## Supporting Files

- `launcher.vbs` — runs `node tracker.js` without a console window
- `install.bat` — creates Windows scheduled task `"EndfieldTracker"` to run on logon (requires admin)
- `uninstall.bat` — removes the scheduled task (preserves data)
