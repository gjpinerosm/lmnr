#!/bin/bash
# Save the claude-live project API key from the macOS clipboard, without it
# appearing in shell history or in a command line.
#   bash tools/claude-code-live/save-key.sh [baseUrl]
# then copy the key within 2 minutes: the script waits until the clipboard holds one.
set -euo pipefail
OUT="${CLAUDE_LIVE_CONFIG:-$HOME/.config/lmnr/claude-live.json}"
BASE="${1:-http://localhost:8000}"
# Shape check, then ask Laminar: an empty OTLP batch is accepted only with a valid project key.
# The header goes through a file descriptor so the key never shows up in `ps`.
looks_like_key() {
  [[ "$1" =~ ^[A-Za-z0-9_-]{20,}$ ]] || return 1
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 -X POST "$BASE/v1/traces" \
        -H @<(printf 'Authorization: Bearer %s\n' "$1") -H 'Content-Type: application/json' \
        --data '{"resourceSpans":[]}')" = 200 ]
}

KEY=""
for _ in $(seq 1 240); do
  KEY="$(pbpaste | tr -d '[:space:]')"
  looks_like_key "$KEY" && break
  KEY=""
  sleep 0.5
done
if [ -z "$KEY" ]; then
  echo "No apareció una API key en el portapapeles en 2 minutos. No se guardó nada." >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"
umask 077
jq -n --arg k "$KEY" --arg u "$BASE" '{projectApiKey: $k, baseUrl: $u}' > "$OUT"
echo "Guardada en $OUT (${#KEY} caracteres)."
