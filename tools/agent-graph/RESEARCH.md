# Librerías para el grafo de agentes

Verificado el 2026-11-23. Versiones, licencias y fechas salen de los registros npm y PyPI. Lo marcado como "no verificado" es criterio general, no una medición.

## Comparación

| Librería (versión, publicación, licencia) | Layout jerárquico | Grupos/compound | Interacción | 1–5k nodos | HTML estático (CDN) | Encaje en el frontend de lmnr |
|---|---|---|---|---|---|---|
| **Cytoscape.js** 3.35.0, 2026-11-10, MIT. Extensiones: `cytoscape-dagre` 4.1.0 / `cytoscape-elk` 2.4.0, MIT. | Bueno con dagre. ELK queda más pulido pero es más pesado. | Nativo (`parent`) | Zoom, pan, selectores. Expandir/colapsar requiere una extensión (no verificado). | Aceptable con canvas. El layout de miles de nodos puede tardar (no verificado). | Sí, UMD. Dagre viene incluido en el bundle de la extensión. | Wrapper propio |
| **React Flow (`@xyflow/react`)** 13.0.3, 2026-11-23, MIT | No trae layout propio: se usa dagre (`@dagrejs/dagre` 3.1.3) o `elkjs` 0.12.1 (EPL-2.0 OR GPL-3.0+). | Sub-flows (`parentId`) | Excelente: nodos como componentes React | Peor (DOM). Hacen falta colapsar ramas y virtualización. | No (requiere React y build) | **El mejor.** lmnr ya depende de `@xyflow/react` ^12.8.3 y `dagre` ^0.8.5 (`frontend/components/lang-graph/`). |
| **vis-network** 10.1.5, 2026-11-08, Apache-2.0 OR MIT | `hierarchicalLayout`, tosco | Solo clusters | Buena | Aceptable | Sí | Wrapper manual |
| **PyVis** 0.3.2, 2023-02-24, BSD | El de vis-network | No | El de vis-network | Aceptable | Genera HTML | No aplica. Sin releases desde 2023. |
| **Sigma.js** 4.0.6 + `graphology` 0.26.0, MIT | Solo layouts de fuerzas | No | Zoom y hover. Lo demás es manual. | **El mejor** (WebGL) | Posible | Viable, pero sobra para un árbol |
| **Apache ECharts** 6.1.0, 2026-05-19, Apache-2.0 | `tree` sirve para la vista por sesión. `graph` solo tiene force y circular. | No | Buena. **Sankey** encaja para el flujo de tokens o costo. | Bueno (canvas) | Sí | `echarts-for-react` (no verificado) |
| **Graphviz / Mermaid** (Mermaid 12.3.0, MIT) | Muy bueno (dot) | Subgraphs | Estático | Mermaid se degrada con muchos nodos (no verificado) | Sí | Solo imagen o SVG |

## Referencias de diseño

- **Langfuse**, [agent graphs](https://langfuse.com/docs/observability/features/agent-graphs). Tiene un modo agregado (fusiona pasos con el mismo nombre en un nodo con contador) y un modo expandido (un nodo por llamada). Es el mismo par de vistas que `--mode types` / `--mode session`.
- **Arize AX**, [Agent Graph](https://arize.com/docs/ax/observe/tracing-concepts/agent-graphs). Construye el flujo con metadatos de spans (`graph.node.parent_id`). No está verificado si existe en Phoenix OSS.
- **LangGraph Studio**: dibuja la arquitectura definida en el código, no un grafo derivado de trazas.
- **AgentOps**: la documentación oficial muestra cascada de sesión y llamadas LLM. No se confirmó que tenga una vista de grafo.

## Decisión

- **Prototipo estático (esta herramienta):** Cytoscape.js + `cytoscape-dagre`. Es la única opción que, con dos `<script>` y sin build, da layout jerárquico, nodos compuestos y estilos dirigidos por datos.
- **Vista futura dentro de lmnr:** `@xyflow/react` + dagre, que el frontend ya tiene, con nodos custom que muestren tokens, costo y modelo, y ramas colapsadas por defecto. Si el volumen de nodos la vuelve lenta, se puede montar Cytoscape en un componente cliente. ECharts sankey queda para la vista de flujo de costo. `elkjs` tiene licencia EPL/GPL y conviene revisarla antes de usarla en el producto.
