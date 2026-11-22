# Telar Audio

Plataforma web unificada de **postproducción de audio para narración en español** (cuentos, audiolibros, podcasts narrativos). Integra en un solo producto las funcionalidades de cuatro proyectos anteriores (`limpiadorAudio`, `eliminaMuletillas`, `bardoStudio`, `fusionadorAudios`), sustituyendo su pipeline secuencial por un **motor de procesamiento no lineal basado en DAG** con **UI de nodos visuales** y un **editor de línea de tiempo** con edición destructiva y no destructiva.

Todo el procesamiento ligero ocurre **en tu navegador** (Chrome de escritorio). El audio que subes no sale de tu equipo. Un **backend opcional** (Python/FastAPI) ejecuta los nodos pesados (limpieza de ruido con FFmpeg y transcripción con Whisper) cuando lo arrancas.

---

## Qué está implementado y qué no

| Funcionalidad | Estado | Dónde |
| --- | --- | --- |
| Motor DAG (solo nodos necesarios, caché selectiva, paralelismo, cancelación, reintentos) | **Implementado y probado** | `packages/motor` |
| Interfaz `AudioProcessor` tipada + registro extensible sin tocar el núcleo | **Implementado y probado** | `packages/motor`, `packages/nodos` |
| Contrato v1.1 de puertos: datos tipados (`tipoDato`) validados al conectar | **Implementado y probado** | `packages/motor` |
| Nodo **Fuente de audio** (biblioteca → grafo) | **Implementado y verificado en navegador** | `packages/nodos` |
| Nodo **Fusión de audios** (end-to-end: subir → conectar → ejecutar → descargar) | **Implementado y verificado en navegador** | `packages/nodos`, `packages/app` |
| Nodo **Ganancia / Normalización de pico** | **Implementado** (lógica pura probada) | `packages/nodos` |
| Nodo **Limpieza de ruido** (delegado al backend FFmpeg) | **Implementado y verificado** (navegador + backend real) | `packages/nodos`, `backend` |
| Nodo **Transcripción (Whisper)** con marcas por palabra, resultado revisable | **Implementado y verificado en navegador** (Whisper real, E2E) | `packages/nodos`, `backend/app/whisper.py` |
| Nodo **Eliminar muletillas** (catálogo en config, revisión aprobar/rechazar) | **Implementado y verificado en navegador** | `packages/nodos` |
| Nodo **Análisis de tensión** (heurística explicable, curva corregible arrastrando) | **Implementado y verificado en navegador** (variante LLM pendiente de decisión) | `packages/nodos` |
| Nodo **Efectos de sonido por contexto** (diccionario en config, colocaciones activables) | **Implementado y verificado en navegador** | `packages/nodos`, `public/sfx` |
| Nodo **Música de fondo** (loop por tensión + ducking por energía de voz) | **Implementado y verificado en navegador** | `packages/nodos`, `public/musica` |
| UI de nodos visuales (arrastrar, conectar, desconectar, estados, progreso, borrado con Suprimir/Retroceso y multiselección con Mayús) | **Implementada y verificada en navegador** | `packages/ui` |
| Editor de línea de tiempo (waveforms, mover/recortar/dividir, undo/redo, corte destructivo persistente) | **Implementado y verificado en navegador** | `packages/ui`, `packages/linea-tiempo` |
| Backend opcional FastAPI (trabajos con progreso, cancelación, paginación, rate limit, RFC 7807) | **Implementado y probado** (incluida transcripción real con voz) | `backend` |
| Exportación WAV | **Implementada** (codificador propio probado) | `packages/nodos` |
| Exportación MP3 (ffmpeg.wasm) | **Implementada, NO verificada en navegador en el entorno de generación** (ver «Exportar MP3») | `packages/app` |
| Subida de audio con transcodificación de rescate (AMR, 3gp, WMA, ALAC…) | **Implementada y verificada en navegador** (rescate con backend real y con ffmpeg.wasm; aviso por etapa y error honesto si ambos fallan) | `packages/app`, `backend` |
| Guardar/cargar proyectos `.telar.json` (línea de tiempo con audio embebido sin pérdida + transcripciones/datos con sus revisiones) | **Implementado y verificado en navegador** (ida y vuelta completa: guardar → recargar → cargar) | `packages/app` (ADR-016) |
| Persistencia automática entre sesiones (IndexedDB/OPFS) | **NO implementada**: los proyectos se guardan/cargan a mano con «Guardar/Abrir»; el guardado automático sigue en `docs/pending/persistencia-opfs.md` | `docs/pending/` |

