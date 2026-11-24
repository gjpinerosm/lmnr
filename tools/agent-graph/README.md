# agent-graph

Grafo interactivo de agentes a partir de las trazas que el plugin de Laminar para Claude Code (`lmnr@lmnr`) guarda en ClickHouse. Muestra quién lanzó a quién (agente principal → subagentes → subagentes anidados) y cuánto consume cada uno: tokens, costo y llamadas LLM.

## Uso

```bash
python3 tools/agent-graph/extract.py                      # vista por tipo de subagente, todas las sesiones
python3 tools/agent-graph/extract.py --tools              # además, nodos de tools (ocultos por defecto en el visor)
python3 tools/agent-graph/extract.py --mode session --session 9cca3622   # una sesión: una instancia por nodo
python3 tools/agent-graph/extract.py --project tfm --since 2026-11-20
```

Se escriben dos archivos en `out/`, que está en `.gitignore`:

- `graph.json`: nodos y aristas;
- `agent-graph.html`: visor autónomo con los datos incrustados. Se abre directamente o se sirve con `python3 -m http.server`.

Solo usa la biblioteca estándar de Python. Las credenciales se leen del `.env` de la raíz del repo. Si `localhost:8123` no responde (el `docker-compose.yml` no publica ese puerto), el script consulta con `docker exec clickhouse clickhouse-client`.

## Modelo

| Elemento de la traza | En el grafo |
|---|---|
| `Claude Code - Turn N (…)` (raíz) | Agente principal. Uno por proyecto (`metadata.cwd`) en la vista `types`, uno por sesión en la vista `session`. |
| `Subagent: <descripción>` (hijo de la tool `Agent`) | Subagente, identificado por `claude_code.subagent.type` |
| Span LLM | Se suma al agente dueño: el ancestro `Subagent:` más cercano o, si no hay, la raíz del turno |
| Span tool | `tool_calls` del agente dueño, y un nodo de tool opcional con `--tools` |

- La jerarquía se reconstruye por `parent_span_id`, porque `lmnr.span.ids_path` viene vacío.
- `self_*` es el consumo propio del agente. `total_*`, solo en la vista `session`, incluye todo lo que lanzó.
- Cada arista lleva los tokens y el costo de las instancias que lanzó su origen.

Invariantes que comprueba la verificación:
- la suma de `self_tokens` de todos los nodos es igual a `sum(total_tokens)` de los spans LLM filtrados;
- para cada subagente, la suma de tokens de sus aristas entrantes es igual a su `self_tokens`.

Si un turno aparece exportado más de una vez (la misma raíz `Claude Code - Turn N` en una sesión con varios `trace_id`), el script lo advierte por stderr y lo deja en `meta.duplicate_turns`. Mientras esas trazas sobrantes no se borren, los totales salen inflados. La causa es el timeout del plugin; ver `tools/claude-code-lmnr/`.

## Librería

Cytoscape.js 3.35.0 con `cytoscape-dagre` 4.1.0, por CDN y sin build. La comparación está en [RESEARCH.md](RESEARCH.md).
