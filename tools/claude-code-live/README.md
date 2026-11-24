# claude-code-live

Muestra en Laminar, mientras pasa, qué hace cada agente de Claude Code: qué herramienta corre, en qué subagente, dónde y en qué estado. Funciona sin esperar al final del turno.

El plugin `lmnr@lmnr` exporta cada turno completo cuando termina (hooks `Stop` y `SessionEnd`). Este daemon recibe los hooks de Claude Code por HTTP en el momento en que ocurren y manda spans a un **proyecto aparte** de Laminar. La vista de traza de Laminar se actualiza sola por SSE.

Va en un proyecto aparte porque la tabla `spans` no elimina duplicados. Si los mismos pasos llegaran en vivo y también en el lote del plugin, el costo se contaría dos veces. El registro completo, con tokens y costo, sigue siendo el del plugin.

Solo usa la biblioteca estándar de Python.

## Instalación

1. Crear en Laminar (http://localhost:5667) el proyecto `claude-live` y una clave de API. Para guardarla sin que quede en el historial, correr el script y **después** copiar la key:
   ```bash
   bash tools/claude-code-live/save-key.sh
   ```
   El script espera hasta 2 minutos a que el portapapeles tenga una key que Laminar acepte y la guarda en `~/.config/lmnr/claude-live.json` con permisos 600.
2. Copiar los scripts:
   ```bash
   mkdir -p ~/.claude/hooks/claude-live
   cp tools/claude-code-live/{claude_live.py,ensure-daemon.sh} ~/.claude/hooks/claude-live/
   ```
3. En `~/.claude/settings.json`, agregar un SessionStart que arranca el daemon y un hook HTTP por evento:
   ```json
   "SessionStart": [{"hooks": [
     {"type": "command", "command": "bash \"$HOME/.claude/hooks/claude-live/ensure-daemon.sh\" 2>/dev/null || true", "timeout": 5},
     {"type": "http", "url": "http://127.0.0.1:47821/hook", "timeout": 2}
   ]}],
   "PreToolUse": [{"hooks": [{"type": "http", "url": "http://127.0.0.1:47821/hook", "timeout": 2}]}]
   ```
   El mismo hook HTTP va en `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`, `Notification`, `SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact`, `Stop`, `StopFailure` y `SessionEnd`.

El daemon responde `{}` a cada hook, así que nunca cambia una decisión de Claude Code. Si está apagado, el hook falla sin bloquear la sesión. Los hooks de un mismo evento corren en paralelo: en la primera sesión, el `SessionStart` HTTP puede llegar antes de que el daemon arranque y perderse. Los demás eventos llegan bien.

No registrar los hooks dos veces (por ejemplo, en `~/.claude/settings.json` y en `.claude/settings.local.json` de un repo): cada evento se enviaría dos veces, y los spans quedarían duplicados.

## Uso

```bash
python3 ~/.claude/hooks/claude-live/claude_live.py status   # estado actual de cada sesión y agente
python3 ~/.claude/hooks/claude-live/claude_live.py stop
curl -s 127.0.0.1:47821/state                               # lo mismo en JSON (para otras herramientas)
```

`serve --record` además guarda cada payload en `~/.claude/state/claude-live/record.jsonl`; sirve para depurar o cuando cambia Claude Code. Los logs están en `~/.claude/state/claude-live/daemon.log`.

## Qué se ve en Laminar

Cada turno es una traza. Su id sale de `session_id` y `prompt_id`, así que todos los eventos del turno caen en la misma traza, también los de los subagentes.

- **Raíz** `Claude Code - Live (<sesión>)`. Se envía en `Stop`. Mientras el turno corre, Laminar la muestra como *pending*, porque los hijos ya traen `lmnr.span.ids_path`.
- **Herramientas.** Al empezar se envía un marcador `▶ <Tool>`. Cuelga de la herramienta, así que la herramienta aparece *pending* hasta que termina. Al terminar llega el span `<Tool>` con su duración, entrada y salida. Si falla, lleva un evento `exception` y Laminar la marca como error.
- **Subagentes** `Subagent: <tipo>` cuelgan de la herramienta `Agent` que los lanzó. El hook `SubagentStart` no dice quién lanzó al subagente, así que se empareja con la llamada a `Agent` pendiente más antigua del mismo tipo.
- **Marcadores** de permiso (`⏸`), permiso denegado, notificación (`🔔`), compactación y error de API (`✕`). Llevan `live.marker=true` y `live.state`.

Para relacionar estos spans con los del plugin están los atributos `claude_code.session_id`, `claude_code.prompt_id`, `claude_code.agent_id`, `claude_code.tool.id` (el `tool_use_id`) y `claude_code.cwd`.

## Estados

| Estado | Entra con |
|---|---|
| `idle` | SessionStart, Stop |
| `thinking` | UserPromptSubmit, fin de una herramienta, SubagentStart, PermissionDenied, PostCompact |
| `tool_running` | PreToolUse (`tool`, `tool_use_id`) |
| `awaiting_permission` | PermissionRequest, Notification `permission_prompt` |
| `awaiting_user` | Notification `idle_prompt` |
| `compacting` | PreCompact |
| `background_wait` | Stop con tareas en segundo plano corriendo |
| `error` | StopFailure |
| `done` (subagente), `ended` (sesión) | SubagentStop, SessionEnd |

El agente principal lleva su estado en la sesión; cada subagente, en `agents[<agent_id>]`. Ningún hook avisa cuando empieza una llamada al modelo: `thinking` significa "no está en una herramienta ni esperando".

## Privacidad

- Entrada y salida se recortan a 2 KB. El límite se cambia con `CLAUDE_LIVE_MAX_CHARS`.
- `content`, `old_string`, `new_string`, `new_source` y `edits` se reemplazan por su largo.
- Todo se queda en localhost. El daemon solo escucha en `127.0.0.1`.

## Tests

```bash
python3 -m unittest tools/claude-code-live/test_claude_live.py
```
