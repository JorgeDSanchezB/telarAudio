/**
 * Esquema de configuración de la aplicación (zod, estricto).
 *
 * Regla de cero hardcoding: cada límite, URL y tamaño vive aquí o en
 * config.default.json, validado al arrancar. Las claves desconocidas se
 * rechazan (no se ignoran en silencio) para detectar configuración obsoleta.
 */

import { z } from 'zod';

const esquemaMotor = z.strictObject({
  maxConcurrencia: z.number().int().min(1).max(16).default(3),
  cacheResultados: z.boolean().default(true),
  maxResultadosCache: z.number().int().min(1).max(1024).default(64),
  timeoutNodoMs: z.number().int().min(1_000).max(3_600_000).default(600_000),
});

const esquemaBackend = z.strictObject({
  // Se admite una URL absoluta (http/https) o una ruta raíz relativa ("/…"),
  // útil cuando la app corre tras un proxy que solo expone un puerto y el
  // backend se redirige desde el propio Next (ver next.config.ts).
  url: z
    .string()
    .refine((valor) => /^https?:\/\/\S+$/.test(valor) || /^\/[^\s]*$/.test(valor), {
      message: 'Debe ser una URL absoluta (http/https) o una ruta raíz relativa (empieza por /)',
    })
    .default('http://127.0.0.1:8000'),
  intervaloSondeoMs: z.number().int().min(100).max(10_000).default(700),
  timeoutSaludMs: z.number().int().min(500).max(30_000).default(3_000),
  reintentosTemporales: z.number().int().min(0).max(10).default(2),
  ttlVerificacionMs: z.number().int().min(1_000).max(300_000).default(10_000),
  backoffBaseMs: z.number().int().min(50).max(10_000).default(400),
});

const esquemaAudio = z.strictObject({
  tasaMuestreo: z.union([z.literal(44_100), z.literal(48_000)]).default(48_000),
});

const esquemaLineaTiempo = z.strictObject({
  limiteHistorial: z.number().int().min(10).max(1_000).default(100),
  confirmacionHistorialMs: z.number().int().min(50).max(2_000).default(400),
});

const esquemaFfmpegMp3 = z.strictObject({
  habilitado: z.boolean().default(true),
  umdUrl: z.string().default('/ffmpeg/ffmpeg.js'),
  coreUrl: z.string().default('/ffmpeg/ffmpeg-core.js'),
  wasmUrl: z.string().default('/ffmpeg/ffmpeg-core.wasm'),
  tasaBits: z.number().int().min(64_000).max(320_000).default(192_000),
  /**
   * Tiempo máximo (ms) para cargar el núcleo de ffmpeg.wasm (worker + ~32 MB
   * de wasm). Si expira, la operación falla con FFMPEG_WASM_TIMEOUT y el
   * llamante puede degradar (p. ej. al backend local): sin este límite, un
   * cargador atascado (red lenta, proxy que corta la descarga) dejaría la
   * subida colgada sin error ni reintento, porque @ffmpeg/ffmpeg no tiene
   * timeout propio ni gestiona el fallo de creación del worker.
   */
  timeoutCargaMs: z.number().int().min(5_000).max(600_000).default(120_000),
});

const esquemaUi = z.strictObject({
  maximoSubidasSimultaneas: z.number().int().min(1).max(16).default(3),
});

const esquemaTranscripcion = z.strictObject({
  /** Modelo Whisper por defecto del nodo (tiny/base/small). */
  modeloDefecto: z.enum(['tiny', 'base', 'small']).default('small'),
});

const esquemaCatalogoSfx = z.strictObject({
  id: z.string().min(1),
  nombre: z.string().min(1),
  /** Ruta pública ("/sfx/x.wav") — el archivo vive en packages/app/public. */
  ruta: z.string().min(1).startsWith('/'),
  terminos: z.array(z.string().min(1)).min(1),
  gananciaDb: z.number().min(-40).max(6).optional(),
});

const esquemaCatalogoMusica = z.strictObject({
  id: z.string().min(1),
  nombre: z.string().min(1),
  /** Ruta pública del WAV (se importa a la biblioteca al primer uso). */
  ruta: z.string().min(1).startsWith('/'),
  /** Banda de tensión [min,max] a la que encaja (0–100). */
  bandaTension: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
});

const esquemaCatalogos = z.strictObject({
  /** Muletillas a eliminar (migración del formato filler_words.json). */
  muletillas: z.array(z.string().min(1)).min(1),
  /** Efectos por palabra clave (migración del formato sfx_config.json). */
  sfx: z.array(esquemaCatalogoSfx),
  /** Pistas musicales de ejemplo (se importan a la biblioteca al usarlas). */
  musica: z.array(esquemaCatalogoMusica),
});

export const esquemaConfigApp = z.strictObject({
  motor: esquemaMotor,
  backend: esquemaBackend,
  audio: esquemaAudio,
  lineaTiempo: esquemaLineaTiempo,
  ffmpegMp3: esquemaFfmpegMp3,
  ui: esquemaUi,
  transcripcion: esquemaTranscripcion,
  catalogos: esquemaCatalogos,
});

export type ConfigApp = z.infer<typeof esquemaConfigApp>;
