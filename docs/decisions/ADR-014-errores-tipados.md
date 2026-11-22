# ADR-014 — Taxonomía de errores tipada y RFC 7807 en el borde HTTP

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

El LISTÓN exige distinguir: campo opcional ausente, valor nulo, dato inválido, error temporal, de autorización, de configuración y fallo crítico; no ocultar errores con valores por defecto; y que un nodo que falla no tumba el grafo.

## Decisión

- **En el motor**: `ErrorMotor` + subclases (`ErrorValidacion`, `ErrorConfiguracion`, `ErrorTemporal`, `ErrorAutorizacion`, `ErrorCritico`) con `DetalleFallo {codigo, categoria, mensaje, mensajeUsuario, reintentable}`. `clasificarError` envuelve cualquier excepción sin clasificar como `critico` (se registra, nunca se oculta).
- **En el grafo**: el fallo de un nodo lo deja en `error` con su detalle; sus dependientes en `bloqueado(entrada-error)`; el resto del grafo sigue.
- **En el backend**: todos los errores salen como `application/problem+json` (RFC 7807) con los campos extra `codigo`, `categoria` y `reintentable` (+ `Retry-After` en 429).
- **En el cliente**: `ClienteBackendLocal` traduce cada respuesta a la misma taxonomía (tabla en `docs/api/contratos.md`); la UI muestra `mensajeUsuario` accionable + reintento donde aplica.
- Los casos «ausente» (defecto declarado) y «nulo» (error explícito `PARAM_NULO`) están separados por contrato en la validación de parámetros.

## Problema que resuelve

El mismo vocabulario de fallos de extremo a extremo (nodo → motor → HTTP → UI), con mensajes accionables y sin silencios.

## Coste

Disciplina: cada fallo nuevo necesita código, categoría y `mensajeUsuario` (el registro lo exige para los modos de fallo documentados).

## Alternativa descartada

Excepciones genéricas + try/catch por componente: acaba en errores tragados o en `alert()`s; y HTTPException plano en el backend pierde la categorización que el cliente necesita para decidir reintentos.
