/**
 * Cliente del backend opcional (nodos pesados). Implementa el protocolo de
 * trabajos definido en docs/api/contratos-backend.md:
 *
 *   POST   /api/v1/{capacidad}/trabajos        (multipart) -> 202 {id}
 *   GET    /api/v1/{capacidad}/trabajos/{id}   -> estado + progreso
 *   GET    /api/v1/{capacidad}/trabajos/{id}/resultado -> audio/wav
 *   DELETE /api/v1/{capacidad}/trabajos/{id}   -> cancelar
 *
 * Tolerancia a fallos: distingue 401/403 (autorización), 409/422 (datos
 * inválidos o de configuración), 404 (trabajo desaparecido), 413 (tamaño),
 * 429/5xx/red (temporales, con reintentos y backoff) y problemas RFC 7807
 * del backend. Nunca convierte un error importante en un valor por defecto.
 */

import {
  ErrorAutorizacion,
  ErrorCancelacion,
  ErrorConfiguracion,
  ErrorTemporal,
  ErrorValidacion,
} from '@telar/motor';
import type { ClienteBackend, RespuestaCapacidad } from '@telar/motor';
import type { DecodificadorAudio } from './audio';
import type { ServicioRegistroActivos } from '@telar/motor';

export interface ConfigClienteBackend {
  url: string;
  intervaloSondeoMs: number;
  timeoutSaludMs: number;
  reintentosTemporales: number;
  ttlVerificacionMs: number;
  backoffBaseMs: number;
}

interface ProblemaBackend {
  titulo?: string;
  detalle?: string;
  codigo?: string;
  categoria?: string;
}

function esperar(ms: number, senal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => {
      senal?.removeEventListener('abort', alAbortar);
      resolver();
    }, ms);
    const alAbortar = () => {
      clearTimeout(temporizador);
      rechazar(new ErrorCancelacion());
    };
    if (senal?.aborted) {
      alAbortar();
      return;
    }
    senal?.addEventListener('abort', alAbortar, { once: true });
  });
}

function textoDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ClienteBackendLocal implements ClienteBackend {
  private verificacionCacheada: { respuesta: RespuestaCapacidad; caducaEn: number } | null = null;

  constructor(
    private readonly config: ConfigClienteBackend,
    private readonly dependencias: {
      activos: ServicioRegistroActivos;
      decodificador: DecodificadorAudio;
      registrar: (mensaje: string) => void;
    },
  ) {}

  async verificar(): Promise<RespuestaCapacidad> {
    const ahora = Date.now();
    if (this.verificacionCacheada && this.verificacionCacheada.caducaEn > ahora) {
      return this.verificacionCacheada.respuesta;
    }
    let respuesta: RespuestaCapacidad;
    try {
      const salud = await fetch(`${this.config.url}/api/v1/salud`, {
        signal: AbortSignal.timeout(this.config.timeoutSaludMs),
        headers: { accept: 'application/json' },
      });
      if (!salud.ok) {
        respuesta = { disponible: false, detalle: `El backend respondió con estado ${salud.status}` };
      } else {
        const cuerpo = (await salud.json()) as { estado?: string; version?: string; capacidades?: string[] };
        respuesta = {
          disponible: cuerpo.estado === 'ok',
          version: cuerpo.version,
          capacidades: cuerpo.capacidades ?? [],
          detalle: cuerpo.estado === 'ok' ? undefined : `El backend reportó estado "${String(cuerpo.estado)}"`,
        };
      }
    } catch (error) {
      respuesta = {
        disponible: false,
        detalle: `Sin conexión con ${this.config.url} (${textoDeError(error)})`,
      };
    }
    this.verificacionCacheada = { respuesta, caducaEn: Date.now() + this.config.ttlVerificacionMs };
    return respuesta;
  }

  /** Invalida la caché de verificación (p. ej. botón "comprobar de nuevo"). */
  olvidarVerificacion(): void {
    this.verificacionCacheada = null;
  }

  async ejecutarNodo(parametros: {
    capacidad: string;
    idActivoEntrada: string;
    parametrosNodo: Record<string, unknown>;
    onProgreso?: (fraccion: number, mensaje: string) => void;
    senal?: AbortSignal;
  }): Promise<{ idActivoSalida: string }> {
    const { capacidad, idActivoEntrada, parametrosNodo, onProgreso, senal } = parametros;
    const base = this.config.url;

    // 1) Subir el audio con reintentos ante errores temporales.
    onProgreso?.(0.02, 'Enviando el audio al backend local…');
    const blob = await this.dependencias.activos.obtenerBytes(idActivoEntrada);
    const idTrabajo = await this.subirTrabajo(base, capacidad, blob, parametrosNodo, senal);

    // 2) Sondear el estado hasta terminar, informando del progreso.
    onProgreso?.(0.08, 'En cola en el backend local…');
    await this.sondearHastaTerminar(base, capacidad, idTrabajo, onProgreso, senal);

    // 3) Descargar el resultado y registrarlo en la biblioteca.
    onProgreso?.(0.95, 'Descargando el audio limpio…');
    const bytes = await this.descargarResultado(base, capacidad, idTrabajo, senal);
    // decodeAudioData desprende el buffer: copia antes de decodificar.
    const copia = bytes.slice(0);
    const buffer = await this.dependencias.decodificador.decodificarBytes(
      copia.buffer.slice(copia.byteOffset, copia.byteOffset + copia.byteLength) as ArrayBuffer,
    );
    onProgreso?.(0.99, 'Guardando el resultado en la biblioteca…');
    const meta = await this.dependencias.activos.poner(new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' }), {
      nombre: `${capacidad}-${idTrabajo.slice(0, 8)}.wav`,
      mime: 'audio/wav',
      duracionMs: Math.round(buffer.duration * 1000),
      tasaMuestreo: buffer.sampleRate,
      canales: buffer.numberOfChannels,
      bytes: bytes.byteLength,
      origen: 'nodo',
    });
    this.dependencias.decodificador.registrarEnCache(meta.id, buffer);
    return { idActivoSalida: meta.id };
  }

  /**
   * Variante con resultado JSON (capacidad "transcripcion"): sube, sondea y
   * devuelve el contenido del resultado sin registrarlo (quien llama decide).
   */
  async ejecutarNodoDato(parametros: {
    capacidad: string;
    idActivoEntrada: string;
    parametrosNodo: Record<string, unknown>;
    onProgreso?: (fraccion: number, mensaje: string) => void;
    senal?: AbortSignal;
  }): Promise<unknown> {
    const { capacidad, idActivoEntrada, parametrosNodo, onProgreso, senal } = parametros;
    const base = this.config.url;

    onProgreso?.(0.02, 'Enviando el audio al backend local…');
    const blob = await this.dependencias.activos.obtenerBytes(idActivoEntrada);
    const idTrabajo = await this.subirTrabajo(base, capacidad, blob, parametrosNodo, senal);

    onProgreso?.(0.08, 'En cola en el backend local…');
    await this.sondearHastaTerminar(base, capacidad, idTrabajo, onProgreso, senal);

    onProgreso?.(0.95, 'Descargando el resultado…');
    const bytes = await this.descargarResultado(base, capacidad, idTrabajo, senal);
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (causa) {
      throw new ErrorTemporal(
        {
          codigo: 'BACKEND_RESPUESTA_INVALIDA',
          mensaje: 'El resultado JSON del backend no se pudo parsear.',
          mensajeUsuario: 'El backend devolvió un resultado ilegible. Reintenta el nodo.',
          reintentable: true,
        },
        causa,
      );
    }
  }

  /**
   * Transcodificación de rescate vía backend (capacidad "transcodificar"):
   * devuelve los bytes WAV sin registrarlos en la biblioteca; quien llama
   * decide qué hacer con ellos. Se usa cuando el navegador no puede
   * decodificar un archivo subido y ffmpeg.wasm tampoco está disponible.
   */
  async transcodificarAWav(parametros: {
    bytes: Uint8Array;
    onProgreso?: (fraccion: number, mensaje: string) => void;
    senal?: AbortSignal;
  }): Promise<Uint8Array> {
    const { bytes, onProgreso, senal } = parametros;
    const base = this.config.url;
    const capacidad = 'transcodificar';
    onProgreso?.(0.05, 'Enviando el archivo al backend local para transcodificar…');
    const idTrabajo = await this.subirTrabajo(
      base,
      capacidad,
      new Blob([bytes as unknown as BlobPart]),
      {},
      senal,
    );
    onProgreso?.(0.1, 'En cola en el backend local…');
    await this.sondearHastaTerminar(base, capacidad, idTrabajo, onProgreso, senal);
    onProgreso?.(0.95, 'Descargando el WAV transcodificado…');
    return this.descargarResultado(base, capacidad, idTrabajo, senal);
  }

  // ------------------------------------------------------------ privados

  private async sondearHastaTerminar(
    base: string,
    capacidad: string,
    idTrabajo: string,
    onProgreso?: (fraccion: number, mensaje: string) => void,
    senal?: AbortSignal,
  ): Promise<void> {
    let ultimoProgresoInformado = -1;
    let fallosDeSondeo = 0;
    try {
      for (;;) {
        await esperar(this.config.intervaloSondeoMs, senal);
        const respuesta = await fetch(`${base}/api/v1/${capacidad}/trabajos/${idTrabajo}`, {
          signal: senal,
          headers: { accept: 'application/json' },
        });
        if (respuesta.status === 404) {
          throw new ErrorConfiguracion({
            codigo: 'TRABAJO_DESAPARECIDO',
            mensaje: `El trabajo ${idTrabajo} desapareció del backend.`,
            mensajeUsuario: 'El backend perdió el trabajo (¿se reinició?). Vuelve a ejecutar el nodo.',
            reintentable: false,
          });
        }
        if (!respuesta.ok) {
          fallosDeSondeo += 1;
          if (fallosDeSondeo > this.config.reintentosTemporales) {
            throw new ErrorTemporal({
              codigo: 'SONDEO_FALLIDO',
              mensaje: `El sondeo del trabajo falló con estado ${respuesta.status}.`,
              mensajeUsuario: 'Se perdió la comunicación con el backend durante el proceso. Reintenta el nodo.',
              reintentable: true,
            });
          }
          continue;
        }
        fallosDeSondeo = 0;
        const cuerpo = (await respuesta.json()) as {
          estado: string;
          progreso?: number | null;
          mensaje?: string | null;
          error?: ProblemaBackend | null;
        };
        if (cuerpo.estado === 'completado') {
          break;
        }
        if (cuerpo.estado === 'cancelado') {
          throw new ErrorCancelacion('El trabajo fue cancelado en el backend');
        }
        if (cuerpo.estado === 'error') {
          throw this.traducirProblema(cuerpo.error ?? null);
        }
        const fraccion =
          typeof cuerpo.progreso === 'number' ? Math.min(Math.max(cuerpo.progreso / 100, 0), 1) : 0.5;
        if (Math.abs(fraccion - ultimoProgresoInformado) > 0.005) {
          ultimoProgresoInformado = fraccion;
          onProgreso?.(0.08 + fraccion * 0.85, cuerpo.mensaje ?? 'Procesando en el backend local (FFmpeg)…');
        }
      }
    } catch (error) {
      if (error instanceof ErrorCancelacion || senal?.aborted) {
        // Cancelación del usuario: avisar al backend (mejor esfuerzo).
        void fetch(`${base}/api/v1/${capacidad}/trabajos/${idTrabajo}`, { method: 'DELETE' }).catch(() => undefined);
      }
      throw error;
    }
  }

  private async descargarResultado(
    base: string,
    capacidad: string,
    idTrabajo: string,
    senal?: AbortSignal,
  ): Promise<Uint8Array> {
    const descarga = await fetch(`${base}/api/v1/${capacidad}/trabajos/${idTrabajo}/resultado`, {
      signal: senal,
    });
    if (descarga.status === 409) {
      throw new ErrorTemporal({
        codigo: 'RESULTADO_NO_LISTO',
        mensaje: 'El resultado todavía no está disponible.',
        mensajeUsuario: 'El resultado no estaba listo todavía. Reintenta el nodo.',
        reintentable: true,
      });
    }
    if (!descarga.ok) {
      throw new ErrorTemporal({
        codigo: 'DESCARGA_FALLIDA',
        mensaje: `La descarga del resultado falló con estado ${descarga.status}.`,
        mensajeUsuario: 'No se pudo descargar el resultado del backend. Reintenta el nodo.',
        reintentable: true,
      });
    }
    return new Uint8Array(await descarga.arrayBuffer());
  }

  private async subirTrabajo(
    base: string,
    capacidad: string,
    blob: Blob,
    parametrosNodo: Record<string, unknown>,
    senal?: AbortSignal,
  ): Promise<string> {
    let intento = 0;
    for (;;) {
      const formulario = new FormData();
      formulario.append('archivo', blob, 'entrada');
      formulario.append('parametros', JSON.stringify(parametrosNodo));
      let respuesta: Response;
      try {
        respuesta = await fetch(`${base}/api/v1/${capacidad}/trabajos`, {
          method: 'POST',
          body: formulario,
          signal: senal,
        });
      } catch (error) {
        if (senal?.aborted) {
          throw new ErrorCancelacion();
        }
        if (intento < this.config.reintentosTemporales) {
          intento += 1;
          await esperar(this.config.backoffBaseMs * intento, senal);
          continue;
        }
        throw new ErrorTemporal(
          {
            codigo: 'SUBIDA_FALLIDA',
            mensaje: `No se pudo conectar con el backend: ${textoDeError(error)}`,
            mensajeUsuario: `No se pudo enviar el audio al backend (${this.config.url}). Comprueba que uvicorn esté activo y reintenta.`,
            reintentable: true,
          },
          error,
        );
      }
      if ([502, 503, 504].includes(respuesta.status) && intento < this.config.reintentosTemporales) {
        intento += 1;
        await esperar(this.config.backoffBaseMs * intento, senal);
        continue;
      }
      if (respuesta.status === 401 || respuesta.status === 403) {
        throw new ErrorAutorizacion({
          codigo: 'BACKEND_AUTORIZACION',
          mensaje: `El backend rechazó la petición con ${respuesta.status}.`,
          mensajeUsuario: 'El backend rechazó la petición por autorización. Revisa la configuración del backend.',
          reintentable: false,
        });
      }
      if (respuesta.status === 413) {
        throw new ErrorValidacion({
          codigo: 'BACKEND_ARCHIVO_GRANDE',
          mensaje: 'El archivo supera el tamaño máximo configurado en el backend.',
          mensajeUsuario: 'El audio es demasiado grande para el backend. Sube el límite en la configuración del backend o trabaja con un fragmento.',
          reintentable: false,
        });
      }
      if (respuesta.status === 429) {
        throw new ErrorTemporal({
          codigo: 'BACKEND_SATURADO',
          mensaje: 'El backend está aplicando límites de tasa (429).',
          mensajeUsuario: 'El backend está saturado (demasiadas peticiones). Espera unos segundos y reintenta.',
          reintentable: true,
        });
      }
      if (respuesta.status === 422 || respuesta.status === 409) {
        const problema = (await respuesta.json().catch(() => null)) as ProblemaBackend | null;
        throw this.traducirProblema(problema, respuesta.status);
      }
      if (!respuesta.ok) {
        throw new ErrorTemporal({
          codigo: 'BACKEND_ERROR_INESPERADO',
          mensaje: `El backend respondió ${respuesta.status} al crear el trabajo.`,
          mensajeUsuario: 'El backend respondió con un error inesperado. Reintenta o consulta su consola.',
          reintentable: true,
        });
      }
      const cuerpo = (await respuesta.json()) as { id?: string };
      if (!cuerpo?.id) {
        throw new ErrorTemporal({
          codigo: 'BACKEND_RESPUESTA_INVALIDA',
          mensaje: 'El backend no devolvió el id del trabajo.',
          mensajeUsuario: 'El backend respondió sin el identificador del trabajo. Reintenta.',
          reintentable: true,
        });
      }
      return cuerpo.id;
    }
  }

  /** Traduce un problema RFC 7807 (o nulo) al error tipado correspondiente. */
  private traducirProblema(problema: ProblemaBackend | null, estado?: number): Error {
    const codigo = problema?.codigo ?? 'BACKEND_ERROR';
    const detalle =
      problema?.detalle ??
      `El backend rechazó el trabajo${estado !== undefined ? ` (estado ${estado})` : ''}: ${problema?.titulo ?? 'sin detalle'}`;
    switch (problema?.categoria) {
      case 'autorizacion':
        return new ErrorAutorizacion({
          codigo,
          mensaje: detalle,
          mensajeUsuario: 'El backend rechazó la operación por autorización.',
          reintentable: false,
        });
      case 'configuracion':
        return new ErrorConfiguracion({
          codigo,
          mensaje: detalle,
          mensajeUsuario: problema.titulo ?? 'El backend tiene un problema de configuración. Revisa su consola.',
          reintentable: false,
        });
      case 'validacion':
        return new ErrorValidacion({
          codigo,
          mensaje: detalle,
          mensajeUsuario: problema.titulo ?? 'El backend rechazó los datos enviados.',
          reintentable: false,
        });
      case 'critico':
        return new ErrorTemporal({
          codigo,
          mensaje: detalle,
          mensajeUsuario: problema.titulo ?? 'El backend falló al procesar el audio. Reintenta.',
          reintentable: true,
        });
      default:
        return new ErrorTemporal({
          codigo,
          mensaje: detalle,
          mensajeUsuario: problema?.titulo ?? 'El backend falló al procesar el audio. Reintenta.',
          reintentable: true,
        });
    }
  }
}
