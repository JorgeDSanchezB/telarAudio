# Fase 5 — Estrategia de renderizado y listas

## Renderizado dinámico desde datos (nunca enumeraciones a mano)

- **Paleta de nodos:** `PaletaNodos` agrupa `registro.listar()` por categoría. Añadir un nodo al catálogo lo hace aparecer sin tocar el componente.
- **Inspector:** el formulario se genera desde `EspecificacionParametro` (número con min/max/paso/unidad, booleano, opción, selector de activo). La validación en vivo usa la MISMA función que el motor (`validarValoresParametros`): lo que ves corregido en el formulario es exactamente lo que el motor aceptará.
- **Tarjetas de nodo:** puertos y resumen de parámetros derivan del contrato; los estados usan un vocabulario único (`inactivo, en-cola, ejecutando, listo, cacheado, error, bloqueado, desactivado, cancelado`) con insignia de color y motivo de bloqueo en el `title`.
- **Biblioteca:** filas generadas de `MetadatosActivo[]`.

## Identificadores estables como claves

- Filas de biblioteca: `rowKey={(i, datos) => datos.activos[i].id}` (id de contenido, nunca el índice).
- Pistas/clips de la línea de tiempo: ids UUID de `@waveform-playlist` (la librería los exige).
- Nodos/aristas de React Flow: ids de instancia del grafo.
- Listas de React usan `key={id}` en todos los mapas (avisos, conexiones del inspector).

## Virtualización

La biblioteca usa `react-window` v2 (`List` con `rowComponent`/`rowProps`/`rowKey`): con 10 o 10 000 activos, solo se montan las filas visibles. Umbral: siempre virtualizada (no merece ramificar). El resto de listas (paleta, conexiones del inspector, avisos) están acotadas por diseño (catálogo de nodos ≤ decenas; avisos con tope de 8 en pantalla).

## Campos ausentes, nulos o desconocidos

| Caso | Tratamiento |
| --- | --- |
| Parámetro ausente | El control muestra el defecto declarado; el motor aplica el defecto. |
| Parámetro `null` | Error `PARAM_NULO` visible en el formulario y al ejecutar. Nunca se convierte en defecto. |
| Parámetro inválido | Error en línea en el formulario (código + mensaje) y estado `error` del nodo si se ejecuta. |
| Metadato aún no analizado (`duracionMs: null`) | La fila muestra «analizando…»; la fusión lo reporta como `ACTIVO_SIN_DURACION` (reintentable). |
| Definición de nodo desconocida al cargar un documento | `GRAFO_TIPO_NO_REGISTRADO` con mensaje que sugiere la causa (proyecto de otra instalación). |
| Salida de nodo mal tipada | El motor valida el contrato de salida (`CONTRATO_SALIDA_INVALIDA`) y marca error del nodo sin tumbar el grafo. |

## Re-renders innecesarios

- El estado del motor vive fuera de React; zustand proyecta **solo el último detalle por nodo** (`estadosNodos[id]`), de modo que el progreso de un nodo no re-renderiza el lienzo entero: React Flow re-renderiza la tarjeta afectada (su `data` cambia) y las tarjetas son componentes memoizados por React Flow.
- La derivación de nodos/aristas del lienzo se hace con `useMemo` a partir de (`instancias`, `aristas`, `estados`, `idSeleccionado`).
- En la línea de tiempo, `@waveform-playlist` divide su contexto en cuatro hooks para aislar la animación a 60 fps del estado de baja frecuencia (decisión de la propia librería, razón adicional de ADR-003).

## Estados de carga, vacío, error y reintento

- **Carga:** la página es un cliente dinámico con indicador «Cargando Telar Audio…»; el botón Ejecutar pasa a «Ejecutando…» y se deshabilita; los nodos muestran barra de progreso y mensaje de fase («Decodificando…», «Mezclando audio (render offline)…», «Procesando en el backend local (FFmpeg)…»).
- **Vacío:** paleta vacía no existe (siempre hay catálogo); biblioteca vacía con texto guía; línea de tiempo vacía con instrucciones de uso.
- **Error:** cada nodo con fallo muestra `mensajeUsuario` accionable + botón «Reintentar» (re-ejecuta solo la rama); los avisos (toasts) clasifican por categoría con color y cierre manual; `FronteraError` contiene fallos críticos de una zona sin tumbar la página; la barra de estado resume la última ejecución.
- **Reintento:** explícito por nodo (tarjeta e inspector) y automático ante errores temporales del backend (429/5xx con backoff configurable).

## Lienzo de nodos grande

React Flow renderiza solo los nodos en el viewport (virtualización propia) y usa transformaciones CSS para pan/zoom. Con grafos de cientos de nodos el coste dominante pasa a ser la derivación `useMemo`, que es lineal y memoizada. No se proyectan grafos de miles de nodos para narración; si llegara el caso, la paleta y el minimapa ya escalan y la derivación es el único punto a optimizar (documentado, sin over-engineering preventivo).

## Línea de tiempo: rendimiento y límites honestos

- **Renderizado:** waveform por pista en `<canvas>`; el coste de dibujo es proporcional a los píxeles, no a las muestras. Verificado: 2,0 s de audio a 1024 muestras/píxel y 48 kHz ocupan 93,75 px (`48000·2/1024` ≈ 94, verificado).
- **Edición:** arrastre de clips y recorte de bordes con detección de colisiones (`ClipCollisionModifier`), división en el cursor (`useClipSplitting`), todo dentro de la librería; nuestro documento solo sincroniza estructura.
- **Zoom/playhead/selección:** gestión de la librería (zoom por niveles configurados; la selección llega en **segundos**, convertido a muestras con la tasa real del motor — unidades verificadas en el código fuente de la librería).
- **Límite práctico real:** `decodeAudioData` mantiene el audio completo en memoria. Regla práctica en Chrome de escritorio: ~10 min estéreo 48 kHz ≈ 115 MB; ~1 h ≈ 700 MB; horas ⇒ riesgo de agotar la RAM. Estrategia de escalado a varias horas (picos precalculados en Worker + `waveformData` de la librería + activos en OPFS con lectura parcial): contrato y plan en `docs/pending/picos-worker.md` y `docs/pending/persistencia-opfs.md`. No se promete lo que no está implementado.
- **Bounce/export:** `OfflineAudioContext` renderiza fuera del hilo de audio del navegador; para audios muy largos el coste es CPU+memoria del buffer de salida (mismo límite práctico anterior).
