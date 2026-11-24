# claude-code-lmnr

Dos hooks de Claude Code para que el plugin `lmnr@lmnr` reporte el consumo de forma confiable contra un Laminar self-hosted. Requieren `jq`, y el parche requiere además `perl` y `node`.

## `patch-plugin-timeout.sh`: timeout de exportación configurable

El plugin corta cada envío OTLP a los 30 s (`var EXPORT_TIMEOUT_MS = 3e4;` en `dist/hook.cjs`) y no hay variable para cambiarlo. Si el servidor tarda más pero acepta el lote, el plugin no avanza su offset y reenvía el mismo lote en el siguiente hook, con lo que la traza queda **duplicada**.

El script reemplaza esa línea por `Number(process.env.CC_LMNR_EXPORT_TIMEOUT_MS) || 12e4`. Por defecto el timeout queda en 120 s y se puede ajustar con `CC_LMNR_EXPORT_TIMEOUT_MS`. Su comportamiento:
- solo toca el archivo si encuentra el texto exacto;
- valida el resultado con `node --check` antes de reemplazar;
- si ya está parcheado, no hace nada.

Si el plugin cambió y el texto no aparece, no modifica nada y avisa con un `systemMessage`.

Se ejecuta en `SessionStart` porque una actualización del plugin reemplaza el bundle en `~/.claude/plugins/cache/lmnr/lmnr/<versión>/`.

## `lmnr-log-alert.sh`: aviso de exportaciones fallidas

El plugin solo anota sus fallos en `~/.claude/state/lmnr_hook.log` (`OTLP export failed: …`), así que una sesión puede pasar días sin reportar consumo sin que nadie lo note. El script lee lo que se agregó al log desde la corrida anterior, con el offset guardado en `~/.claude/state/lmnr_alert.offset`. Si encuentra `export failed`, `AggregateError` o `[ERROR]`, muestra un `systemMessage`; si no, no dice nada. La primera vez arranca desde el final del log.

Como el plugin exporta en segundo plano después de `Stop`, el fallo de un turno se avisa al terminar el turno siguiente o al abrir la próxima sesión.

## Instalación

```bash
cp tools/claude-code-lmnr/*.sh ~/.claude/hooks/
```

En `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "bash \"$HOME/.claude/hooks/patch-plugin-timeout.sh\" 2>/dev/null || true", "timeout": 10 }] },
      { "hooks": [{ "type": "command", "command": "bash \"$HOME/.claude/hooks/lmnr-log-alert.sh\" 2>/dev/null || true", "timeout": 5 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "bash \"$HOME/.claude/hooks/lmnr-log-alert.sh\" 2>/dev/null || true", "timeout": 5 }] }
    ]
  }
}
```

Si de todas formas aparece un turno duplicado, `python3 tools/agent-graph/extract.py` lo advierte con sus `trace_id`.
