/**
 * Cálculo de pico en dBFS sobre canales Float32. Función pura usada por el
 * nodo de ganancia en modo "normalizar pico".
 */

import { ErrorValidacion } from '@telar/motor';

/**
 * Devuelve el pico (máximo absoluto) en dBFS.
 * Para silencio absoluto devuelve -Infinity: quien llama decide cómo
 * tratarlo (el nodo de ganancia lo reporta como error de validación).
 */
export function calcularPicoDbfs(canales: Float32Array[]): number {
  if (!Array.isArray(canales) || canales.length === 0) {
    throw new ErrorValidacion({
      codigo: 'PICOS_SIN_CANALES',
      mensaje: 'Se necesita al menos un canal para medir el pico.',
      mensajeUsuario: 'No hay audio que medir.',
      reintentable: false,
    });
  }
  let pico = 0;
  for (const canal of canales) {
    if (!(canal instanceof Float32Array)) {
      throw new ErrorValidacion({
        codigo: 'PICOS_CANAL_INVALIDO',
        mensaje: 'Cada canal debe ser un Float32Array.',
        mensajeUsuario: 'El audio a medir tiene un formato inesperado.',
        reintentable: false,
      });
    }
    for (let i = 0; i < canal.length; i += 1) {
      const absoluto = Math.abs(canal[i]!);
      if (absoluto > pico) {
        pico = absoluto;
      }
    }
  }
  if (pico === 0) {
    return -Infinity;
  }
  return 20 * Math.log10(pico);
}
