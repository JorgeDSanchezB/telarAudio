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

export function cargarScript(url: string): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const existente = document.querySelector<HTMLScriptElement>(`script[data-telar-ffmpeg="${url}"]`);
    if (existente) {
      existente.addEventListener('load', () => resolver(), { once: true });
      existente.addEventListener('error', () => rechazar(new Error(`No se pudo cargar ${url}`)), { once: true });
      if ((window as unknown as VentanaConFFmpeg).FFmpegWASM) {
        resolver();
      }
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.telarFfmpeg = url;
    script.addEventListener('load', () => resolver(), { once: true });
    script.addEventListener('error', () => rechazar(new Error(`No se pudo cargar ${url}`)), { once: true });
    document.head.appendChild(script);
  });
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
      try {
        await cargarScript(this.config.umdUrl);
        const clase = (window as unknown as VentanaConFFmpeg).FFmpegWASM?.FFmpeg;
        if (!clase) {
          throw new Error('El bundle UMD de ffmpeg.wasm no expuso FFmpegWASM');
        }
        const ffmpeg = new clase();
        // Sin classWorkerURL: la build UMD resuelve el worker desde su propia
        // ruta pública (/ffmpeg/814.ffmpeg.js).
        await ffmpeg.load({
          coreURL: this.config.coreUrl,
          wasmURL: this.config.wasmUrl,
        });
        this.instancia = ffmpeg;
        return ffmpeg;
      } catch (causa) {
        this.cargando = null;
        throw new ErrorConfiguracion(
          {
            codigo: 'FFMPEG_NO_PREPARADO',
            mensaje: 'No se pudo cargar ffmpeg.wasm.',
            mensajeUsuario:
              'El exportador MP3 no está disponible porque falta ffmpeg.wasm. Ejecuta "npm run preparar:ffmpeg" en la raíz del proyecto (una sola vez) y vuelve a intentarlo. El export en WAV funciona sin este paso.',
            reintentable: false,
          },
          causa,
        );
      }
    })();
    return this.cargando;
  }
}
