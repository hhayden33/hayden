#!/bin/bash
# =============================================================
# launchd entry point. Sets up a real PATH (launchd jobs run with a
# near-empty environment, not your shell's), prevents two syncs from
# overlapping if one ever runs long, and calls the actual sync script.
# =============================================================
set -uo pipefail

AUTOMATION_DIR="/Users/hh.ayden/Desktop/claude /hayden/automation"
LOCK_FILE="$AUTOMATION_DIR/tmp/sync.lock"
LOG_FILE="$AUTOMATION_DIR/logs/garmin-sync.log"

mkdir -p "$AUTOMATION_DIR/tmp" "$AUTOMATION_DIR/logs"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if [ -f "$LOCK_FILE" ]; then
  OLD_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Skipping run — previous sync (PID $OLD_PID) still active." >> "$LOG_FILE"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

cd "$AUTOMATION_DIR" || exit 1
node garmin-cron-sync.mjs
exit $?
