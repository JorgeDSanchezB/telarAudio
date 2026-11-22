# Fase 2 — Modelado de datos

## Convención de entidades

Toda entidad identificable tiene `id` (UUID v4 o hash de contenido) y marca temporal de creación (`creadoEn` / `creado_en`). No hay base de datos en esta pasada: el estado vive en memoria de sesión (ver `docs/pending/persistencia-opfs.md`), y el único almacén con cierta duración es el de trabajos del backend (TTL configurable).

## Entidades principales

### Del grafo (`@telar/motor`)

```ts
InstanciaNodo {
  id: UUID              // crypto.randomUUID()
  tipo: string          // referencia a DefinicionNodo.tipo del registro
  parametros: Record<string, unknown>   // crudos; se validan al editar (UI) y al ejecutar (motor)
  posicion: { x, y }    // solo UI
  desactivado: boolean
  creadoEn: number      // epoch ms
}

Arista {
  id: UUID
  origen:  { nodo: UUID, puerto: string }   // puerto de SALIDA
  destino: { nodo: UUID, puerto: string }   // puerto de ENTRADA
  orden?: number         // orden dentro de un puerto de entrada "ordenado" (fusión)
  creadoEn: number
}

DocumentoGrafo { version: 1, nodos: InstanciaNodo[], aristas: Arista[] }
```

### De la biblioteca (`MetadatosActivo`)

```ts
MetadatosActivo {
  id: string            // "sha256-…" → DIRECCIONADO POR CONTENIDO
  nombre, mime, bytes, duracionMs | null, tasaMuestreo | null, canales | null
  creadoEn: number
  origen: 'subida' | 'nodo' | 'linea-tiempo'
}
```

El id por contenido tiene dos consecuencias deliberadas: (1) subir el mismo archivo dos veces no duplica el activo; (2) las claves de caché del motor quedan ligadas al contenido sin re-hashear audio.

### De la línea de tiempo (`@telar/linea-tiempo`, tipos de `@waveform-playlist`)

```ts
PistaTelar extends ClipTrack {
  id: UUID; name; tipoPista: 'voz'|'musica'|'efectos'|'salida'
  clips: AudioClip[]; muted; soloed; volume; pan
}
AudioClip {
  id: UUID
  audioBuffer?: AudioBuffer      // presente cuando el audio está cargado
  startSample, durationSamples   // muestras a la tasa de la línea (48 kHz)
  offsetSamples                  // punto de entrada dentro del buffer (recorte)
  sampleRate, sourceDurationSamples
  gain: number                   // lineal
  fadeIn?, fadeOut?: { duration: segundos, type }
}
```

Unidades: **muestras a 48 kHz** en la línea de tiempo (la sesión entera decodifica y renderiza a una sola tasa; ver ADR-004), **ms** en los planes de mezcla del motor, **segundos** en la API de `@waveform-playlist` (verificado en su código fuente: `moveTime = x * samplesPerPixel / sampleRate`).

### Del backend (`Trabajo`)

```python
Trabajo { id, estado: pendiente|en_progreso|completado|error|cancelado,
          progreso: 0..1 | None, mensaje, creado_en, actualizado_en,
          error: problema RFC 7807 | None, entrada: Path, salida: Path }
```

## Relaciones

- `Arista.origen.nodo → InstanciaNodo.id` y `Arista.destino.nodo → InstanciaNodo.id`; los puertos referenciados deben existir en el contrato del tipo (el `GrafoDag` lo valida en cada conexión).
- `InstanciaNodo.tipo → DefinicionNodo.tipo` (registro); un tipo no registrado no puede entrar al grafo.
- `fuente-audio.parametros.archivo → MetadatosActivo.id`; `AudioClip.audioBuffer` corresponde al activo que generó la pista.
- `Trabajo.entrada/salida` son archivos bajo `dir_datos/trabajos/<id>/`.

## Invariantes y validaciones (quién las garantiza)

| Invariante | Garantía | Dónde se prueba |
| --- | --- | --- |
| El grafo es acíclico | `GrafoDag.conectar` rechaza aristas que cierren ciclos (`GRAFO_CICLO`), incluidos auto-bucles | `GrafoDag.test.ts` |
| Un puerto de entrada no múltiple admite una sola arista | `GRAFO_PUERTO_OCUPADO` | `GrafoDag.test.ts` |
| Sin aristas duplicadas; tipos de puerto compatibles (audio→audio) | `GRAFO_ARISTA_DUPLICADA` / `GRAFO_TIPO_PUERTO_INCOMPATIBLE` | `GrafoDag.test.ts` |
| Un nodo no se ejecuta sin sus entradas requeridas | Motor: estado `error` con `NODO_SIN_ENTRADA` antes de ejecutar | `Motor.test.ts` |
| Un nodo no se ejecuta con parámetros fuera de contrato | Motor: `PARAM_INVALIDOS` antes de ejecutar | `Motor.test.ts` |
| Los clips no se solapan en una pista | Modificador de colisión de la librería durante el arrastre + `validarDocumento` (defensa) | `operaciones.test.ts` |
| Un clip respeta los límites de su audio fuente | `validarDocumento` → `CLIP_FUERA_DE_FUENTE` | `operaciones.test.ts` |
| Ids únicos de pistas y clips en el documento | `validarDocumento` | `operaciones.test.ts` |
| El corte de rango produce un documento válido (sin huecos ni solapes) | `eliminarRangoDePista` + `validarDocumento` tras cada caso | `operaciones.test.ts` |

## Atributos dinámicos (parámetros de nodo)

Los parámetros de un nodo son **datos**: una especificación POD (`EspecificacionParametro`: `numero | booleano | opcion | activo`) con límites (min/max/paso, opciones cerradas) y defectos. La validación (`validarValoresParametros`) distingue ausente (aplica defecto), `null` (error `PARAM_NULO`), inválido (error con código) y clave desconocida (error, nunca se descarta en silencio). El versionado del contrato vive en `DefinicionNodo.version` (semver) y entra en la clave de caché. El control de límites globales (tamaño, claves, número de parámetros) está en `LIMITES_DEFECTO_PARAMETROS`. Detalle y ejemplo de extensión: `docs/arquitectura/04-insercion-extensible.md`.

## Fábricas

`crearProcesador()` en cada `DefinicionNodo` es la única fábrica del sistema: el registro la valida como función y el motor la invoca una vez por ejecución de nodo. No hay más fábricas/ builders: un nodo nuevo es un objeto literal + registro (coste: ninguna indirección; alternativa descartada: registro por claves de configuración pura, que obligaría a cargar código por reflection).

## Persistencia y «migraciones»

- Cliente: `DocumentoGrafo` y `DocumentoLineaTiempo` son serializables por diseño (`version: 1`); `GrafoDag.desdeDocumento` valida versiones y rechaza documentos incompatibles con error explícito. La persistencia física está en `docs/pending/persistencia-opfs.md`.
- Backend: sin base de datos (ADR-004); los trabajos son efímeros con TTL y limpieza periódica. Si algún día se persiste, el diseño keyset de la paginación ya evita ordenaciones frágiles.
