# lmnr-plugin-alert

Hook de Claude Code que avisa cuando el plugin `lmnr@lmnr` no logra exportar trazas. El plugin solo lo anota en `~/.claude/state/lmnr_hook.log` (`OTLP export failed: …`), así que una sesión puede pasar días sin reportar consumo sin que nadie lo note.

El script lee solo lo que se agregó al log desde la corrida anterior, con el offset guardado en `~/.claude/state/lmnr_alert.offset`. Si encuentra `export failed`, `AggregateError` o `[ERROR]`, muestra un `systemMessage` con el conteo y la última línea; si no, no dice nada. La primera vez arranca desde el final del log para no repetir errores viejos.

## Instalación

```bash
cp tools/lmnr-plugin-alert/lmnr-log-alert.sh ~/.claude/hooks/
```

En `~/.claude/settings.json`, agregar a `hooks.SessionStart` y a `hooks.Stop`:

```json
{ "hooks": [{ "type": "command", "command": "bash \"$HOME/.claude/hooks/lmnr-log-alert.sh\" 2>/dev/null || true", "timeout": 5 }] }
```

El plugin exporta en segundo plano después de `Stop`, así que el fallo de un turno se avisa al terminar el turno siguiente o al abrir la próxima sesión.

Requiere `jq`.
