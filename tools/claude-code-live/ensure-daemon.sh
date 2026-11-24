#!/bin/bash
# SessionStart hook: start the claude-live daemon if nothing answers on its port.
# Silent and non-blocking; a missing daemon only means no live spans.
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${CLAUDE_LIVE_PORT:-47821}"
STATE="${CLAUDE_LIVE_STATE_DIR:-$HOME/.claude/state/claude-live}"

curl -s -m 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && exit 0

mkdir -p "$STATE"
nohup python3 "$DIR/claude_live.py" serve >>"$STATE/daemon.out" 2>&1 </dev/null &
disown
exit 0
