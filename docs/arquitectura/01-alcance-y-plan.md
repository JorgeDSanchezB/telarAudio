# Fase 1 — Plan estratégico

## Objetivo

Unificar en un único producto web la postproducción de narración en español: limpiar, editar, enriquecer, fusionar y exportar audios sin el cañón secuencial de `bardoStudio`, con un motor **DAG no lineal** que solo computa lo que el resultado necesita, cachea lo intermedio y paraleliza lo independiente.

## Alcance de esta pasada

**Implementado (verificado):**

- Núcleo del motor DAG con todas sus garantías (solo-necesarios, desactivación con poda, caché selectiva encadenada por contenido, paralelismo con límite, errores tipados sin tumbar el grafo, reintento de rama, cancelación y timeout por nodo).
- Interfaz `AudioProcessor` + registro validado; añadir nodos no toca el núcleo (demostrado con un test que registra un nodo nuevo en caliente).
- Nodos: `fuente-audio`, `fusion-audios` (end-to-end en navegador), `ganancia` (lógica pura probada), `limpieza-ruido` (delegación a backend, verificada con backend real).
- UI de nodos con React Flow (paleta dinámica, inspector dinámico, estados, progreso, acciones).
- Editor de línea de tiempo sobre `@waveform-playlist/browser` con edición no destructiva (mover/recortar/dividir con colisión), undo/redo propio, **corte destructivo persistente** y mezcla/exportación.
- Backend opcional FastAPI con protocolo de trabajos (202 + sondeo + cancelación), paginación por cursor, rate limit y RFC 7807.

**Pendiente (contrato y plan en `docs/pending/`):** transcripción Whisper, eliminación de muletillas, análisis de tensión, asignación de música, colocación de SFX, persistencia OPFS, picos precalculados en Worker.

## Actores y casos de uso

**Narrador/a (actor principal).** Produce audiolibros y cuentos en su propio equipo.

| Caso de uso | Flujo |
| --- | --- |
| Limpiar una narración | Subir audio → Fuente → Limpieza de ruido (backend) → [Ganancia/normalizar] → Descargar. |
| Fusionar capítulos | Subir N archivos → N fuentes → Fusión (orden con ↑↓, separación y fundidos) → Descargar WAV. |
| Editar con precisión | Enviar la salida de un nodo a la línea de tiempo → recortar bordes, dividir, deshacer → «Eliminar región (persistente)» → «Mezclar y exportar». |
| Probar variantes sin recomputar todo | Duplicar una rama con otros parámetros: solo esa rama se ejecuta; el resto sale de caché. |
| Desactivar una mejora | Desactivar el nodo: ni él ni lo que solo lo alimentaba se computan; los dependientes quedan bloqueados con motivo explícito. |

**Oyente final:** consume el WAV/MP3 exportado; no interactúa con la herramienta.
**Desarrollador/a de nodos:** añade `DefinicionNodo` + procesador y lo registra (ver `docs/arquitectura/04-insercion-extensible.md`).

## Supuestos (decisiones ante ambigüedad, ver ADR)

1. Chrome de escritorio como objetivo: se asumen Web Audio API, WebAssembly y Canvas modernos. No se invierte en compatibilidad con Safari/Firefox en esta pasada.
2. Arquitectura híbrida: nodos ligeros en el cliente; nodos pesados en el backend local. Sin backend, la app es plenamente funcional para fusionar/editar/exportar.
3. La edición destructiva se interpreta como *persistencia real del audio recortado* (render a nuevo archivo), no como borrado del original de disco: el archivo subido nunca se toca.
4. Toda la sesión vive en memoria (activos direccionados por contenido); la persistencia entre sesiones queda en `docs/pending/persistencia-opfs.md`.
5. Idioma: interfaz, documentación e identificadores en castellano (sin tildes en identificadores); los nombres impuestos por el ecosistema (`AudioProcessor`, paquetes npm) se mantienen en inglés.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
| --- | --- |
| Whisper/RNNoise en WASM en cliente: peso y memoria | Se delegan al backend; el cliente nunca los intenta (error de configuración con instrucciones). |
| Audios de varias horas: los `AudioBuffer` decodificados viven en memoria | Límite práctico documentado (~1 h estéreo ≈ 700 MB; ver `05-renderizado.md`); picos en Worker y OPFS planificados. |
| Complejidad de la UI de nodos | Paleta generada del registro, inspector generado de la especificación de parámetros, estados visuales con un vocabulario único. |
| Deuda técnica de los repos originales | Migración por nodo con contrato previo (ADR-005 y `docs/pending/`); nada se arrastra sin rediseño. |

## Arquitectura

