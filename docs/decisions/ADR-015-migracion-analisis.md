# ADR-015 — Migración de bardoStudio y eliminaMuletillas: nodos de análisis sobre el contrato v1.1

- **Estado:** aceptada (implementada y verificada: 91 pruebas TS + 23 backend + E2E en navegador con Whisper real).
- **Fecha:** 2026-11-22.

## Contexto

La primera pasada (ADR-005) migró `limpiadorAudio` y `fusionadorAudios` y dejó el resto de los cuatro repositorios como contratos en `docs/pending/`. Esta pasada ejecuta esa deuda: transcripción (Whisper), eliminación de muletillas, análisis de tensión, efectos por contexto y música de fondo.

## Decisiones

1. **Contrato de puertos v1.1**: `DefinicionPuerto.tipoDato?` declara el subtipo de dato en entradas y salidas; `GrafoDag.conectar` lo valida cuando ambos extremos lo declaran. Extensión opcional: los contratos v1.0 siguen válidos.
2. **Almacén de datos de sesión** (`ServicioRegistroDatos`): los nodos de análisis emiten referencias `{tipo:'dato', idDato, tipoDato}`; los consumidores resuelven el contenido al ejecutarse. Las REVISIONES (aprobar/rechazar muletillas, corregir la curva, activar/desactivar colocaciones) actualizan el contenido en la MISMA ranura (`revisar`, revisión+1) e invalidan selectivamente a los consumidores (`motor.invalidar` por arista): el nodo origen caro (Whisper) no se re-ejecuta — verificado en E2E (2 en caché, 4 ejecutados).
3. **Transcripción en el backend** (runtime `backend`, capacidad `transcripcion`): faster-whisper con `word_timestamps`, caché LRU de 1 modelo, bloques reanudables (≤300 s por defecto) con progreso, resultado JSON `transcripcion/v1`. La factoría de routers se extendió con `media_type` para resultados no-WAV.
4. **Tensión sin LLM (v1)**: heurística explicable (densidad de palabras, pausas, signos, léxico) en función pura, corregible arrastrando en el inspector. La variante LLM de bardoStudio queda declarada como opción y falla con `MOTOR_NO_DISPONIBLE` hasta que se decida proveedor: no se promete lo no verificado.
5. **Catálogos en configuración, cero redistribución dudosa**: muletillas, SFX y música viven en `catalogos.*` (zod). El catálogo SFX migra el FORMATO de `sfx_config.json`, no sus 381 términos ni sus 37 archivos (no se redistribuyen). Los 6 SFX y 2 pistas de ambiente por defecto son SINTÉTICOS, generados con FFmpeg/lavfi: originales, sin licencias de terceros (script `scripts/` del entorno de desarrollo).
6. **Ducking por energía**: las ventanas con voz salen del RMS de la propia señal de voz (ventanas de 100 ms + padding), sin necesitar la transcripción.

## Consecuencias

- El grafo acepta ya cadenas `fuente → transcripción → {muletillas, tensión, SFX} → música` completas con revisión interactiva sin puertas de pipeline (el "cañón secuencial" de bardoStudio sigue eliminado por ADR-001).
- La memoria de sesión crece con los datos estructurados; la persistencia real sigue en `docs/pending/persistencia-opfs.md`.
- Los modelos Whisper (75–484 MB por tamaño) viven en `backend/modelos/` fuera del reparto; el error `MODELO_NO_DESCARGADO` explica cómo conseguirlos.
