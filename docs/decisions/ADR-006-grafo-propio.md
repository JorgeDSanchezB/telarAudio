# ADR-006 — Grafo propio (~200 líneas, sin dependencias) en lugar de graphology

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

La orquestación del DAG necesita un subconjunto mínimo de teoría de grafos: adición/eliminación validada de nodos y aristas, detección de ciclos, orden topológico, cierres transitivos (dependencias/dependientes). El usuario sugirió «graphology u otra librería ligera».

## Decisión

Implementar `GrafoDag` a mano en `@telar/motor` con pruebas exhaustivas (10 tests de invariantes y recorridos).

## Problema que resuelve

El paquete más crítico del sistema (el núcleo del motor) queda con **cero dependencias externas**: auditable de una sentada, ejecutable en Node y navegador sin condicionales, y con una API exactamente ajustada al dominio (puertos validados contra contratos, aristas ordenables, podas).

## Coste

~200 líneas propias que mantener (Kahn para orden topológico, DFS para ciclos). Si mañana hiciera falta multigrafo o layouts, la clase está detrás de una interfaz estrecha y sustituirla por graphology sería un cambio local.

## Alternativas descartada

**graphology (+ graphology-dag):** aporta un general-purpose graph store (multigrafo, atributos, algoritmos) del que usaríamos ~10 %, a cambio de una dependencia en el paquete que menos dependencias debería tener y de una API que habría que adaptar igualmente a puertos/contratos (la validación de puertos es específica de este dominio y habría que escribirla encima).