La lista completa de decisiones técnicas está en `docs/decisions/` (ADR-001…ADR-016).

---

## Requisitos

- **Node.js ≥ 20.19** (verificado con Node 24) y npm ≥ 10.
- Navegador **Chrome de escritorio** (usa Web Audio API, WebAssembly y Canvas).
- Para el backend opcional: **Python 3.11+** (verificado con 3.12) y **FFmpeg** instalado en el sistema (`apt install ffmpeg` o equivalente; verificado con FFmpeg 7.1).

## Instalación y arranque (cliente)

```bash
npm install     # una vez, en la raíz del monorepo
npm run dev     # http://localhost:3000
```

Comandos equivalentes verificados en el entorno de generación:

```bash
npm run build   # build de producción (Next 16 / Turbopack)
npm start       # sirve el build de producción
```

## Backend opcional (nodos pesados)

Hace falta para los nodos **Limpieza de ruido** y **Transcripción (Whisper)**, y para el rescate de formatos que el navegador no decodifica (AMR, WMA…) cuando ffmpeg.wasm no está preparado. Sin él, el resto de la aplicación funciona al 100 % en el navegador.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # en Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

### Transcripción: descargar los modelos de Whisper

El nodo de transcripción usa [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CPU, int8). Los modelos NO se incluyen en el repo: colócalos en `backend/modelos/whisper-<tamaño>/` con `model.bin`, `config.json`, `tokenizer.json` y `vocabulary.txt`. Descárgalos de los repos oficiales `Systran/faster-whisper-<tamaño>` en Hugging Face (p. ej. con `huggingface-cli download Systran/faster-whisper-small --local-dir backend/modelos/whisper-small`). Tamaños: `tiny` (~75 MB, rápido), `base` (~145 MB), `small` (~484 MB, mejor calidad; es el defecto, configurable en `transcripcion.modeloDefecto`). Si el modelo elegido falta, el nodo falla con `MODELO_NO_DESCARGADO` y te lo explica. `GET /api/v1/salud` lista los modelos disponibles (`modelos_whisper`).

