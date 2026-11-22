/**
 * Proyectos de sesión (.telar.json): guardar y cargar la línea de tiempo
 * (con su audio embebido, sin pérdida) y los datos de la sesión
 * (transcripciones, curvas de tensión, colocaciones de SFX).
 *
 * Decisiones (ADR-016):
 *  - Un ÚNICO archivo JSON autocontenido: el audio va embebido como base64 de
 *    los Float32 de cada canal (sin pérdida, sin códec, sin dependencias). El
 *    coste es tamaño (~5,3 bytes/muestra + 33 % de base64); el techo
 *    configurable proyectos.tamanoMaximoMb protege al navegador de documentos
 *    gigantes. Un formato binario (zip con WAV sueltos) queda en docs/pending.
 *  - Los buffers se DEDUPLICAN por identidad: todos los clips que comparten un
 *    mismo AudioBuffer (el caso normal: varios recortes de la misma pista)
 *    embeben el audio una sola vez.
 *  - Los datos conservan su idDato, tipoDato y revisión: al cargar, una
 *    transcripción vuelve a su ranura exacta (las referencias entre datos,
 *    p. ej. colocaciones→transcripción, siguen resolviendo).
 *  - El grafo de nodos NO forma parte del proyecto (decisión de alcance: se
 *    guarda el trabajo de edición, no la configuración de la herramienta).
 */

import { z } from 'zod';
import { ErrorValidacion } from '@telar/motor';
import type { DatoRegistrado } from '@telar/motor';
import type { PistaTelar, TipoPista } from '@telar/linea-tiempo';

/** Fábrica de AudioBuffer inyectada: permite probar la deserialización sin Web Audio. */
export type FabricaAudioBuffer = (canales: Float32Array[], tasaMuestreo: number) => AudioBuffer;

// ------------------------------------------------------------ base64 float32

/**
 * Codifica un canal Float32 a base64. Se asume little-endian: es el orden de
 * bytes de todos los navegadores reales para TypedArrays (el 100 % del hardware
 * que ejecuta esta app); el documento lo declara implícitamente en su versión 1.
 */
export function base64DeFloat32(canal: Float32Array): string {
  const bytes = new Uint8Array(canal.buffer, canal.byteOffset, canal.byteLength);
  let binario = '';
  /* String.fromCharCode(...trozo) por bloques: con el canal entero la pila
     revienta en archivos grandes. */
  const TROZO = 0x8000;
  for (let i = 0; i < bytes.length; i += TROZO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TROZO));
  }
  return btoa(binario);
}

/** Decodifica un canal base64 a Float32Array; valida que la longitud encaje. */
export function float32DesdeBase64(texto: string, longitud: number): Float32Array {
  const binario = atob(texto);
  if (binario.length !== longitud * 4) {
    throw new ErrorValidacion({
      codigo: 'PROYECTO_INVALIDO',
      mensaje: `Canal con longitud declarada ${longitud} pero ${binario.length / 4} muestras reales.`,
      mensajeUsuario: 'El archivo de proyecto está dañado (un canal de audio no encaja con su longitud declarada).',
      reintentable: false,
    });
  }
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) {
    bytes[i] = binario.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer, 0, longitud);
}

// ------------------------------------------------------------- documento v1

const esquemaFundido = z.strictObject({
  /** Duración en segundos (unidad de la librería de línea de tiempo). */
  duration: z.number().min(0),
  type: z.enum(['logarithmic', 'linear', 'sCurve', 'exponential']).optional(),
});

const esquemaClip = z.strictObject({
  id: z.string().min(1),
  startSample: z.number().int().min(0),
  startTick: z.number().optional(),
  durationSamples: z.number().int().min(1),
  offsetSamples: z.number().int().min(0),
  sampleRate: z.number().int().min(1),
  sourceDurationSamples: z.number().int().min(1),
  gain: z.number(),
  name: z.string().optional(),
  color: z.string().optional(),
  fadeIn: esquemaFundido.optional(),
  fadeOut: esquemaFundido.optional(),
  /** Clave del audio embebido al que pertenece este clip. */
  audioClave: z.string().min(1),
});

const esquemaPista = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  tipoPista: z.enum(['voz', 'musica', 'efectos', 'salida']),
  muted: z.boolean(),
  soloed: z.boolean(),
  volume: z.number(),
  pan: z.number(),
  color: z.string().optional(),
  clips: z.array(esquemaClip),
});

const esquemaAudio = z.strictObject({
  clave: z.string().min(1),
  /** Un base64 por canal (little-endian float32). */
  canales: z.array(z.string().min(1)).min(1),
  tasaMuestreo: z.number().int().min(1),
  longitud: z.number().int().min(1),
  /** Nombre de la primera pista que usa este audio (para la biblioteca al cargar). */
  nombreOrigen: z.string().min(1),
});

