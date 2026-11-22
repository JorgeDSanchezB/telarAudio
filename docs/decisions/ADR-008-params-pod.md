# ADR-008 — Parámetros de nodo como especificación POD (no zod/JSON Schema por nodo)

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

Cada nodo declara parámetros que deben: (a) validarse igual en el inspector (en vivo) y en el motor (al ejecutar), (b) poder serializarse con el proyecto, (c) generar formularios dinámicos.

## Decisión

`EspecificacionParametro` es un POD discriminado (`numero | booleano | opcion | activo`) con límites y defectos; `validarValoresParametros` (en `@telar/motor`, probada) es la ÚNICA implementación de la validación, compartida por UI y motor. La configuración global de la app —que sí consume datos externos (archivo JSON)— usa zod estricto en el borde (`cargarConfig`).

## Problema que resuelve

Una sola fuente de verdad para los contratos de parámetros + serialización gratuita (proyectos guardables, UI dinámica, envío futuro de contratos al backend).

## Coste

Un validador propio (~120 líneas) en vez de una librería por nodo; el conjunto de tipos de parámetro es cerrado (ampliarlo toca el motor, pero es un cambio de *contrato*, versionado por `DefinicionNodo.version`).

## Alternativas descartadas

- **zod por nodo**: los esquemas son código (no serializables) y duplicarían la definición del formulario.
- **JSON Schema por nodo**: serializable, pero necesitaríamos un form-generator y un validador JSON-Schema completos (dependencia) para terminar en lo mismo que ya escribimos.
