# ADR-007 — zustand para el estado de la aplicación

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

La app tiene una sola página con: estado del grafo, proyección de estados del motor (eventos a alta frecuencia durante progreso), biblioteca, documento de línea de tiempo, avisos y pestañas. El estado del motor debe quedar FUERA de React para no re-renderizar a cada tick de progreso.

## Decisión

zustand v5: un almacén plano con selectores finos por campo; el motor vive en un singleton externo y el almacén solo proyecta sus eventos (`nodo:estado` → `estadosNodos[id]`).

## Problema que resuelve

Suscripción granular sin Providers, sin dispatch ni reducers, con tipado sencillo.

## Coste

Convención propia (las acciones viven dentro del almacén y usan `get()/set()`); dependencia pequeña y estable.

## Alternativas descartadas

- **Redux Toolkit**: boilerplate desproporcionado para una página; el patrón normalizado no aporta nada aquí.
- **Context + useReducer**: cualquier actualización de progreso re-renderizaría consumidores enteros; exactamente lo que queremos evitar.
- **Jotai/Recoil**: átomos finos pero con modelo mental extra; zustand cubre lo mismo con menos superficie.
