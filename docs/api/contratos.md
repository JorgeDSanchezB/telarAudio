# Fase 3 — Contratos

Tres contratos conviven: (1) el `AudioProcessor` entre nodos y motor, (2) el HTTP del backend opcional, (3) el protocolo de trabajos que el cliente implementa sobre ese HTTP. Todo lo no especificado aquí no forma parte del contrato.

---

## 1. Contrato `AudioProcessor` (motor ↔ nodos)

```ts
interface AudioProcessor {
  ejecutar(entrada: EntradaEjecucion, contexto: ContextoProcesador): Promise<SalidaEjecucion>;
}

interface EntradaEjecucion {
  nodo: InstanciaNodo;                       // id, tipo, posición, desactivado
  parametros: Record<string, number|boolean|string>;  // YA validados contra el contrato
  entradas: Record<string, ValorPuerto[]>;   // por puerto de entrada, ordenado si el puerto es "ordenado"
}

type ValorPuerto =
  | { tipo: 'audio'; idActivo: string }      // activo de la biblioteca (id = sha256 del contenido)
  | { tipo: 'dato'; idDato: string; tipoDato: string };  // reservado para nodos de análisis (pending)

interface ContextoProcesador {
  servicios: ServiciosMotor;   // activos, audio (decodificar), render (mezclar), backend?, hash, registro
  senal: AbortSignal;          // cancelación; los procesadores deben abortar en sus esperas largas
  reportarProgreso(fraccion: 0..1, mensaje?: string): void;
  registrar(mensaje: string): void;          // log de auditoría del nodo
}

interface SalidaEjecucion {
  salidas: Record<string, ValorPuerto>;      // un valor por puerto de salida DECLARADO
}
```

**Obligaciones del procesador** (el motor las da por hechas):

- **Determinismo**: mismas entradas+parámetros ⇒ misma salida (la caché del motor depende de ello).
- Clasificar sus fallos con `ErrorValidacion | ErrorConfiguracion | ErrorTemporal | ErrorAutorizacion | ErrorCritico` con `mensajeUsuario` accionable.
- No capturar en silencio errores propios ni de sus dependencias.
- Declarar los fallos previsibles en `DefinicionNodo.modosDeFallo` (se muestran en el inspector).

**Garantías del motor** (probadas en `Motor.test.ts`):

- Ejecuta solo los nodos del cierre podado del objetivo; desactivar un nodo evita su cómputo y el de sus proveedores exclusivos.
- Valida parámetros y entradas requeridas ANTES de ejecutar (errores tipados, nunca ejecución con datos inválidos).
- Clave de caché = hash(tipo, versión del contrato, parámetros validados, claves de entradas) ⇒ cambiar un parámetro re-ejecuta solo esa rama.
- Un fallo no tumba el grafo: el nodo queda `error` y sus dependientes `bloqueado (entrada-error)`; `reintentarNodo` re-ejecuta la rama aprovechando la caché del resto.
- Timeout por nodo y cancelación global vía `AbortSignal`.

---

## 2. API HTTP del backend opcional

Base: por defecto la app llama a la ruta `/backend` de su propio origen, que Next redirige a `http://127.0.0.1:8000` (`backend.url` en `packages/app/src/config/config.default.json`; acepta una URL absoluta `http/https` o una ruta raíz `/…`). Sin autenticación (servicio local ligado a 127.0.0.1; si algún día se expone, añadir auth antes que nada — documentado en ADR-004). Errores SIEMPRE en RFC 7807 (`application/problem+json`) con campos extra `codigo`, `categoria` (`validacion|configuracion|temporal|autorizacion|critico`) y `reintentable`.

### GET /api/v1/salud

```json
{ "estado": "ok", "version": "0.1.0", "capacidades": ["limpieza-ruido", "transcodificar", "transcripcion"],
  "ffmpeg_disponible": true, "modelo_arnndn_disponible": false,
  "modelos_whisper": ["tiny", "small"] }
```

`modelos_whisper` lista los tamaños con `model.bin` presente en `TELAR_DIR_MODELOS_WHISPER` (`backend/modelos/` por defecto).

### POST /api/v1/limpieza-ruido/trabajos

`multipart/form-data`: `archivo` (binario de audio) + `parametros` (JSON: `{"intensidad": "ligera|media|fuerte", "filtro": "afftdn|arnndn"}`).

- **202** `{"id": "…", "estado": "pendiente", "enlaces": {"self": "…", "resultado": "…"}}` + cabecera `Location`.
- **413** `ARCHIVO_GRANDE` (supera `TELAR_MAX_BYTES_SUBIDA`, 200 MB por defecto; se mide en streaming).
- **422** `PARAMETROS_INVALIDOS` / `INTENSIDAD_INVALIDA` / `FILTRO_INVALIDO` / `ARCHIVO_VACIO` / `CURSOR_INVALIDO`.
- **429** `LIMITE_TASA` + `Retry-After` (cubo de fichas por IP: 20 ráfaga / 30 por minuto por defecto).
- **500** `FFMPEG_FALLO` (temporal, reintentable, incluye cola del stderr) / `FFMPEG_AUSENTE` (configuración).

### GET /api/v1/limpieza-ruido/trabajos?limit=&cursor=

Paginación **keyset** por `(creado_en, id)` descendente, cursor opaco base64. `limit` se acota a `max_limite_pagina` (100). Respuesta: `{"items": [estado…], "siguiente_cursor": "…"}` (sin cursor si se llegó al final). Cursor inválido ⇒ 422 `CURSOR_INVALIDO`. Sin `SELECT *` ni ordenaciones frágiles: no hay base de datos y el orden es total por construcción.

