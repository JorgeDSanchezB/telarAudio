# ADR-009 — Monorepo npm workspaces con paquetes «fuente» sin build propio

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

Cinco paquetes TS (`motor`, `nodos`, `linea-tiempo`, `ui`, `app`) con dependencias internas. El usuario pide monorepo modular; el LISTÓN pide `npm install && npm run dev` sin pasos ocultos.

## Decisión

- **npm workspaces** (sin pnpm/yarn/bun obligatorios): un solo `npm install` y un solo lockfile. Dependencias internas con versión `"*"` (compatibles también con pnpm si el usuario lo prefiere).
- Los paquetes internos **publican su fuente** (`exports` → `src/index.ts`) y Next los transpila con `transpilePackages`; vitest los resuelve con alias. Ningún paso de build por paquete: `npm run dev` y `npm test` siempre ven el código real.

## Problema que resuelve

Cero orquestación de builds, un comando por tarea, y los límites de paquete siguen existiendo (imports solo por la barra pública de cada paquete; `@telar/motor` no puede importar `@telar/nodos`).

## Coste

Los paquetes no son publicables en npm tal cual (sería necesario añadirles build); aceptado: son internos del producto. Publicación futura = añadir `tsup`/`tsc -b` a los paquetes que se deseen publicar, sin tocar a los consumidores.

## Alternativas descartadas

- **Turborepo/Nx**: caché de builds y pipelines para 5 paquetes sin build: pura sobrecarga (más un daemon en el caso de Nx).
- **Build por paquete (tsc -b + project references)**: estado de build caducable entre paquetes y CI más lento para ganar nada en un monorepo de una app.
- **pnpm workspaces**: excelente, pero obligar a una herramienta extra contradice «npm install y funciona».