const esquemaDato = z.strictObject({
  idDato: z.string().min(1),
  tipoDato: z.string().min(1),
  contenido: z.unknown(),
  revision: z.number().int().min(1),
  creadoEn: z.number().int().min(0),
});

const esquemaDocumento = z.strictObject({
  version: z.number().int().min(1),
  guardadoEn: z.number().int().min(0),
  pistas: z.array(esquemaPista),
  audios: z.array(esquemaAudio),
  datos: z.array(esquemaDato),
});

export interface AudioEmbebido extends z.infer<typeof esquemaAudio> {}
export interface PistaSerializada extends z.infer<typeof esquemaPista> {}
export interface ClipSerializado extends z.infer<typeof esquemaClip> {}

/** Documento .telar.json completo (lo que se escribe y se lee del disco). */
export interface DocumentoProyecto extends z.infer<typeof esquemaDocumento> {}

// -------------------------------------------------------------- serialización

export interface EntradaGuardado {
  pistas: PistaTelar[];
  datos: DatoRegistrado[];
}

/**
 * Serializa la sesión a un DocumentoProyecto. Falla con error tipado si algún
 * clip no tiene su audio cargado (no habría forma fiel de restaurarlo).
 */
export function serializarProyecto(entrada: EntradaGuardado): DocumentoProyecto {
  const audios: AudioEmbebido[] = [];
  const clavesPorBuffer = new Map<AudioBuffer, string>();
  const pistas: PistaSerializada[] = entrada.pistas.map((pista) => ({
    id: pista.id,
    name: pista.name,
    tipoPista: pista.tipoPista,
    muted: pista.muted,
    soloed: pista.soloed,
    volume: pista.volume,
    pan: pista.pan,
    ...(pista.color !== undefined ? { color: pista.color } : {}),
    clips: pista.clips.map((clip) => {
      if (!clip.audioBuffer) {
        throw new ErrorValidacion({
          codigo: 'PROYECTO_CLIP_SIN_AUDIO',
          mensaje: `El clip ${clip.id} de «${pista.name}» no tiene su audio cargado.`,
          mensajeUsuario:
            'Uno de los clips aún no tiene su audio cargado. Espera a que termine de cargar y vuelve a guardar.',
          reintentable: true,
        });
      }
      let clave = clavesPorBuffer.get(clip.audioBuffer);
      if (clave === undefined) {
        clave = `audio-${audios.length}`;
        const canales: string[] = [];
        for (let canal = 0; canal < clip.audioBuffer.numberOfChannels; canal += 1) {
          canales.push(base64DeFloat32(clip.audioBuffer.getChannelData(canal)));
        }
        audios.push({
          clave,
          canales,
          tasaMuestreo: clip.audioBuffer.sampleRate,
          longitud: clip.audioBuffer.length,
          nombreOrigen: pista.name,
        });
        clavesPorBuffer.set(clip.audioBuffer, clave);
      }
      return {
        id: clip.id,
        startSample: clip.startSample,
        ...(clip.startTick !== undefined ? { startTick: clip.startTick } : {}),
        durationSamples: clip.durationSamples,
        offsetSamples: clip.offsetSamples,
        sampleRate: clip.sampleRate,
        sourceDurationSamples: clip.sourceDurationSamples,
        gain: clip.gain,
        ...(clip.name !== undefined ? { name: clip.name } : {}),
        ...(clip.color !== undefined ? { color: clip.color } : {}),
        ...(clip.fadeIn !== undefined ? { fadeIn: { ...clip.fadeIn } } : {}),
        ...(clip.fadeOut !== undefined ? { fadeOut: { ...clip.fadeOut } } : {}),
        audioClave: clave,
      };
    }),
  }));

  return {
    version: 1,
    guardadoEn: Date.now(),
    pistas,
    audios,
    datos: entrada.datos.map((dato) => ({ ...dato })),
  };
}

// ------------------------------------------------------------ deserialización

export interface AudioReconstruido {
  documento: AudioEmbebido;
  canales: Float32Array[];
  buffer: AudioBuffer;
}

export interface ResultadoDeserializacion {
  documento: DocumentoProyecto;
  pistas: PistaTelar[];
  /** Audios únicos reconstruidos, en el orden del documento (para registrar como activos). */
  audios: AudioReconstruido[];
}

/**
 * Valida y reconstruye un documento de proyecto. `bruto` suele venir de
 * JSON.parse; cualquier desviación del esquema (versión incluida) es un error
 * tipado con mensaje accionable, nunca un fallo silencioso.
 */
