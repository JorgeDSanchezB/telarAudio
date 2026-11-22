# ADR-016 — Proyectos de sesión `.telar.json`: guardar y cargar línea de tiempo y transcripciones

- **Estado:** aceptada (implementada y verificada: 104 pruebas TS + E2E en navegador con ida y vuelta completa guardar → recargar → cargar, revisiones incluidas).
- **Fecha:** 2026-11-22.

## Contexto

Todo el trabajo de una sesión (pistas editadas en la línea de tiempo, transcripciones revisadas, curvas corregidas) vivía solo en memoria: al cerrar la pestaña se perdía. La persistencia automática (OPFS/IndexedDB) sigue planificada en `docs/pending/persistencia-opfs.md`; lo que faltaba era poder **llevarse la sesión a un archivo y traerla de vuelta**, también entre máquinas.

## Decisiones

1. **Un único archivo JSON autocontenido** (`.telar.json`, versión 1 validada con zod `strictObject`). Contiene: `pistas` (documentos de clips con todos los escalares: posiciones en muestras, recortes, fundidos, ganancias, `startTick` si existe), `audios` (los buffers embebidos) y `datos` (los `DatoRegistrado` de la sesión). **El grafo de nodos NO forma parte del proyecto**: se guarda el trabajo de edición, no la configuración de la herramienta (decisión de alcance, no técnica).
2. **Audio embebido sin pérdida como base64 de float32 little-endian**, un canal por entrada. Sin códec y sin dependencias nuevas: la restauración construye el `AudioBuffer` directamente (`DecodificadorAudio.crearBuffer`), sin pasar por `decodeAudioData` (que remuestrearía a la tasa de sesión). Coste asumido: ~5,3 bytes/muestra × 1,33 de base64; el techo configurable `proyectos.tamanoMaximoMb` (512 MB por defecto) protege al navegador de documentos gigantes. Un formato binario (zip con WAV sueltos) queda como mejora pendiente.
3. **Deduplicación por identidad de buffer**: todos los clips que comparten un mismo `AudioBuffer` (el caso normal: recortes de la misma pista) embeben el audio una sola vez, referenciado por `audioClave`. La deduplicación por contenido ya la hace el registro de activos al cargar (direccionado por sha256).
4. **Los datos conservan `idDato`, `tipoDato`, `revision` y `creadoEn`** al guardar, y `RegistroDatosMemoria.importar` los restaura en su ranura exacta: las referencias entre datos (p. ej. colocaciones → transcripción) siguen resolviendo, y las revisiones del usuario (muletillas excluidas, curva corregida) sobreviven. Si el id ya existe en la sesión, el importado lo sustituye: cargar un proyecto es la palabra final sobre ese dato.
5. **Cargar reemplaza la línea de tiempo** (no la fusiona): el estado previo queda en el historial y «Deshacer» lo recupera. Los audios embebidos se registran además en la biblioteca (con `origen: 'linea-tiempo'`), reutilizables como cualquier activo.
6. **Panel «Datos» (tercera pestaña izquierda)**: los datos de la sesión listados al margen del grafo, con los mismos visores/revisores del inspector (salida sintética con forma de `ResultadoNodo`). Así una transcripción cargada desde un proyecto sigue siendo visible y editable aunque el grafo esté vacío.
7. **Errores tipados en cada fallo** (ADR-014): `PROYECTO_INVALIDO` (estructura, JSON roto, canal con longitud que no encaja, clip huérfano), `PROYECTO_VERSION_NO_SOPORTADA`, `PROYECTO_DEMASIADO_GRANDE`, `PROYECTO_CLIP_SIN_AUDIO` (guardar con un clip aún sin audio). La validación es `strictObject`: claves desconocidas se rechazan, igual que la config.
8. **Configuración nueva en `proyectos`** (`versionFormato`, `tamanoMaximoMb`, `prefijoNombre`), sincronizada en `esquema.ts` + `config.default.json` + `cargarConfig` (la lista explícita de secciones de `cargarConfig` también se extendió: sin ella la sección se caía antes de validar).

## Consecuencias

- La sesión es portable: guardar en una máquina, cargar en otra; el archivo es legible y diferenciable (JSON).
- Un proyecto con una hora de narración mono a 48 kHz ronda los 760 MB sin comprimir: por encima del techo por defecto. Para sesiones largas habrá que subir el límite o esperar el formato binario pendiente.
- El flujo de trabajo gana un estado honesto: «Guardar» deshabilitado con la razón cuando no hay nada que guardar; los avisos informan en cada etapa (pistas/audios/datos/transcripciones y MB al guardar; restauraciones al cargar).
- La persistencia automática (OPFS) sigue pendiente y sin cambios: este ADR la complementa, no la sustituye.
