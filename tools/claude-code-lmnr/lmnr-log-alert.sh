#!/bin/bash
# Warns when the lmnr Claude Code plugin logs a failed trace export.
# Reads only the bytes appended since the last run (offset kept in STATE),
# so each failure is reported once. Silent when there is nothing new.
LOG="$HOME/.claude/state/lmnr_hook.log"
STATE="$HOME/.claude/state/lmnr_alert.offset"
PATTERN='export failed|AggregateError|\[ERROR\]'

[ -f "$LOG" ] || exit 0
size=$(wc -c < "$LOG" | tr -d ' ')

# First run: start from the current end so historical errors are not re-reported.
if [ ! -f "$STATE" ]; then echo "$size" > "$STATE"; exit 0; fi
off=$(cat "$STATE" 2>/dev/null); [[ "$off" =~ ^[0-9]+$ ]] || off=0
[ "$size" -lt "$off" ] && off=0   # log was truncated or rotated
echo "$size" > "$STATE"
[ "$size" -eq "$off" ] && exit 0

new=$(tail -c +"$((off + 1))" "$LOG" | /usr/bin/grep -E "$PATTERN")
[ -z "$new" ] && exit 0

n=$(printf '%s\n' "$new" | wc -l | tr -d ' ')
last=$(printf '%s\n' "$new" | tail -1 | cut -c1-200)
jq -n --arg n "$n" --arg last "$last" --arg log "$LOG" \
  '{systemMessage: "⚠️ lmnr: \($n) error(es) nuevos al exportar trazas. Último: \($last) — revisar \($log)"}'
