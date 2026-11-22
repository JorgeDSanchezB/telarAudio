# ADR-004 — Arquitectura híbrida cliente/backend y qué nodo va a cada lado

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

La app debe funcionar solo en el navegador, pero algunos nodos (RNNoise, Whisper) no son viables en WASM de cliente hoy (peso, memoria, modelo). El usuario exige: cliente-solo por defecto, backend solo cuando se elige un nodo pesado, mensajes claros de qué se ejecuta y dónde.

## Decisión

Cada `DefinicionNodo` declara su `runtime`:

| Nodo | Runtime | Motivo |
| --- | --- | --- |
| fuente-audio | cliente | Trivial: referencia a un activo. |
| fusion-audios | cliente | Web Audio decodifica y `OfflineAudioContext` mezcla; WAV se codifica en ~60 líneas puras. |
| ganancia | cliente | Aritmética sobre el buffer + render offline. |
| limpieza-ruido | **backend** | FFmpeg (afftdn/arnndn) ya existía en `limpiadorAudio`; en cliente exigiría portar FFmpeg+modelos a WASM. |
| transcripción (pendiente) | **backend** | Whisper local: los WASM existentes pesan decenas de MB y saturan la RAM del tab. |
| muletillas (pendiente) | cliente (recibe `dato` de transcripción) | Cortes con crossfade: Web Audio lo hace bien. |
| tensión / música / SFX (pendientes) | cliente sobre `dato` | Heurísticas y mezcla sobre transcripción. |

Reglas del contrato híbrido:

1. El cliente **nunca** intenta ejecutar un nodo de backend en el navegador: sin `ClienteBackend` o sin disponibilidad, el nodo falla con `ErrorConfiguracion` cuyo `mensajeUsuario` trae el comando exacto de arranque.
2. El nodo pesado se ejecuta **solo** tras comprobar `/api/v1/salud` y que la capacidad está anunciada.
3. El usuario siempre ve dónde corre cada cosa: chip «backend» en paleta y tarjeta, mensajes de progreso explícitos («Procesando en el backend local (FFmpeg)…»), indicador de backend en la barra superior.
4. El protocolo de trabajos (202 + sondeo + cancelación + progreso) está en `docs/api/contratos.md`; el cliente lo implementa una sola vez (`ClienteBackendLocal`), no por nodo.

## Problema que resuelve

Satisfacer el requisito de privacidad/funcionamiento sin backend sin renunciar a los nodos pesados.

## Coste

Dos runtimes que mantener; el backend debe estar versionado y con contrato estable; CORS y descubrimiento (salud + capacidades).

## Alternativas descartadas

- **Todo en cliente con WASM** (ffmpeg.wasm para limpieza, whisper-tensorflowjs): ffmpeg.wasm sí se usa, pero solo para el export MP3 opcional; para limpieza sería ~30 MB por carga y más lento que el binario nativo.
- **Backend obligatorio**: rompe el caso «fusionar y editar sin instalar nada más».
- **Servicio en la nube**: contrario al requisito de privacidad (el audio no sale del equipo).
- **Tauri como shell** (lo que hacía limpiadorAudio): el usuario pidió plataforma web.
