#!/bin/bash
# Raises the lmnr Claude Code plugin's hardcoded 30 s OTLP export timeout.
# A batch the server accepts after the client gave up is re-sent on the next
# hook and duplicated, so the timeout must outlast the slowest ingest.
# Idempotent; re-run on SessionStart because a plugin update replaces the bundle.
# The new value is read from CC_LMNR_EXPORT_TIMEOUT_MS (default 120000).
ROOT="${LMNR_PLUGIN_CACHE:-$HOME/.claude/plugins/cache/lmnr/lmnr}"
ORIG='var EXPORT_TIMEOUT_MS = 3e4;'
PATCHED='var EXPORT_TIMEOUT_MS = Number(process.env.CC_LMNR_EXPORT_TIMEOUT_MS) || 12e4;'

shopt -s nullglob
unknown=()
for f in "$ROOT"/*/dist/hook.cjs; do
  grep -qF "$PATCHED" "$f" && continue
  if grep -qF "$ORIG" "$f"; then
    tmp="${f%.cjs}.patch-$$.cjs"   # keep .cjs: the plugin's package.json is "type": "module"
    # Literal replacement (no regex): the bundle is only touched on an exact match.
    ORIG="$ORIG" PATCHED="$PATCHED" perl -pe 's/\Q$ENV{ORIG}\E/$ENV{PATCHED}/' "$f" > "$tmp" &&
      node --check "$tmp" 2>/dev/null && mv "$tmp" "$f" || { rm -f "$tmp"; unknown+=("$f"); }
  else
    unknown+=("$f")
  fi
done

if [ ${#unknown[@]} -gt 0 ]; then
  jq -n --arg files "${unknown[*]}" \
    '{systemMessage: "⚠️ lmnr: parche de timeout no aplicado (el plugin cambió). Revisar EXPORT_TIMEOUT_MS en: \($files)"}'
fi
exit 0
