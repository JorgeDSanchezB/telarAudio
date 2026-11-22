/**
 * Nodo "Fusión de audios": encadena en secuencia varias entradas de audio en
 * el orden configurado, con separación y fundidos opcionales. Reimplementa
 * para el DAG la funcionalidad de `fusionadorAudios` (rebanada vertical
 * end-to-end de este proyecto).
 */

import { ErrorConfiguracion, ErrorValidacion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';
import { planificarFusion } from '../nucleo/planificarFusion';
import { renderizarAActivo } from './util-render';

export function crearDefinicionFusion(): DefinicionNodo {
  return {
    tipo: 'fusion-audios',
    version: '1.0.0',
    etiqueta: 'Fusión de audios',
    descripcion:
      'Une en secuencia varios audios en el orden que elijas (ordena las conexiones en el inspector), con silencio de separación y fundidos opcionales. El resultado es un nuevo archivo en la biblioteca.',
    categoria: 'salida',
    runtime: 'cliente',
    entradas: [
      {
        clave: 'entradas',
        etiqueta: 'Audios a fusionar',
        tipo: 'audio',
        multiple: true,
        ordenado: true,
        requerida: true,
        descripcion: 'Conecta aquí las salidas de audio que quieres unir, en el orden deseado.',
      },
    ],
    salidas: [{ clave: 'salida', etiqueta: 'Audio fusionado', tipo: 'audio' }],
    parametros: [
      {
        tipo: 'numero',
        clave: 'separacionMs',
        etiqueta: 'Silencio entre audios',
        defecto: 0,
        min: 0,
        max: 10_000,
        paso: 50,
        unidad: 'ms',
        descripcion: 'Silencio que se inserta entre un audio y el siguiente.',
      },
      {
        tipo: 'numero',
        clave: 'fundidoMs',
        etiqueta: 'Fundido de entrada/salida',
        defecto: 0,
        min: 0,
        max: 2000,
        paso: 10,
        unidad: 'ms',
        descripcion: 'Fundido corto al principio y al final de cada audio para evitar chasquidos.',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'FUSION_SIN_ENTRADAS',
        categoria: 'validacion',
        descripcion: 'No hay ninguna conexión en el puerto de entradas.',
        reintentable: false,
      },
      {
        codigo: 'ACTIVO_NO_ENCONTRADO',
        categoria: 'configuracion',
        descripcion: 'Algún audio de entrada ya no está en la biblioteca.',
        reintentable: false,
      },
      {
        codigo: 'ACTIVO_SIN_DURACION',
        categoria: 'configuracion',
        descripcion: 'Algún audio de entrada no tiene duración analizada.',
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
        const valores = entrada.entradas.entradas ?? [];
        const ids = valores
          .filter((valor): valor is { tipo: 'audio'; idActivo: string } => valor.tipo === 'audio')
          .map((valor) => valor.idActivo);
        if (ids.length === 0) {
          throw new ErrorValidacion({
            codigo: 'FUSION_SIN_ENTRADAS',
            mensaje: 'El puerto de entradas está vacío.',
            mensajeUsuario: 'Conecta al menos un audio al nodo de fusión.',
            reintentable: false,
          });
        }

        contexto.reportarProgreso(0.02, 'Leyendo metadatos de las entradas…');
        const entradasFusion = ids.map((idActivo) => {
          const meta = contexto.servicios.activos.obtenerMeta(idActivo);
          if (!meta) {
            throw new ErrorConfiguracion({
              codigo: 'ACTIVO_NO_ENCONTRADO',
              mensaje: `El activo ${idActivo} no está en la biblioteca.`,
              mensajeUsuario: 'Uno de los audios de entrada ya no está en la biblioteca.',
              reintentable: false,
            });
          }
          if (meta.duracionMs === null || meta.duracionMs <= 0) {
            throw new ErrorConfiguracion({
              codigo: 'ACTIVO_SIN_DURACION',
              mensaje: `El activo ${idActivo} no tiene duración analizada.`,
              mensajeUsuario: `El audio "${meta.nombre}" no se ha terminado de analizar. Reinténtalo en unos segundos.`,
              reintentable: true,
            });
          }
          return { idActivo, duracionMs: meta.duracionMs };
        });

        const planNumerico = planificarFusion(entradasFusion, {
          separacionMs: entrada.parametros.separacionMs as number,
          fundidoMs: entrada.parametros.fundidoMs as number,
        });

        contexto.reportarProgreso(0.08, `Decodificando ${ids.length} audio(s)…`);
        const buffers = await Promise.all(
          ids.map((idActivo) => contexto.servicios.audio.decodificar(idActivo, contexto.senal)),
        );

        const elementos = planNumerico.elementos.map((elemento, indice) => ({
          buffer: buffers[indice]!,
          inicioMs: elemento.inicioMs,
          duracionMs: elemento.duracionMs,
          offsetMs: elemento.offsetMs,
          gananciaDb: elemento.gananciaDb,
          fundidoEntradaMs: elemento.fundidoEntradaMs,
          fundidoSalidaMs: elemento.fundidoSalidaMs,
        }));

        const resultado = await renderizarAActivo(
          { elementos, duracionTotalMs: planNumerico.duracionTotalMs },
          ids.length === 1 ? 'Fusión de 1 audio' : `Fusión de ${ids.length} audios`,
          contexto,
          0.15,
          1,
        );
        return { salidas: { salida: { tipo: 'audio', idActivo: resultado.idActivo } } };
      },
    }),
  };
}
