#!/bin/bash
# =============================================================
# Deploys the automation from this git checkout (source of truth) to
# ~/.garmin-dashboard-automation (where it actually runs from).
#
# WHY THIS EXISTS: macOS blocks launchd-spawned processes from reading
# ANY file under ~/Desktop (~/Documents, ~/Downloads too) — confirmed
# by direct test on 2026-09-02 — regardless of where the reading
# process itself lives. There is no command-line way to grant that
# access; it's a GUI-only TCC permission (Privacy & Security > Full
# Disk Access), and granting it wasn't done, so this project's repo
# living under ~/Desktop can never be read directly by a scheduled job.
#
# Rather than relocate the whole dashboard repo (disruptive — other
# active sessions/editors are working in it at this exact path) or
# require a manual permission grant, this "deploys" just the automation
# to an unprotected location, the same way Git -> Vercel already
# deploys the dashboard's HTML/CSS/JS out of this same repo.
#
# Run this any time you edit garmin-cron-sync.mjs, run-garmin-sync.sh,
# garmin-sync.py, hevy-sync.mjs, run-hevy-sync.sh, or .env.
# =============================================================
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SRC_DIR")"
DEST_DIR="$HOME/.garmin-dashboard-automation"

mkdir -p "$DEST_DIR"

cp "$SRC_DIR/garmin-cron-sync.mjs" "$DEST_DIR/"
cp "$SRC_DIR/run-garmin-sync.sh" "$DEST_DIR/"
cp "$SRC_DIR/package.json" "$DEST_DIR/"
cp "$SRC_DIR/package-lock.json" "$DEST_DIR/"
cp "$REPO_DIR/garmin-sync.py" "$DEST_DIR/"

if [ ! -d "$DEST_DIR/node_modules" ]; then
  echo "Installing dependencies in $DEST_DIR ..."
  (cd "$DEST_DIR" && npm install --silent)
fi

# hevy-sync.mjs has zero external dependencies (built-in node:fs/node:url/
# path + fetch only) — no package.json/node_modules needed for it. .env
# holds HEVY_API_KEY; chmod 600 since it's a secret living outside the
# repo's own git-ignore-protected directory.
cp "$SRC_DIR/hevy-sync.mjs" "$DEST_DIR/"
cp "$SRC_DIR/run-hevy-sync.sh" "$DEST_DIR/"
cp "$SRC_DIR/.env" "$DEST_DIR/.env"
chmod 600 "$DEST_DIR/.env"

echo "Deployed to $DEST_DIR:"
ls -la "$DEST_DIR" | grep -v node_modules

echo ""
echo "launchd jobs should point ProgramArguments at:"
echo "  $DEST_DIR/run-garmin-sync.sh"
echo "  $DEST_DIR/run-hevy-sync.sh"
echo "(see automation/com.hayden.garminsync.*.plist, automation/com.hayden.hevysync.plist)"
