# ADR-002 — React Flow (@xyflow/react) para la UI de nodos

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

La UI debe permitir arrastrar nodos, conectarlos con cables, reflejar estados (inactivo, en-cola, ejecutando, listo, caché, error, bloqueado, desactivado) y ser extensible: nodos nuevos aparecen sin tocar componentes.

## Decisión

`@xyflow/react` (React Flow v13) para el lienzo, con un único tipo de nodo personalizado (`telar-nodo`) cuya tarjeta se compone de los datos del contrato (puertos ⇒ `Handle`s, parámetros ⇒ resumen, estado ⇒ insignia + progreso + acciones).

## Problema que resuelve

Todo el trabajo hostil de un editor de grafos: hit-testing de cables, anchors, pan/zoom táctil, selección múltiple, teclas de borrado, minimapa, virtualización de viewport.

## Coste

Una dependencia de UI central (mantiene su CSS base), y ajustarse a su modelo controlado (derivamos nodos/aristas con `useMemo` y solo reenviamos eventos hacia el almacén).

## Alternativas descartadas

- **rete.js**: motor de edición de grafos más «de datos», pero su React plugin está menos consolidado y su DOM de nodos es menos directo de estilar que el de React Flow.
- **drawflow**: sin React nativo ni TypeScript sólido; mantenimiento irregular.
- **Lienzo propio (canvas/SVG)**: 2–4 semanas de trabajo para llegar a la mitad de las features, manteniéndolo nosotros para siempre.
- **El editor de bardoStudio**: era tipo Camtasia sobre una sola pista; no es un editor de grafos.
