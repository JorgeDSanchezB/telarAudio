/**
 * Transcodificación de rescate con ffmpeg.wasm: convierte a WAV cualquier
 * formato de audio/vídeo que FFmpeg sepa leer (AMR, 3gp, WMA, ALAC, OPUS…)
 * para archivos que el navegador no decodifica con decodeAudioData.
 *
 * Comparte el cargador de ffmpeg.wasm con el exportador MP3 (ADR-010): el
 * núcleo se descarga una vez (~30 MB) y ambas funcionalidades lo reutilizan.
 * Por eso también comparte la penalidad: sin `npm run preparar:ffmpeg` no
 * está disponible y el error explica cómo activarla.
 */

import { ErrorTemporal } from '@telar/motor';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { cargarScript } from './exportacion';
import type { ConfigExportadorMp3, VentanaConFFmpeg } from './exportacion';

export class TranscodificadorWasm {
  private instancia: FFmpeg | null = null;
  private cargando: Promise<FFmpeg> | null = null;
  /** ffmpeg.wasm comparte instancia y ficheros virtuales: cola obligatoria. */
  private cola: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigExportadorMp3) {}

  disponible(): boolean {
    return this.config.habilitado;
  }

  /** Convierte bytes (cualquier formato FFmpeg) a WAV PCM 16 bits. */
  transcodificarAWav(bytes: Uint8Array, senal?: AbortSignal): Promise<Uint8Array> {
    const tarea = this.cola.then(() => this.ejecutarAislado(bytes, senal));
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  private async ejecutarAislado(bytes: Uint8Array, senal?: AbortSignal): Promise<Uint8Array> {
    if (!this.config.habilitado) {
      throw new ErrorTemporal({
        codigo: 'TRANSCODIFICADOR_DESHABILITADO',
        mensaje: 'La transcodificación con ffmpeg.wasm está deshabilitada en la configuración.',
        mensajeUsuario: 'La transcodificación de rescate está desactivada en la configuración.',
        reintentable: false,
      });
    }
    const ffmpeg = await this.obtenerInstancia();
    senal?.throwIfAborted();
    await ffmpeg.writeFile('entrada.rescate', bytes);
    try {
      const codigo = await ffmpeg.exec([
        '-i',
        'entrada.rescate',
        '-vn',
        '-c:a',
        'pcm_s16le',
        'salida.rescate.wav',
      ]);
      if (codigo !== 0) {
        throw new ErrorTemporal({
          codigo: 'TRANSCODIFICACION_FALLIDA',
          mensaje: `ffmpeg.wasm terminó con código ${codigo} al transcodificar.`,
          mensajeUsuario:
            'FFmpeg tampoco pudo leer ese archivo: probablemente esté corrupto o no sea un formato de audio conocido.',
          reintentable: false,
        });
      }
      const datos = await ffmpeg.readFile('salida.rescate.wav');
      if (!(datos instanceof Uint8Array)) {
        throw new ErrorTemporal({
          codigo: 'TRANSCODIFICACION_INVALIDA',
          mensaje: 'ffmpeg.wasm no devolvió bytes de WAV.',
          mensajeUsuario: 'La transcodificación devolvió un resultado inesperado. Vuelve a intentarlo.',
          reintentable: true,
        });
      }
      // Copia defensiva: el fichero virtual se borra pero el buffer podría
      // ser una vista sobre memoria compartida del núcleo.
      return datos.slice(0);
    } finally {
      await ffmpeg.deleteFile('entrada.rescate').catch(() => undefined);
      await ffmpeg.deleteFile('salida.rescate.wav').catch(() => undefined);
    }
  }

  private obtenerInstancia(): Promise<FFmpeg> {
    if (this.instancia) {
      return Promise.resolve(this.instancia);
    }
    if (this.cargando) {
      return this.cargando;
    }
    this.cargando = (async () => {
      try {
        await cargarScript(this.config.umdUrl);
        const clase = (window as unknown as VentanaConFFmpeg).FFmpegWASM?.FFmpeg;
        if (!clase) {
          throw new Error('El bundle UMD de ffmpeg.wasm no expuso FFmpegWASM');
        }
        const ffmpeg = new clase();
        await ffmpeg.load({
          coreURL: this.config.coreUrl,
          wasmURL: this.config.wasmUrl,
        });
        this.instancia = ffmpeg;
        return ffmpeg;
      } catch (causa) {
        this.cargando = null;
        throw new ErrorTemporal(
          {
            codigo: 'FFMPEG_WASM_NO_DISPONIBLE',
            mensaje: 'No se pudo cargar ffmpeg.wasm para transcodificar.',
            mensajeUsuario:
              'El transcodificador (ffmpeg.wasm) no está disponible ahora; se intentará el backend local.',
            reintentable: true,
          },
          causa,
        );
      }
    })();
    return this.cargando;
  }
}
