/**
 * Exportación: descarga directa de blobs y conversión opcional WAV -> MP3
 * con ffmpeg.wasm (ADR-010).
 *
 * Carga de ffmpeg.wasm: usamos el bundle UMD servido desde /public/ffmpeg
 * (copiado con `npm run preparar:ffmpeg`) mediante un <script> dinámico.
 * El motivo es técnico y está documentado en ADR-010: la build ESM de
 * @ffmpeg/ffmpeg 0.12 contiene `new Worker(new URL(classWorkerURL,
 * import.meta.url))`, que Turbopack no puede analizar estáticamente y rompe
 * `next build`. La build UMD resuelve su worker desde su propia ruta pública
 * (/ffmpeg/814.ffmpeg.js), que es justo donde lo sirve este proyecto. El
 * paquete npm queda solo como dependencia de tipos.
 *
 * La primera carga (~30 MB) tarda unos segundos; si falta el núcleo, el
 * error es de configuración con instrucciones claras y el export WAV sigue
 * funcionando sin él.
 */

import { ErrorConfiguracion, ErrorTemporal } from '@telar/motor';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

export interface ConfigExportadorMp3 {
  habilitado: boolean;
  /** URL del bundle UMD (relativa a la app). */
  umdUrl: string;
  coreUrl: string;
  wasmUrl: string;
  tasaBits: number;
  /** Tiempo máximo (ms) para cargar el núcleo de ffmpeg.wasm (~32 MB). */
  timeoutCargaMs: number;
}

export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export interface VentanaConFFmpeg {
  FFmpegWASM?: { FFmpeg: new () => FFmpeg };
}

/**
 * Cargas de script en curso o terminadas, por URL. Si un <script> falló, se
 * saca de la tabla para que el siguiente intento vuelva a intentarlo: cache-
 * ar la promesa rechazada haría imposible reintentar tras un fallo de red.
 */
const scriptsCargados = new Map<string, Promise<void>>();

export function cargarScript(url: string): Promise<void> {
  const enCurso = scriptsCargados.get(url);
  if (enCurso) {
    return enCurso;
  }
  const promesa = new Promise<void>((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.addEventListener('load', () => resolver(), { once: true });
    script.addEventListener('error', () => rechazar(new Error(`No se pudo cargar ${url}`)), { once: true });
    document.head.appendChild(script);
  });
  scriptsCargados.set(url, promesa);
  // Un fallo no se memoriza: la siguiente llamada reintentará la descarga.
  promesa.catch(() => scriptsCargados.delete(url));
  return promesa;
}

export class ExportadorMp3 {
  private instancia: FFmpeg | null = null;
  private cargando: Promise<FFmpeg> | null = null;
  /** Serializa conversiones: ffmpeg.wasm comparte una instancia y unos
   * ficheros virtuales; dos conversiones simultáneas se pisarían. */
  private cola: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: ConfigExportadorMp3) {}

  convertirWavAMP3(bytesWav: Uint8Array, senal?: AbortSignal): Promise<Blob> {
    const tarea = this.cola.then(() => this.convertirWavAMP3Aislada(bytesWav, senal));
    // La cola nunca se rompe: el error se propaga a quien lo causó.
    this.cola = tarea.catch(() => undefined);
    return tarea;
  }

  private async convertirWavAMP3Aislada(bytesWav: Uint8Array, senal?: AbortSignal): Promise<Blob> {
    if (!this.config.habilitado) {
      throw new ErrorConfiguracion({
        codigo: 'MP3_DESHABILITADO',
        mensaje: 'El exportador MP3 está deshabilitado en la configuración.',
        mensajeUsuario: 'El export MP3 está desactivado en la configuración de la aplicación. Usa WAV.',
        reintentable: false,
      });
    }
    const ffmpeg = await this.obtenerInstancia();
    senal?.throwIfAborted();
    await ffmpeg.writeFile('entrada.wav', bytesWav);
    try {
      const codigo = await ffmpeg.exec(['-i', 'entrada.wav', '-b:a', String(this.config.tasaBits), 'salida.mp3']);
      if (codigo !== 0) {
        throw new ErrorTemporal({
          codigo: 'FFMPEG_CONVERSION_FALLIDA',
          mensaje: `ffmpeg.wasm terminó con código ${codigo}.`,
          mensajeUsuario: 'La conversión a MP3 falló. Prueba de nuevo o exporta en WAV.',
          reintentable: true,
        });
      }
      const datos = await ffmpeg.readFile('salida.mp3');
      return new Blob([datos as unknown as BlobPart], { type: 'audio/mpeg' });
    } finally {
      await ffmpeg.deleteFile('entrada.wav').catch(() => undefined);
      await ffmpeg.deleteFile('salida.mp3').catch(() => undefined);
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
      let cargaAbortada = false;
      try {
        await cargarScript(this.config.umdUrl);
        const clase = (window as unknown as VentanaConFFmpeg).FFmpegWASM?.FFmpeg;
        if (!clase) {
          throw new Error('El bundle UMD de ffmpeg.wasm no expuso FFmpegWASM');
        }
        const ffmpeg = new clase();
        // Sin classWorkerURL: la build UMD resuelve el worker desde su propia
        // ruta pública (/ffmpeg/814.ffmpeg.js).
        // La carga lleva límite de tiempo (ffmpegMp3.timeoutCargaMs): si el
        // worker o el núcleo (~32 MB) no llegan, load() quedaría colgado
        // indefinidamente (la librería no gestiona ese fallo), así que se
        // aborta y se traduce a un error de configuración accionable.
        const control = new AbortController();
        const temporizador = setTimeout(() => {
          cargaAbortada = true;
          control.abort();
        }, this.config.timeoutCargaMs);
        try {
          await ffmpeg.load(
            {
              coreURL: this.config.coreUrl,
              wasmURL: this.config.wasmUrl,
            },
            { signal: control.signal },
          );
        } finally {
          clearTimeout(temporizador);
        }
        this.instancia = ffmpeg;
        return ffmpeg;
      } catch (causa) {
        this.cargando = null;
        throw new ErrorConfiguracion(
          {
            codigo: 'FFMPEG_NO_PREPARADO',
            mensaje: 'No se pudo cargar ffmpeg.wasm.',
            mensajeUsuario:
              cargaAbortada
                ? 'La descarga del transcodificador (ffmpeg.wasm, ~32 MB) no terminó a tiempo. Revisa tu conexión y vuelve a intentarlo; mientras tanto el export en WAV funciona siempre.'
                : 'El exportador MP3 no está disponible porque falta ffmpeg.wasm. Ejecuta "npm run preparar:ffmpeg" en la raíz del proyecto (una sola vez) y vuelve a intentarlo. El export en WAV funciona sin este paso.',
            reintentable: false,
          },
          causa,
        );
      }
    })();
    return this.cargando;
  }
}