### GET /api/v1/limpieza-ruido/trabajos/{id}

```json
{ "id": "…", "estado": "en_progreso", "progreso": 42, "mensaje": "Reduciendo ruido con FFmpeg…",
  "creado_en": "…", "actualizado_en": "…" }
```

Estados: `pendiente | en_progreso | completado | error | cancelado`. En `error` añade `error: {title, detail, codigo, categoria, reintentable}`. **404** `TRABAJO_NO_ENCONTRADO`.

### GET /api/v1/limpieza-ruido/trabajos/{id}/resultado

- **200** `audio/wav` (PCM 16 bits, 48 kHz, mono).
- **409** `RESULTADO_NO_LISTO` si no está completado (temporal, reintentable).

### DELETE /api/v1/limpieza-ruido/trabajos/{id}

- **204** siempre que el trabajo exista (cancela si vive; idempotente sobre terminales). **404** si nunca existió.

### Capacidad `transcodificar` (rescate de códecs no soportados)

Mismo protocolo exacto bajo `/api/v1/transcodificar/trabajos`, con dos diferencias:

- `parametros` debe ser `{}` (sin opciones): **422** `PARAMETROS_INVALIDOS` si llega cualquier clave.
- El resultado es `audio/wav` PCM 16 bits a `TELAR_TASA_SALIDA_HZ` (48 kHz) **conservando los canales originales** (la limpieza fuerza mono; el rescate no topa nada). Con entrada de vídeo (p. ej. 3gp de mensajeros) descarta la pista de vídeo (`-vn`).

Cada capacidad tiene su propio gestor de trabajos (colas, TTL y listados aislados), y comparten limitador de tasa. La ruta la usa el cliente automáticamente cuando `decodeAudioData` falla y ffmpeg.wasm no está disponible (ver `packages/app/src/estado/almacen.ts`, `rescatarAWav`).

### Capacidad `transcripcion` (Whisper, resultado JSON)

Mismo protocolo bajo `/api/v1/transcripcion/trabajos`, con diferencias:

- `parametros`: `{"modelo": "tiny|base|small", "idioma": "es"}` (idioma: código de 2–5 letras; defecto `small`/`es`).
- El resultado es `application/json` (`transcripcion.json`), no WAV: el cliente lo registra en el almacén de datos de la sesión (`ServicioRegistroDatos`) y viaja por las aristas como `{tipo:'dato', idDato, tipoDato:'transcripcion/v1'}`.
- Cuerpo del resultado: `{tipoDato, idioma, modelo, duracionMs, segmentos: [{inicioMs, finMs, texto, palabras: [{palabra, inicioMs, finMs}]}], estadisticas}`.
- Fallos propios: **503** `MODELO_NO_DESCARGADO` (configuración), **422** `AUDIO_SIN_VOZ` / `AUDIO_ILEGIBLE` (validación), **500** `MODELO_CORRUPTO` / `WHISPER_NO_INSTALADO` (configuración).
- El modelo se carga bajo demanda con caché LRU de 1 modelo; la transcripción va por bloques reanudables (`TELAR_TRANSCRIPCION_BLOQUE_S`, 300 s por defecto) con progreso por bloque.

### CORS

`TELAR_ORIGENES_CORS` (por defecto `http://localhost:3000` y `http://127.0.0.1:3000`). Si sirves la app en otro origen, ajústalo.

---

## 3. Protocolo cliente ↔ backend (`ClienteBackendLocal`)

```
verificar() ── GET /salud (caché 10 s) ──▶ disponible? capacidades?
ejecutarNodo():
  1. POST /trabajos (multipart)            [reintentos con backoff ante 502/503/504/red]
  2. sondear GET /trabajos/{id} cada intervaloSondeoMs (700 ms por defecto)
       progreso 0..100 → onProgreso(0.08..0.93, mensaje)
       completado → continuar · error → traducir problema · cancelado → cancelación
  3. GET /trabajos/{id}/resultado → bytes WAV
  4. decodificar → registrar activo en la biblioteca (id por contenido)
Cancelación del nodo (AbortSignal) → DELETE /trabajos/{id} (mejor esfuerzo) → nodo «cancelado»
```

**Tabla de mapeo HTTP → error tipado del cliente:**

| Respuesta / fallo | Error del cliente | Código | Reintentable |
| --- | --- | --- | --- |
| red caída (subida), 502/503/504 agotados | `ErrorTemporal` | `SUBIDA_FALLIDA` | sí |
| 401 / 403 | `ErrorAutorizacion` | `BACKEND_AUTORIZACION` | no |
| 413 | `ErrorValidacion` | `BACKEND_ARCHIVO_GRANDE` | no |
| 422 / 409 | el del problema (`categoria` del backend) | p. ej. `MODELO_RNNOISE_AUSENTE` | según categoría |
| 429 | `ErrorTemporal` | `BACKEND_SATURADO` | sí |
| 404 del trabajo durante sondeo | `ErrorConfiguracion` | `TRABAJO_DESAPARECIDO` | no |
| 409 al descargar | `ErrorTemporal` | `RESULTADO_NO_LISTO` | sí |
| 5xx restantes | `ErrorTemporal` | `BACKEND_ERROR_INESPERADO` | sí |
| backend sin arrancar | `ErrorConfiguracion` | `BACKEND_NO_DISPONIBLE` (mensaje con comando exacto) | no |