export function deserializarProyecto(
  bruto: unknown,
  opciones: { versionEsperada: number; crearBuffer: FabricaAudioBuffer },
): ResultadoDeserializacion {
  const analisis = esquemaDocumento.safeParse(bruto);
  if (!analisis.success) {
    const problemas = analisis.error.issues
      .slice(0, 4)
      .map((problema) => `${problema.path.join('.') || '(raíz)'}: ${problema.message}`)
      .join(' · ');
    throw new ErrorValidacion({
      codigo: 'PROYECTO_INVALIDO',
      mensaje: `El documento no superó la validación: ${problemas}`,
      mensajeUsuario:
        'Ese archivo no es un proyecto de Telar válido (estructura no reconocida). Comprueba que sea un .telar.json descargado desde la aplicación.',
      reintentable: false,
    });
  }
  const documento = analisis.data as DocumentoProyecto;
  if (documento.version !== opciones.versionEsperada) {
    throw new ErrorValidacion({
      codigo: 'PROYECTO_VERSION_NO_SOPORTADA',
      mensaje: `El documento usa la versión ${documento.version} y esta aplicación espera la ${opciones.versionEsperada}.`,
      mensajeUsuario:
        `Ese proyecto se guardó con una versión del formato (${documento.version}) que esta aplicación no lee ` +
        `(espera la ${opciones.versionEsperada}). Actualiza la aplicación para abrirlo.`,
      reintentable: false,
    });
  }

  const buffersPorClave = new Map<string, AudioReconstruido>();
  const audios: AudioReconstruido[] = [];
  for (const audioDocumento of documento.audios) {
    const canales = audioDocumento.canales.map((texto) =>
      float32DesdeBase64(texto, audioDocumento.longitud),
    );
    const buffer = opciones.crearBuffer(canales, audioDocumento.tasaMuestreo);
    const reconstruido: AudioReconstruido = { documento: audioDocumento, canales, buffer };
    audios.push(reconstruido);
    buffersPorClave.set(audioDocumento.clave, reconstruido);
  }

  const pistas: PistaTelar[] = documento.pistas.map((pista) => ({
    id: pista.id,
    name: pista.name,
    tipoPista: pista.tipoPista as TipoPista,
    muted: pista.muted,
    soloed: pista.soloed,
    volume: pista.volume,
    pan: pista.pan,
    ...(pista.color !== undefined ? { color: pista.color } : {}),
    clips: pista.clips.map((clip) => {
      const audio = buffersPorClave.get(clip.audioClave);
      if (!audio) {
        throw new ErrorValidacion({
          codigo: 'PROYECTO_INVALIDO',
          mensaje: `El clip ${clip.id} referencia el audio «${clip.audioClave}» que no existe en el documento.`,
          mensajeUsuario: 'El archivo de proyecto está dañado (un clip referencia un audio inexistente).',
          reintentable: false,
        });
      }
      const { audioClave, ...escalares } = clip;
      void audioClave;
      return {
        ...escalares,
        audioBuffer: audio.buffer,
      };
    }),
  }));

  return { documento, pistas, audios };
}

// -------------------------------------------------------------- utilidades

/** Lanza error tipado si el documento supera el techo configurado (MB). */
export function comprobarTamañoProyecto(bytes: number, limiteMb: number): void {
  const limiteBytes = limiteMb * 1024 * 1024;
  if (bytes > limiteBytes) {
    throw new ErrorValidacion({
      codigo: 'PROYECTO_DEMASIADO_GRANDE',
      mensaje: `El documento ocupa ${Math.round(bytes / (1024 * 1024))} MB y el límite es ${limiteMb} MB.`,
      mensajeUsuario:
        `Ese proyecto ocupa ${Math.round(bytes / (1024 * 1024))} MB y el límite configurado es ${limiteMb} MB. ` +
        'Divide la sesión en proyectos más pequeños o sube proyectos.tamanoMaximoMb en la configuración.',
      reintentable: false,
    });
  }
}

/** Nombre de descarga: prefijo + fecha local, p. ej. proyecto-telar-20261122-1930.telar.json. */
export function nombreArchivoProyecto(prefijo: string, fecha: Date = new Date()): string {
  const dos = (n: number): string => String(n).padStart(2, '0');
  const sello =
    `${fecha.getFullYear()}${dos(fecha.getMonth() + 1)}${dos(fecha.getDate())}` +
    `-${dos(fecha.getHours())}${dos(fecha.getMinutes())}`;
  return `${prefijo}-${sello}.telar.json`;
}
