# Pendiente — Picos precalculados en Worker para audios de varias horas

**Estado: NO implementado.** (Regla del «audio infinito»: la estrategia actual y sus límites están en `docs/arquitectura/05-renderizado.md`.)

## Situación actual (límite honesto)

`@waveform-playlist` calcula los picos desde el `AudioBuffer` ya decodificado y dibuja por píxel; el coste de DIBUJO escala con píxeles, pero el audio completo vive decodificado en memoria (~10 min estéreo 48 kHz ≈ 115 MB; ~1 h ≈ 700 MB). Con varias horas, el límite es la RAM de la pestaña, no el render.

## Diseño previsto

1. **Picos precalculados en Web Worker**: al subir un activo, un worker calcula picos multiresolución (por bloques de muestras) SIN bloquear el hilo principal; se persisten junto al activo (ver `persistencia-opfs.md`).
2. **Carga diferida del waveform**: `@waveform-playlist` acepta `waveformData` precalculado (su API `loadWaveformData`/`ClipPeaks` ya existe para eso): los clips pueden dibujarse con picos ANTES de decodificar el audio.
3. **Decodificación por ventanas**: solo decodificar (y mantener) el tramo visible ± margen; el playback usa `MediaElement`-style streaming o decodificación por bloques según lo que la librería permita sin forks.
4. Documentar el límite resultante medido (p. ej. «6 h de narración con X MB de RAM»).

## Por qué no ahora

Los pasos 1–3 dependen de la persistencia (para no recalcular picos en cada sesión) y de validar el comportamiento de la librería con `waveformData` + clips largos; hacerlo a ciegas habría sido especulación no verificable.
