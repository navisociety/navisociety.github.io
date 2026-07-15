#!/bin/sh
# navi-runner launcher for POSIX devices — phones via Termux, Linux, macOS.
# Reads navi-runner/.env, appends every run to navi-runner/runner.log
# (gitignored), and passes arguments through to poll.js:
#   sh run-runner.sh              one poll
#   sh run-runner.sh --loop 900   keep polling every 15 minutes
dir="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$dir/.env" ]; then
  set -a
  . "$dir/.env"
  set +a
fi
echo "[$(date)] runner poll" >> "$dir/runner.log"
node "$dir/poll.js" "$@" 2>&1 | tee -a "$dir/runner.log"
