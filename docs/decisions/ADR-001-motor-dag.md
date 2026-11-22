# ADR-001 — Motor de procesamiento no lineal (DAG) en lugar de pipeline secuencial

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

`bardoStudio` organiza la postproducción en 7 fases con «puertas»: no se avanza sin aprobar la fase anterior. Para narradores eso significa: recomputar fases completas ante cualquier cambio, no poder comparar variantes en paralelo, y no poder saltarse pasos que no se necesitan.

## Decisión

Un **grafo acíclico dirigido** es el modelo de ejecución: cada operación es un nodo independiente con contrato declarativo; el usuario activa las ramas que quiere; el motor:

1. computa **solo** el cierre (podado) de los nodos objetivo — desactivar un nodo evita además el cómputo de lo que exclusivamente lo alimentaba;
2. **cachea** resultados con claves encadenadas por contenido (tipo, versión, parámetros, claves de entradas): cambiar un parámetro re-ejecuta esa rama y sus dependientes, las ramas hermanas salen de caché;
3. **paraleliza** nodos independientes con límite configurable;
4. propaga **errores tipados** sin tumbar el grafo y permite reintentar solo la rama fallida.

## Problema que resuelve

Rigidez, recomputación innecesaria e imposibilidad de ramificar variantes.

## Coste

Complejidad del planificador (~300 líneas, con pruebas), estados con más vocabulario (bloqueado, caché, en-cola) que el usuario debe entender (mitigado con insignias y motivos), y la obligación de que los procesadores sean deterministas (contrato documentado).

## Alternativas descartadas

- **Pipeline secuencial con puertas** (bardoStudio): es exactamente lo que el usuario pide sustituir.
- **Motores de workflow** (Temporal, n8n, XState orchestrations): sobredimensionados para un grafo en memoria de una pestaña; añaden runtime, serialización y conceptos ajenos al dominio.
- **Notebook de celdas dependientes** (estilo Jupyter): buen ajuste conceptual, pero la UI de nodos con cables pedida por el usuario ya es ese modelo con mejor affordance.
