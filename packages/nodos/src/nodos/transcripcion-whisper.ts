/**
 * Nodo "Transcripción Whisper" — runtime backend, capacidad
 * "transcripcion". Migra el núcleo de eliminaMuletillas (Whisper con
 * word_timestamps) al DAG: emite un dato transcripcion/v1 que alimentan los
 * nodos de muletillas, tensión y SFX.
 */

import { ErrorConfiguracion, ErrorValidacion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';
import { comoTranscripcion, TIPO_DATO_TRANSCRIPCION } from '../nucleo/transcripcion';

export const CAPACIDAD_TRANSCRIPCION = 'transcripcion';

export interface OpcionesNodoTranscripcion {
  /** Modelo por defecto (configuración de la app, cero hardcoding). */
  modeloDefecto: string;
}

export function crearDefinicionTranscripcion(
  opciones: OpcionesNodoTranscripcion = { modeloDefecto: 'small' },
): DefinicionNodo {
  return {
    tipo: 'transcripcion-whisper',
    version: '1.0.0',
    etiqueta: 'Transcripción Whisper',
    descripcion:
      'Transcribe la voz con Whisper en el backend local, con marcas de tiempo por palabra (word timestamps). ' +
      'El resultado es un dato que alimenta los nodos de muletillas, tensión y efectos; se puede revisar en el inspector.',
    categoria: 'enriquecimiento',
    runtime: 'backend',
    capacidadBackend: CAPACIDAD_TRANSCRIPCION,
    entradas: [{ clave: 'entrada', etiqueta: 'Audio', tipo: 'audio', requerida: true }],
    salidas: [
      {
        clave: 'transcripcion',
        etiqueta: 'Transcripción',
        tipo: 'dato',
        tipoDato: TIPO_DATO_TRANSCRIPCION,
        descripcion: 'Segmentos y palabras con marcas de tiempo (transcripcion/v1).',
      },
    ],
    parametros: [
      {
        tipo: 'opcion',
        clave: 'modelo',
        etiqueta: 'Modelo',
        defecto: opciones.modeloDefecto,
        opciones: [
          { valor: 'tiny', etiqueta: 'tiny — rápido, calidad básica (~75 MB)' },
          { valor: 'base', etiqueta: 'base — equilibrio (~145 MB)' },
          { valor: 'small', etiqueta: 'small — mejor calidad, más lento (~484 MB)' },
        ],
        descripcion:
          'Modelo Whisper descargado en el backend (backend/modelos/whisper-<modelo>). Si falta, el nodo explica cómo conseguirlo.',
      },
      {
        tipo: 'opcion',
        clave: 'idioma',
        etiqueta: 'Idioma',
        defecto: 'es',
        opciones: [
          { valor: 'es', etiqueta: 'Español' },
          { valor: 'en', etiqueta: 'Inglés' },
          { valor: 'fr', etiqueta: 'Francés' },
          { valor: 'de', etiqueta: 'Alemán' },
          { valor: 'it', etiqueta: 'Italiano' },
          { valor: 'pt', etiqueta: 'Portugués' },
        ],
        descripcion: 'Idioma de la narración (forzarlo acelera y estabiliza la transcripción).',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'BACKEND_NO_CONFIGURADO',
        categoria: 'configuracion',
        descripcion: 'La sesión se inició sin cliente de backend.',
        reintentable: false,
      },
      {
        codigo: 'BACKEND_NO_DISPONIBLE',
        categoria: 'configuracion',
        descripcion: 'El backend local no está arrancado o no responde.',
        reintentable: false,
      },
      {
        codigo: 'CAPACIDAD_NO_DISPONIBLE',
        categoria: 'configuracion',
        descripcion: 'El backend está arriba pero no ofrece la capacidad transcripcion.',
        reintentable: false,
      },
      {
        codigo: 'MODELO_NO_DESCARGADO',
        categoria: 'configuracion',
        descripcion: 'El modelo elegido no está descargado en el backend (ver README).',
        reintentable: false,
      },
      {
        codigo: 'WHISPER_NO_INSTALADO',
        categoria: 'configuracion',
        descripcion: 'El backend no tiene la dependencia faster-whisper.',
        reintentable: false,
      },
      {
        codigo: 'AUDIO_SIN_VOZ',
        categoria: 'validacion',
        descripcion: 'El audio no contiene voz detectable (solo silencio o ruido).',
        reintentable: false,
      },
      {
        codigo: 'AUDIO_ILEGIBLE',
        categoria: 'validacion',
        descripcion: 'El archivo de audio no se pudo decodificar en el backend.',
        reintentable: false,
      },
      {
        codigo: 'TRANSCRIPCION_SIN_ENTRADA',
        categoria: 'configuracion',
        descripcion: 'No hay audio conectado a la entrada.',
        reintentable: false,
      },
      {
        codigo: 'ERROR_TEMPORAL_BACKEND',
        categoria: 'temporal',
        descripcion: 'El backend falló de forma transitoria. Reintentable.',
        reintentable: true,
      },
    ],
    crearProcesador: () => ({
      ejecutar: async (entrada, contexto) => {
        const backend = contexto.servicios.backend;
        if (!backend) {
          throw new ErrorConfiguracion({
            codigo: 'BACKEND_NO_CONFIGURADO',
            mensaje: 'No hay cliente de backend en esta sesión.',
            mensajeUsuario:
              'La transcripción se ejecuta en el backend Python local. Arráncalo con: cd backend && uvicorn app.main:app --port 8000 (pasos en el README).',
            reintentable: false,
          });
        }
        const datos = contexto.servicios.datos;
        if (!datos) {
          throw new ErrorConfiguracion({
            codigo: 'ALMACEN_DATOS_NO_CONFIGURADO',
            mensaje: 'No hay almacén de datos en la sesión.',
            mensajeUsuario: 'La sesión no puede registrar transcripciones. Reinicia la aplicación.',
            reintentable: false,
          });
        }

        contexto.reportarProgreso(0.02, 'Comprobando el backend local…');
        const capacidad = await backend.verificar();
        if (!capacidad.disponible) {
          throw new ErrorConfiguracion({
            codigo: 'BACKEND_NO_DISPONIBLE',
            mensaje: `El backend no está disponible: ${capacidad.detalle ?? 'sin detalle'}`,
            mensajeUsuario:
              'El backend local no responde. Arranca el servidor con "uvicorn app.main:app --port 8000" desde la carpeta backend/ y vuelve a ejecutar.',
            reintentable: false,
          });
        }
        if (!(capacidad.capacidades ?? []).includes(CAPACIDAD_TRANSCRIPCION)) {
          throw new ErrorConfiguracion({
            codigo: 'CAPACIDAD_NO_DISPONIBLE',
            mensaje: `El backend no ofrece la capacidad ${CAPACIDAD_TRANSCRIPCION}.`,
            mensajeUsuario:
              'El backend está activo pero es una versión sin transcripción. Actualiza el backend a la versión de este repositorio.',
            reintentable: false,
          });
        }

        const valorEntrada = entrada.entradas.entrada?.[0];
        if (!valorEntrada || valorEntrada.tipo !== 'audio') {
          throw new ErrorConfiguracion({
            codigo: 'TRANSCRIPCION_SIN_ENTRADA',
            mensaje: 'El nodo de transcripción necesita una entrada de audio.',
            mensajeUsuario: 'Conecta un audio con voz a la entrada del nodo de transcripción.',
            reintentable: false,
          });
        }

        contexto.registrar(
          `Transcribiendo con Whisper (${String(entrada.parametros.modelo)}, idioma ${String(
            entrada.parametros.idioma,
          )}) en el BACKEND local: el audio nunca sale de la máquina.`,
        );
        const contenido = await backend.ejecutarNodoDato({
          capacidad: CAPACIDAD_TRANSCRIPCION,
          idActivoEntrada: valorEntrada.idActivo,
          parametrosNodo: {
            modelo: entrada.parametros.modelo,
            idioma: entrada.parametros.idioma,
          },
          onProgreso: (fraccion, mensaje) => {
            contexto.reportarProgreso(0.05 + fraccion * 0.9, mensaje);
          },
          senal: contexto.senal,
        });

        const transcripcion = comoTranscripcion(contenido);
        if (!transcripcion) {
          throw new ErrorValidacion({
            codigo: 'TRANSCRIPCION_INVALIDA',
            mensaje: 'El backend devolvió una transcripción con formato inesperado.',
            mensajeUsuario: 'La transcripción llegó mal formada. Reintenta el nodo y repórtalo si persiste.',
            reintentable: true,
          });
        }

        const stats = transcripcion.estadisticas;
        contexto.reportarProgreso(1, 'Transcripción lista');
        contexto.registrar(
          `Transcripción lista: ${stats?.palabras ?? '?'} palabra(s) en ${stats?.segmentos ?? '?'} segmento(s)` +
            `${stats?.segundosProceso !== undefined ? ` (${stats.segundosProceso} s de proceso)` : ''}.`,
        );
        const dato = await datos.registrar(TIPO_DATO_TRANSCRIPCION, transcripcion);
        return {
          salidas: { transcripcion: { tipo: 'dato', idDato: dato.idDato, tipoDato: TIPO_DATO_TRANSCRIPCION } },
        };
      },
    }),
  };
}
