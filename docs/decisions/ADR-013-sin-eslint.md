# ADR-013 — Sin ESLint ni formateador configurados en esta pasada

- **Estado:** aceptada (revisable).
- **Fecha:** 2026-11-21.

## Contexto

El LISTÓN exige calidad de ingeniería senior. Las herramientas clásicas de calidad JS/TS son ESLint + Prettier + husky.

## Decisión

En esta pasada la calidad se garantiza con: **TypeScript estricto** (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) verificado con `npm run tipos` + `next build`, **75 pruebas** (vitest + pytest) y revisión adversarial. No se configura ESLint/Prettier.

## Problema que resuelve / coste

Evita una capa de configuración con reglas discutibles y tiempos de CI extra en la primera iteración del producto. Coste: no hay red de captura para descuidos de estilo (p. ej. imports sin usar) hasta añadir ESLint — tarea pequeña y aislada cuando el equipo crezca.

## Alternativa descartada

ESLint con `next/core-web-vitals` desde el día uno: decisión legítima; se pospone conscientemente porque `tsc --noEmit` + pruebas + árbitro ya cubren los fallos funcionales, y la base de código es nueva y pequeña.