```
┌─────────────────────────────────── navegador ───────────────────────────────────┐
│  @telar/app (Next.js 16)                                                         │
│  ┌────────────┐   ┌──────────────────────┐   ┌─────────────────────────────────┐ │
│  │  UI nodos  │   │ Editor línea tiempo  │   │ servicios/adaptadores           │ │
│  │ (@telar/ui)│   │ (@telar/ui +         │   │ activos · audio · render ·      │ │
│  │ React Flow │   │  @waveform-playlist) │   │ backend · ffmpeg.wasm · hash    │ │
│  └─────┬──────┘   └──────────┬───────────┘   └───────────────┬─────────────────┘ │
│        │ estado (zustand)    │ documento (pistas)            │ inyección         │
│  ┌─────▼─────────────────────▼───────────────────────────────▼─────────────────┐ │
│  │ @telar/motor (DAG: grafo, registro, planificador, caché, errores)           │ │
│  │      ▲ contratos: AudioProcessor · puertos · parámetros                      │ │
│  │  @telar/nodos (fuente · fusión · ganancia · limpieza-ruido)                  │ │
│  │  @telar/linea-tiempo (operaciones puras + historial)                         │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ HTTP (solo nodos pesados)
                            ┌───────────▼────────────┐
                            │ backend FastAPI        │
                            │ trabajos + FFmpeg      │
                            │ (127.0.0.1, opcional)  │
                            └────────────────────────┘
```

## Capas

- **Dominio (núcleo puro):** `@telar/motor` (grafo, contratos, planificación, caché) y `@telar/linea-tiempo` (operaciones del documento). Sin dependencias; probados en Node.
- **Nodos (comportamiento):** `@telar/nodos`. Cada nodo es autocontenido: contrato declarativo + procesador.
- **Aplicación:** `@telar/app` — estado global (zustand), servicios (implementan los puertos del motor), configuración validada.
- **Presentación:** `@telar/ui` — componentes puros que reciben datos y emiten callbacks.
- **Adaptadores (dentro de app/ui):** Web Audio API, OfflineAudioContext, `@waveform-playlist/browser`, `@xyflow/react`, ffmpeg.wasm, `fetch` al backend.

## Componentes (átomos → moléculas → organismos → página)

- **Átomos:** `Insignia` (estado del nodo), botones y campos del inspector, `FronteraError`.
- **Moléculas:** campo de parámetro (etiqueta + control + error), fila de biblioteca virtualizada, ítem de paleta, par de puertos con sus `Handle`.
- **Organismos:** `PaletaNodos`, `LienzoNodos` (con `TarjetaNodo`), `Inspector`, `BibliotecaActivos`, `EditorLineaTiempo` (barra de transporte + waveform), `Avisos`, barra superior y barra de estado.
- **Página:** `Estudio` — única página; compone los organismos y cablea el almacén.

## Gestión de estado (ADR-007)

| Estado | Dónde vive | Por qué |
| --- | --- | --- |
| Grafo (instancias, aristas) | Un `GrafoDag` vivo mutado con validación + proyección plana en zustand | El motor referencia la misma instancia: editar el grafo no invalida la caché (claves por contenido). |
| Estados del DAG | Fuera de React (en el motor); zustand solo proyecta el último evento por nodo | Evita re-renderizar a frecuencia de progreso. |
| Playback de la línea de tiempo | Dentro de `@waveform-playlist` | Es su dominio; nuestro documento solo sincroniza estructura. |
| Documento de la línea de tiempo | zustand + `Historial` de instantáneas por referencia | Undo/redo O(1) gracias a la inmutabilidad de las operaciones. |
| Selección | zustand (nodo seleccionado, pestañas) | Estado de UI puro. |
| Caché de resultados | Dentro del motor (LRU por clave de contenido) | Independiente de la vida de los componentes. |

## Decisiones técnicas (resumen; detalle en ADR)

| Tema | Decisión | Alternativa descartada |
| --- | --- | --- |
| Orquestación | DAG propio con poda y caché por contenido (ADR-001) | Pipeline secuencial con puertas (bardoStudio); motores de workflow pesados |
| Lienzo de nodos | `@xyflow/react` 13 (ADR-002) | rete.js, drawflow, lienzo propio |
| Línea de tiempo | `@waveform-playlist/browser` 16 (ADR-003) | Editor propio desde cero |
| Motor de audio | Web Audio API + OfflineAudioContext (ADR-004) | Tone.js directo (la librería de línea de tiempo ya lo usa internamente) |
| Grafo | Implementación propia (~200 líneas, 0 dependencias) (ADR-006) | graphology |
| Estado | zustand (ADR-007) | Redux, Context |
| Parámetros de nodo | Especificación POD serializable (ADR-008) | Esquemas zod embebidos por nodo |
| Monorepo | npm workspaces, paquetes fuente sin build propio (ADR-009) | Turborepo/Nx, builds por paquete |
| Exportación | WAV nativo + ffmpeg.wasm UMD opcional para MP3 (ADR-010) | ffmpeg.wasm para todo |
| Undo | Instantáneas por referencia (ADR-011) | Patrón Comando |
| Estilos | CSS plano con prefijo (ADR-012) | Tailwind, CSS-in-JS |
| Errores | Taxonomía tipada + RFC 7807 en el borde HTTP (ADR-014) | Excepciones genéricas |
