/**
 * Decodificación de audio con Web Audio API.
 *
 * Toda la sesión trabaja a UNA tasa (la del AudioContext, 48 kHz por
 * configuración): decodeAudioData remuestrea automáticamente, así que todos
 * los buffers (subidas y renders) comparten tasa y la línea de tiempo evita
 * conversiones frágiles. Límite práctico documentado: el audio completo vive
 * decodificado en memoria (ver docs/arquitectura/05-renderizado.md).
 */

import { ErrorValidacion } from '@telar/motor';
import type { ServicioAudio } from '@telar/motor';

export type ProveedorBytesActivo = (idActivo: string) => Promise<Blob>;

export class DecodificadorAudio implements ServicioAudio {
  private contexto: AudioContext | null = null;
  private readonly cache = new Map<string, AudioBuffer>();

  constructor(
    private readonly tasaMuestreo: number,
    private readonly obtenerBytes: ProveedorBytesActivo,
  ) {}

  /** Contexto perezoso: no se crea en el servidor ni hasta el primer uso. */
  private contextoAudio(): AudioContext {
    if (!this.contexto) {
      this.contexto = new AudioContext({ sampleRate: this.tasaMuestreo });
    }
    return this.contexto;
  }

  /** Decodifica bytes crudos (con caché opcional por id de activo). */
  async decodificarBytes(bytes: ArrayBuffer, cacheId?: string): Promise<AudioBuffer> {
    if (cacheId) {
      const enCache = this.cache.get(cacheId);
      if (enCache) {
        return enCache;
      }
    }
    let buffer: AudioBuffer;
    try {
      buffer = await this.contextoAudio().decodeAudioData(bytes);
    } catch (causa) {
      throw new ErrorValidacion(
        {
          codigo: 'AUDIO_NO_DECODIFICABLE',
          mensaje: 'El navegador no pudo decodificar el audio recibido.',
          mensajeUsuario:
            'Ese archivo no se pudo decodificar como audio. Formatos admitidos en Chrome: WAV, MP3, OGG, M4A/AAC, FLAC y WebM.',
          reintentable: false,
        },
        causa,
      );
    }
    if (cacheId) {
      this.cache.set(cacheId, buffer);
    }
    return buffer;
  }

  /** Implementación de ServicioAudio: decodifica un activo de la biblioteca. */
  async decodificar(idActivo: string, _senal?: AbortSignal): Promise<AudioBuffer> {
    void _senal;
    const enCache = this.cache.get(idActivo);
    if (enCache) {
      return enCache;
    }
    const blob = await this.obtenerBytes(idActivo);
    const bytes = await blob.arrayBuffer();
    return this.decodificarBytes(bytes, idActivo);
  }

  /** Precarga un buffer ya decodificado bajo un id (tras subidas o renders). */
  registrarEnCache(idActivo: string, buffer: AudioBuffer): void {
    this.cache.set(idActivo, buffer);
  }
}
