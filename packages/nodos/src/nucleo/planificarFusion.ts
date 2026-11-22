/**
 * Planificador de fusión: coloca una lista de audios en secuencia, en el
 * orden recibido, aplicando la separación y los fundidos configurados.
 *
 * Función PURA (sin E/S): toda la aritmética de la fusión vive aquí y se
 * prueba en Node; el procesador del nodo solo orquesta servicios.
 */

import { ErrorValidacion } from '@telar/motor';

export interface EntradaFusion {
  idActivo: string;
  duracionMs: number;
}

export interface ParametrosFusion {
  separacionMs: number;
  fundidoMs: number;
}

export interface ElementoPlanFusion {
  idActivo: string;
  inicioMs: number;
  duracionMs: number;
  offsetMs: number;
  gananciaDb: number;
  fundidoEntradaMs: number;
  fundidoSalidaMs: number;
}

export interface PlanFusion {
  elementos: ElementoPlanFusion[];
  duracionTotalMs: number;
}

/** Límite defensivo: evita fundidos mayores que la mitad del clip. */
function fundidoEfectivo(fundidoMs: number, duracionMs: number): number {
  return Math.min(fundidoMs, Math.floor(duracionMs / 2));
}

export function planificarFusion(entradas: EntradaFusion[], parametros: ParametrosFusion): PlanFusion {
  if (!Array.isArray(entradas) || entradas.length === 0) {
    throw new ErrorValidacion({
      codigo: 'FUSION_SIN_ENTRADAS',
      mensaje: 'La fusión necesita al menos un audio de entrada.',
      mensajeUsuario: 'Conecta al menos un audio al nodo de fusión.',
      reintentable: false,
    });
  }
  if (
    !Number.isFinite(parametros.separacionMs) ||
    parametros.separacionMs < 0 ||
    !Number.isFinite(parametros.fundidoMs) ||
    parametros.fundidoMs < 0
  ) {
    throw new ErrorValidacion({
      codigo: 'FUSION_PARAMETROS_INVALIDOS',
      mensaje: `separacionMs y fundidoMs deben ser números >= 0 (recibido: ${parametros.separacionMs}, ${parametros.fundidoMs}).`,
      mensajeUsuario: 'La separación y el fundido de la fusión deben ser valores positivos.',
      reintentable: false,
    });
  }
  const elementos: ElementoPlanFusion[] = [];
  let cursor = 0;
  for (const [indice, entrada] of entradas.entries()) {
    if (!entrada || typeof entrada.idActivo !== 'string' || entrada.idActivo.length === 0) {
      throw new ErrorValidacion({
        codigo: 'FUSION_ENTRADA_INVALIDA',
        mensaje: `La entrada ${indice} no tiene idActivo válido.`,
        mensajeUsuario: 'Una de las entradas de la fusión no es válida.',
        reintentable: false,
      });
    }
    if (!Number.isFinite(entrada.duracionMs) || entrada.duracionMs <= 0) {
      throw new ErrorValidacion({
        codigo: 'FUSION_DURACION_INVALIDA',
        mensaje: `El activo ${entrada.idActivo} no tiene duración conocida (duracionMs=${String(entrada.duracionMs)}).`,
        mensajeUsuario: 'Uno de los audios a fusionar aún no se ha analizado. Vuelve a subirlo o espera a que termine su análisis.',
        reintentable: false,
      });
    }
    const duracion = Math.round(entrada.duracionMs);
    elementos.push({
      idActivo: entrada.idActivo,
      inicioMs: cursor,
      duracionMs: duracion,
      offsetMs: 0,
      gananciaDb: 0,
      fundidoEntradaMs: fundidoEfectivo(parametros.fundidoMs, duracion),
      fundidoSalidaMs: fundidoEfectivo(parametros.fundidoMs, duracion),
    });
    cursor += duracion + Math.round(parametros.separacionMs);
  }
  // La separación final no forma parte del audio resultante.
  const duracionTotalMs = Math.max(0, cursor - Math.round(parametros.separacionMs));
  return { elementos, duracionTotalMs };
}
