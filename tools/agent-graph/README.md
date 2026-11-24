# agent-graph

Grafo interactivo de agentes a partir de las trazas que el plugin de Laminar para Claude Code (`lmnr@lmnr`) guarda en ClickHouse. Muestra quién lanzó a quién (agente principal → subagentes → subagentes anidados) y cuánto consume cada uno: tokens, costo y llamadas LLM.

## Uso

```bash
python3 tools/agent-graph/extract.py                      # vista por tipo de subagente, todas las sesiones
python3 tools/agent-graph/extract.py --tools              # además, nodos de tools (ocultos por defecto en el visor)
python3 tools/agent-graph/extract.py --mode session --session 9cca3622   # una sesión: una instancia por nodo
python3 tools/agent-graph/extract.py --project tfm --since 2026-11-20 --until 2026-11-23   # [since, until)
```

Se escriben dos archivos en `out/`, que está en `.gitignore`:

- `graph.json`: nodos, aristas y `flow`, con los enlaces del diagrama de flujo;
- `agent-graph.html`: visor autónomo con los datos incrustados. Se abre directamente o se sirve con `python3 -m http.server`.

El visor tiene dos pestañas:
- **Grafo** muestra quién lanzó a quién. Al hacer clic en un nodo se ve su consumo, con una tabla por modelo.
- **Flujo de consumo** es un diagrama Sankey en tokens o en costo, según el selector *Tamaño*.

El encabezado muestra el rango de fechas de los turnos incluidos.

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
- `by_model` reparte el consumo propio de cada nodo por modelo.
- **Flujo (`flow`):** los nodos son `<tipo> · nivel N`, con N = nivel de anidamiento, para que el diagrama no tenga ciclos aunque un tipo se lance a sí mismo.
  - Cada lanzamiento lleva todo lo que consumió la instancia lanzada, incluidos sus propios subagentes.
  - Cada agente desagua su consumo propio en un sumidero común, `Consumo propio`.
  - Por eso, en cada nodo intermedio lo que entra es igual a lo que sale, y el sumidero suma el total.

Invariantes que comprueba la verificación:
- la suma de `self_tokens` de todos los nodos es igual a `sum(total_tokens)` de los spans LLM filtrados;
- para cada subagente, la suma de tokens de sus aristas entrantes es igual a su `self_tokens`;
- en cada nodo, la suma de `by_model` es igual a `self_tokens`;
- en el flujo, el sumidero suma `meta.total_tokens`, y en cada nodo intermedio entra lo mismo que sale.

Si un turno aparece exportado más de una vez (la misma raíz `Claude Code - Turn N` en una sesión con varios `trace_id`), el script lo advierte por stderr y lo deja en `meta.duplicate_turns`. Mientras esas trazas sobrantes no se borren, los totales salen inflados. La causa es el timeout del plugin; ver `tools/claude-code-lmnr/`.

## Librería

Cytoscape.js 3.35.0 con `cytoscape-dagre` 4.1.0 para el grafo, y ECharts 6.1.0 para el diagrama Sankey; todo por CDN y sin build. La comparación está en [RESEARCH.md](RESEARCH.md).