La app lo detecta sola (indicador «Backend local activo» en la barra superior; botón «Comprobar» para reintentar). La app se conecta al backend a través de la ruta `/backend` de su propio origen: Next la redirige a `127.0.0.1:8000` (ver `packages/app/next.config.ts`), de modo que funciona igual en local y detrás de proxies que solo exponen un puerto. Para apuntar a otra dirección, cambia `backend.url` en `packages/app/src/config/config.default.json` (acepta una URL absoluta `http://…` o una ruta raíz `/…`). Para el filtro `arnndn` (RNNoise) coloca un modelo `.rnnn` en `backend/modelos/std.rnnn` (p. ej. de [rnnoise-models](https://github.com/GregorR/rnnoise-models)); el filtro `afftdn` no necesita nada.

Configuración del backend (límites, tasa, TTL, mapeos de intensidad): variables con prefijo `TELAR_` o archivo `backend/.env`; ver `backend/app/config.py`.

## Pruebas y verificación

```bash
npm test        # 91 pruebas (motor DAG, nodos, análisis, línea de tiempo) — vitest
npm run tipos   # verificación de tipos (tsc --noEmit) de los 4 paquetes
npm run build   # build de producción
cd backend && python3 -m pytest tests/   # 23 pruebas del backend (una con Whisper real si hay modelo)
```

Las pruebas de integración con FFmpeg (`backend/tests/test_ffmpeg_real.py`) se saltan solas si no hay binario `ffmpeg`/`ffprobe` en el sistema.

## Guía de 5 minutos

1. Arranca el cliente (`npm run dev`) y, si quieres limpieza de ruido, el backend.
2. ¿Primer contacto? En el lienzo vacío pulsa **«Cargar narración de ejemplo»**: monta y conecta Fuente → Ganancia (−3 dB) → Fusión, lista para ejecutar.
3. Pestaña **Biblioteca** → «+ Añadir archivos de audio» → sube tu narración (WAV/MP3/OGG/M4A; si el navegador no soporta el códec —AMR, 3gp, WMA…— se transcodifica a WAV automáticamente con ffmpeg.wasm o el backend local).
4. Pestaña **Nodos** → añade una **Fuente de audio** por archivo y elige el archivo en su inspector.
5. Añade **Fusión de audios** (o **Limpieza de ruido**, o **Ganancia**) y conecta arrastrando desde el punto de la derecha de la fuente hasta la entrada del nodo. En la fusión, ordena las conexiones con ↑↓ en el inspector.
6. Pulsa **▶ Ejecutar grafo**. Cada nodo muestra su estado (en cola, ejecutando con progreso, listo —con destello de celebración—, en caché, error con botón reintentar); los hilos del grafo se animan mientras se teje. Borra nodos o conexiones seleccionándolos y pulsando **Suprimir** (o **Retroceso**); con **Mayús+clic** seleccionas varios a la vez.
7. **⤓ Descargar** la salida del nodo, o **⇥ A línea de tiempo** para editarla: arrastra clips, recorta bordes, divide con `S`, deshaz con `Ctrl+Z`.
8. **✂ Eliminar región (persistente)**: selecciona un trozo de una pista y persiste el audio recortado de verdad (nuevo archivo en la biblioteca).
9. **⤓ Mezclar y exportar**: mezcla todas las pistas audibles en un WAV y lo descarga.

## Sistema visual «taller nocturno»

La identidad vive en `packages/ui/src/estilos/telar.css` (ADR-012: CSS plano con tokens):

- **Paleta**: base ciruela-cálida casi negra, hilo firmo ocre→terracota, un color por categoría de nodo (los «hilos» del telar). El contraste de cada combinación texto/fondo está medido y verificado (AA/AAA) en `scripts/contraste.js`.
- **Tipografía**: Fraunces (identidad editorial), Space Grotesk (interfaz), JetBrains Mono (datos y estados).
- **El hilo como semántica**: en reposo el hilo superior de cada nodo está tenue (identidad); se enciende con hover, selección y ejecución (atención). La selección estira el hilo de borde a borde y enciende las aristas conectadas.
- **Momento de ejecución**: los hilos del grafo corren (dash animado) y cada nodo que pasa a LISTO destella una vez con su color.
- **Estados honestos**: los CTA se deshabilitan con la razón en el tooltip («El grafo está vacío…»); la validación fallida se ve en el lienzo (chip «revisar») y desactiva la ejecución del nodo; la barra de la línea de tiempo se atenúa cuando no hay pistas.
- **Sin texto ajeno**: el transporte de la línea de tiempo usa iconos propios (máscaras CSS) y el selector de formato de tiempo está en español.
- **Accesibilidad**: foco visible unificado, `prefers-reduced-motion` respetado, barras de desplazamiento propias, `::selection` de marca.

## Exportar MP3 (opcional, una sola vez)

```bash
npm run preparar:ffmpeg   # copia ffmpeg.wasm (~31 MB) desde node_modules a public/ffmpeg
```

Después, el botón **MP3** de la biblioteca convierte cualquier activo a MP3 (192 kbps por defecto, configurable). Sin este paso, ese botón muestra un error de configuración con estas mismas instrucciones; el export **WAV funciona siempre**.

## Estructura del monorepo

```
telar-audio/
├── packages/
│   ├── motor/          # Núcleo del DAG (sin dependencias): grafo, contratos (v1.1 con datos tipados), registro, planificador, caché
│   ├── nodos/          # Nodos incluidos: fuente, fusión, ganancia, limpieza-ruido, transcripción, muletillas, tensión, SFX, música
│   ├── linea-tiempo/   # Dominio del editor: operaciones puras validadas + historial undo/redo
│   ├── ui/             # Presentación: lienzo React Flow, paleta, inspector (con visores de datos), editor de línea de tiempo
│   └── app/            # Aplicación Next.js 16: estado (zustand), servicios/adaptadores, configuración, catálogos
├── backend/            # Backend opcional FastAPI (limpieza de ruido FFmpeg, transcodificación y transcripción Whisper)
│   └── modelos/        # Modelos Whisper descargables (fuera del repo; ver README)
├── docs/
│   ├── arquitectura/   # Fases 1–5: plan, modelo de datos, renderizado, inserción extensible
│   ├── api/            # Contratos HTTP y del AudioProcessor
│   ├── decisions/      # ADR-001…ADR-015
│   └── pending/        # Lo no implementado (persistencia OPFS, picos en Worker), con contrato y plan
└── scripts/            # preparar-ffmpeg.mjs
```

## Solución de problemas

| Síntoma | Causa probable y solución |
| --- | --- |
| «Backend local inactivo» | Arranca uvicorn (sección anterior) y pulsa «Comprobar». La URL base por defecto es la ruta `/backend` (redirigida por Next a `127.0.0.1:8000`); se configura en `packages/app/src/config/config.default.json` (`backend.url`). |
| El nodo de limpieza falla con `BACKEND_NO_DISPONIBLE` | Igual que arriba; el mensaje del error incluye el comando exacto. |
| `MODELO_RNNOISE_AUSENTE` | Estás usando el filtro `arnndn` sin modelo: cambia a `afftdn` en el inspector o coloca el modelo en `backend/modelos/std.rnnn`. |
| `MODELO_NO_DESCARGADO` en el nodo de transcripción | El modelo elegido (p. ej. `small`) no está en `backend/modelos/whisper-<modelo>/`: descárgalo (sección «Transcripción») o cambia el parámetro Modelo a uno disponible; `/api/v1/salud` los lista. |
| Botón MP3 → `FFMPEG_NO_PREPARADO` | Ejecuta `npm run preparar:ffmpeg` una sola vez y reintenta. |
| «Ese archivo no se pudo decodificar» (AUDIO_NO_DECODIFICABLE) | El códec no es soportado por el navegador y la transcodificación automática falló. Si el backend local está activo se usa él primero; si no, ffmpeg.wasm (`npm run preparar:ffmpeg`, una vez). La carga de ffmpeg.wasm tiene límite de tiempo (`ffmpegMp3.timeoutCargaMs`), así que una descarga atascada ya no deja la subida colgada: verás el error con la causa exacta. Si el mensaje dice que «ni FFmpeg pudo leerlo», el archivo está corrupto o no es audio. |
| La página se queda en «Cargando Telar Audio…» accediendo por IP | En desarrollo, Next 16 solo admite por defecto `localhost`: usa `http://localhost:3000` o añade tu host a `allowedDevOrigins` en `packages/app/next.config.ts`. |
| Un nodo queda «Bloqueado» | Su entrada viene de un nodo desactivado o con error: el inspector muestra el motivo exacto. Reactiva o corrige el nodo aguas arriba. |
| La caché muestra resultados antiguos tras cambiar algo externo | Usa «⟳ Invalidar caché» en el inspector del nodo (invalida la rama). Las revisiones de datos (excluir muletilla, corregir curva, apagar colocación) ya invalidan solas a los consumidores. |

## Notas de privacidad

El audio subido se procesa y queda en la memoria de la pestaña. El backend opcional corre en `127.0.0.1` y tampoco envía nada a internet. No hay telemetría, cuentas ni anuncios.
