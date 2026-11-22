# ADR-005 — Plan de migración desde los cuatro repositorios existentes

- **Estado:** aceptada (los cuatro nodos pendientes tienen su propio documento con contrato y pasos en `docs/pending/`).
- **Fecha:** 2026-11-21.

## Principios de migración

1. **Nada se arrastra sin contrato**: cada funcionalidad entra como `DefinicionNodo` nueva, con puertos/parámetros/fallos declarados, aunque el código se reutilice.
2. **La lógica pura se recicla; los shells se descartan**: los scripts de procesamiento (Python/FFmpeg) se conservan; las UI (Streamlit, Tauri, pipeline de 7 fases) no.
3. **Un nodo a la vez, verificable de extremo a extremo** antes de pasar al siguiente.
4. El audio del usuario nunca se modifica: todo produce activos nuevos (igual que `eliminaMuletillas` con su carpeta `exports/`).

## limpiadorAudio (React+Tauri / FastAPI / FFmpeg+RNNoise) — migrado en esta pasada

| Origen (reconocido del repo) | Destino en Telar |
| --- | --- |
| Backend FastAPI con servicio local FFmpeg | `backend/app/ffmpeg.py` (ServicioLimpiezaRuido) sobre el mismo patrón: binario FFmpeg + filtros |
| Filtros de reducción | `afftdn` (siempre disponible) y `arnndn` con modelo configurable (`TELAR_RUTA_MODELO_ARNNDN`), en lugar de una receta fija |
| Salida MP3 48 kHz mono | Salida WAV PCM 48 kHz mono por nodo (la conversión MP3 es una acción de exportación opcional, ADR-010) |
| Frontend Tauri que habla con el servicio local | Nodo `limpieza-ruido` en el grafo + `ClienteBackendLocal` (mismo patrón de comunicación, con reintentos/progreso/cancelación tipificados) |

## fusionadorAudios (Next + ffmpeg.wasm / Go) — migrado en esta pasada

| Origen | Destino |
| --- | --- |
| Widget `<audio-merger>` con orden Subir/Bajar | Nodo `fusion-audios`: el orden son las aristas con `orden` (botones ↑↓ del inspector) |
| ffmpeg.wasm single-thread sin SharedArrayBuffer, servido local | Mismo enfoque para el export MP3 (`npm run preparar:ffmpeg`); la fusión misma ahora es Web Audio + WAV nativo (más rápido y sin descargar 30 MB para unir archivos) |
| Versión Go nativa | Fuera de alcance: la plataforma es web; el backend Python ya cubre el trabajo pesado |
| Su “D-01…D-24” y auditorías | Continuamos la práctica de ADRs y árbitro adversarial en `docs/decisions/` |

## eliminaMuletillas (Streamlit + Whisper) — **migrado** (contrato v1.1, ver ADR-015)

- `audio_processor.py` (Whisper `word_timestamps`) → nodo `transcripcion-whisper` (backend) que emite un `dato` tipado + `eliminacion-muletillas` (cliente) que lo consume.
- `filler_words.json` (catálogo editable de muletillas) → catálogo en la configuración validada de la app (mismo formato de lista, ampliable por el usuario).
- Crossfade de 25 ms por defecto → parámetro `fundidoMs` del nodo (defecto 25).
- La UI de revisión de detecciones (aprobar/rechazar) → visor del dato en el inspector: excluir palabra revisa el dato (misma ranura) e invalida solo los consumidores, sin puertas y sin re-transcribir.

## bardoStudio (Next 16, pipeline 7 fases) — **migrado** (ver ADR-015)

- Ingesta (picos/silencios) → ya cubierta por la biblioteca + línea de tiempo; la detección de silencios sigue como variante de análisis pendiente.
- Fase 2 (ASR + tensión por escena) → nodos `transcripcion-whisper` y `analisis-tension` v1 heurística corregible (el LLM queda como decisión de producto abierta, no acoplado).
- Fase 2.5 (SFX por palabras clave) → nodo `colocacion-sfx` con diccionario en configuración (formato de `sfx_config.json`; los 381 términos/archivos originales no se redistribuyen: 6 efectos sintéticos originales de serie).
- Fase 3 (música CC0 por tensión) → nodo `asignacion-musica` (pista de la biblioteca; 2 ambientes sintéticos originales de serie; la selección por banda queda como variante).
- Fases 4–6 (mezcla automática, editor, export) → ya cubiertas por la línea de tiempo + exportación; el ducking por voz implementado por energía en el propio nodo de música.
- El pipeline rígido desaparece por diseño (ADR-001): las fases son nodos que el usuario conecta como quiera.
