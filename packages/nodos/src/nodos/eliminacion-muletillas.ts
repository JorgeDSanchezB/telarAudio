/**
 * Nodo "Eliminar muletillas" — migra el corazón de eliminaMuletillas al DAG:
 * corta las muletillas del catálogo (configuración de la app, ampliable),
 * cierra los huecos y aplica crossfades. El audio original nunca se toca.
 */

import { ErrorConfiguracion, ErrorValidacion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';
import { comoTranscripcion, TIPO_DATO_TRANSCRIPCION } from '../nucleo/transcripcion';
import { planSinMuletillas } from '../nucleo/muletillas';
import type { ParametrosMuletillas } from '../nucleo/muletillas';
import { renderizarAActivo } from './util-render';
import { resolverDato } from './usoDatos';

/** Catálogo por defecto (config.default.json lo amplia/elige; cero hardcoding). */
export const MULETILLAS_DEFECTO = [
  'eh', 'e', 'em', 'emm', 'ehm', 'mmm', 'mm', 'm', 'este', 'esto', 'pues',
  'o sea', 'digamos', 'tipo', 'vale', 'bueno', '¿no?', 'no?', 'verdad',
  '¿vale?', 'cachai', 'okey', 'ok', 'ehh',
];

export function crearDefinicionMuletillas(): DefinicionNodo {
  return {
    tipo: 'eliminacion-muletillas',
    version: '1.0.0',
    etiqueta: 'Eliminar muletillas',
    descripcion:
      'Quita muletillas de la narración ("eh", "mmm", "o sea"…) usando la transcripción: corta cada muletilla, ' +
      'cierra el hueco desplazando el audio posterior y aplica un crossfade en cada unión. ' +
      'El catálogo de muletillas vive en la configuración (catalogos.muletillas) y se puede revisar en el inspector.',
    categoria: 'limpieza',
    runtime: 'cliente',
    entradas: [
      { clave: 'audio', etiqueta: 'Audio', tipo: 'audio', requerida: true },
      {
        clave: 'transcripcion',
        etiqueta: 'Transcripción',
        tipo: 'dato',
        tipoDato: TIPO_DATO_TRANSCRIPCION,
        requerida: true,
        descripcion: 'La transcripción del MISMO audio (nodo Transcripción).',
      },
    ],
    salidas: [{ clave: 'salida', etiqueta: 'Audio sin muletillas', tipo: 'audio' }],
    parametros: [
      {
        tipo: 'numero',
        clave: 'pausaMinimaMs',
        etiqueta: 'Pausa mínima',
        defecto: 250,
        min: 50,
        max: 2000,
        paso: 25,
        unidad: 'ms',
        descripcion: 'En modo seguro, la muletilla debe estar rodeada de pausas de al menos esto.',
      },
      {
        tipo: 'numero',
        clave: 'fundidoMs',
        etiqueta: 'Crossfade',
        defecto: 25,
        min: 0,
        max: 200,
        paso: 5,
        unidad: 'ms',
        descripcion: 'Fundido en cada unión tras cerrar el hueco (el original usaba 25 ms).',
      },
      {
        tipo: 'opcion',
        clave: 'modo',
        etiqueta: 'Modo',
        defecto: 'solo_pausas',
        opciones: [
          { valor: 'solo_pausas', etiqueta: 'Solo en pausas (seguro)' },
          { valor: 'siempre', etiqueta: 'También en voz seguida (más agresivo)' },
        ],
        descripcion: 'El modo seguro evita cortar muletillas pegadas a palabras importantes.',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'DATO_INCOMPATIBLE',
        categoria: 'validacion',
        descripcion: 'La entrada de transcripción no es un dato transcripcion/v1.',
        reintentable: false,
      },
      {
        codigo: 'MULETILLAS_SIN_AUDIO',
        categoria: 'configuracion',
        descripcion: 'No hay audio conectado a la entrada de audio.',
        reintentable: false,
      },
      {
        codigo: 'MULETILLAS_CATALOGO_VACIO',
        categoria: 'configuracion',
        descripcion: 'El catálogo de muletillas de la configuración está vacío.',
        reintentable: false,
      },
      {
        codigo: 'ACTIVO_SIN_DURACION',
        categoria: 'configuracion',
        descripcion: 'El audio de entrada no tiene duración analizada.',
        reintentable: true,
      },
      {
        codigo: 'NODO_TIMEOUT',
        categoria: 'temporal',
        descripcion: 'La mezcla superó el tiempo máximo de ejecución.',
        reintentable: true,
      },
    ],
    crearProcesador: () => ({
      ejecutar: async (entrada, contexto) => {
        const valorAudio = entrada.entradas.audio?.[0];
        if (!valorAudio || valorAudio.tipo !== 'audio') {
          throw new ErrorConfiguracion({
            codigo: 'MULETILLAS_SIN_AUDIO',
            mensaje: 'El nodo necesita audio en la entrada "audio".',
            mensajeUsuario: 'Conecta el audio con muletillas a la entrada de audio del nodo.',
            reintentable: false,
          });
        }

        // Catálogo desde la configuración validada de la app.
        const configuracion = contexto.servicios.configuracion;
        const catalogo = configuracion?.leer<string[]>('catalogos.muletillas') ?? MULETILLAS_DEFECTO;
        if (!Array.isArray(catalogo) || catalogo.length === 0) {
          throw new ErrorConfiguracion({
            codigo: 'MULETILLAS_CATALOGO_VACIO',
            mensaje: 'catalogos.muletillas está vacío en la configuración.',
            mensajeUsuario:
              'El catálogo de muletillas está vacío. Añade términos en la configuración (catalogos.muletillas).',
            reintentable: false,
          });
        }

        const dato = resolverDato(
          contexto,
          entrada.entradas.transcripcion ?? [],
          TIPO_DATO_TRANSCRIPCION,
          'Eliminar muletillas',
        );
        const transcripcion = comoTranscripcion(dato.contenido);
        if (!transcripcion) {
          throw new ErrorValidacion({
            codigo: 'DATO_INCOMPATIBLE',
            mensaje: 'El dato de transcripción tiene formato inválido.',
            mensajeUsuario: 'La transcripción llegó mal formada. Vuelve a ejecutar el nodo de transcripción.',
            reintentable: false,
          });
        }

        const parametros: ParametrosMuletillas = {
          pausaMinimaMs: entrada.parametros.pausaMinimaMs as number,
          fundidoMs: entrada.parametros.fundidoMs as number,
          modo: entrada.parametros.modo === 'siempre' ? 'siempre' : 'solo_pausas',
        };
        const plan = planSinMuletillas(transcripcion, catalogo, parametros);
        contexto.registrar(
          `Muletillas: ${plan.detecciones.length} detección(es), ${plan.msEliminados} ms a eliminar` +
            `${transcripcion.revision ? ` (revisión ${transcripcion.revision.excluirMuletillas.length} exclusion(es))` : ''}.`,
        );

        if (plan.detecciones.length === 0) {
          // Nada que cortar: la salida ES la entrada (cero trabajo, auditable).
          contexto.reportarProgreso(1, 'Sin muletillas que eliminar');
          return { salidas: { salida: { tipo: 'audio', idActivo: valorAudio.idActivo } } };
        }

        contexto.reportarProgreso(0.1, 'Decodificando el audio…');
        const buffer = await contexto.servicios.audio.decodificar(valorAudio.idActivo, contexto.senal);

        const elementos = plan.tramos.map((tramo) => ({
          buffer,
          inicioMs: tramo.inicioResultadoMs,
          duracionMs: tramo.duracionMs,
          offsetMs: tramo.offsetMs,
          gananciaDb: 0,
          fundidoEntradaMs: tramo.fundidoEntradaMs,
          fundidoSalidaMs: tramo.fundidoSalidaMs,
        }));

        const resultado = await renderizarAActivo(
          { elementos, duracionTotalMs: plan.duracionResultadoMs },
          'Narración sin muletillas.wav',
          contexto,
          0.2,
          1,
        );
        return { salidas: { salida: { tipo: 'audio', idActivo: resultado.idActivo } } };
      },
    }),
  };
}
