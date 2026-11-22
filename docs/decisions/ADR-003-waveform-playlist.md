# ADR-003 — @waveform-playlist/browser (v16) como base del editor de línea de tiempo

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

El editor de `bardoStudio` estaba «muy mal hecho» y debe mejorarse muchísimo: waveforms multipista, mover/recortar/dividir clips con colisión, undo/redo, zoom, selección, playback, y cabecera para la edición destructiva. Construirlo desde cero es la decisión más cara del proyecto.

## Decisión

Usar `@waveform-playlist/browser` 16 (el paquete publicado más reciente de `waveform-playlist`), que en su reescritura React ofrece exactamente el modelo que necesitamos: proveedor con `tracks` controlados + `onTracksChange` (el documento es fuente de verdad), `ClipInteractionProvider` (arrastrar/recortar con colisión), `useClipSplitting`, botones de transporte, tema, y picos desde `AudioBuffer`.

La sesión del usuario pedía «@waveform-playlist/browser (naomiaro)»: verificado que existe en npm (v16.0.1) y que es el sucesor del paquete clásico `waveform-playlist` (v4.x). Se usó el paquete scoped, no el clásico.

## Problema que resuelve

Todo el riesgo del editor: renderizado de waveforms en canvas, edición de clips con colisiones, transporte y atajos, con mantenimiento upstream.

## Coste

- Peers obligatorios (`styled-components`, `@dnd-kit/*`, `tone`) que se instalan con la app aunque solo los use la librería.
- El undo/redo de la librería no cubre nuestras operaciones estructurales y destructivas: mantenemos nuestro propio `Historial` (`@telar/linea-tiempo`) como única fuente de deshacer (ADR-011).
- El documento vive en los tipos de la librería (`ClipTrack`/`AudioClip`): aceptado a cambio de no mantener un modelo paralelo con sincronización bidireccional.

## Alternativas descartadas

- **Editor propio**: meses de trabajo y todo el riesgo de bugs en la zona que el usuario más critica del proyecto anterior.
- **wavesurfer.js + capa de clips propia**: wavesurfer es un visualizador; la capa de edición multipista habría sido de nuevo construcción propia.
- **Timeline de producción (Pierz's react-timeline-editor, x Timeline)**: orientadas a video/animación con keyframes; el modelo de clips de audio con trim por bordes no encaja tan directo.
