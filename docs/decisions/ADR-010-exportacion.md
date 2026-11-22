# ADR-010 — Exportación: WAV nativo + ffmpeg.wasm (UMD) opcional para MP3

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

`fusionadorAudios` exportaba con ffmpeg.wasm. Para Telar hay dos necesidades: la salida de nodos/bounces (WAV) y la conversión MP3 opcional. Además `next build` (Turbopack) no puede analizar estáticamente la build ESM de `@ffmpeg/ffmpeg` 0.12 (`new Worker(new URL(classWorkerURL, import.meta.url))` rompe el build con «Can't resolve (<dynamic> | 'undefined')»).

## Decisión

1. **WAV nativo**: codificador propio de PCM 16 bits (~60 líneas puras, probado con round-trip de cabeceras y cuantización). Es el formato de trabajo de toda la sesión: rápido, sin dependencias, sin descargas.
2. **MP3 con ffmpeg.wasm, carga diferida y núcleo autohospedado**: `npm run preparar:ffmpeg` copia desde `node_modules` (sin red en runtime) el núcleo single-thread (30,7 MB), el worker y el **bundle UMD** a `public/ffmpeg/`. El exportador inyecta el UMD con `<script>` dinámico y llama a `load({coreURL, wasmURL})` sin `classWorkerURL`: la build UMD resuelve su worker desde su propia ruta pública, evitando el análisis de Turbopack por completo.
3. Núcleo **single-thread**: no requiere cabeceras COOP/COEP (SharedArrayBuffer), que aislarían el documento y romperían la carga de audio externo.

## Problema que resuelve

Export base sin fricción; MP3 sin CDN, sin romper el build, con degradación clara (error `FFMPEG_NO_PREPARADO` con el comando exacto; WAV sigue funcionando).

## Coste

30 MB en `public/ffmpeg` (regenerables, fuera del repo) y primera conversión lenta (carga del núcleo). El MP3 quedó **implementado pero no verificado en navegador** en el entorno de generación (sí lo está la copia de binarios y la lógica de carga); verificación manual: ejecutar `npm run preparar:ffmpeg`, abrir la app, botón MP3 de la biblioteca.

## Alternativas descartadas

- **ffmpeg.wasm para todo** (como fusionadorAudios): 30 MB para unir archivos que Web Audio une sin nada; más lento y más frágil.
- **lamejs para MP3**: dependencia menos mantenida, misma tarea bien resuelta por ffmpeg con un comando.
- **Export en el backend**: convertiría el export de un producto «client-first» en dependiente del backend opcional.
