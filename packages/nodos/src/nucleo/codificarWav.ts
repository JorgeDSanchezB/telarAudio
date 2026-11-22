/**
 * Codificador WAV (PCM de 16 bits) puro: Float32 por canal -> bytes RIFF/WAVE.
 *
 * Reutiliza el enfoque de exportación de `fusionadorAudios` (audio PCM en el
 * navegador, sin dependencias) pero sin pasar por ffmpeg.wasm para el caso
 * más común (WAV), que es un contenedor trivial. ffmpeg.wasm queda para el
 * MP3 (ver @telar/app, servicio de exportación).
 */

import { ErrorValidacion } from '@telar/motor';

const TASA_MINIMA = 8000;
const TASA_MAXIMA = 384000;
const CANALES_MAXIMOS = 8;
const BYTES_POR_MUESTRA = 2;

/** Tamaño total del archivo RIFF para n muestras por canal. */
export function calcularTamañoRiff(muestrasPorCanal: number, canales: number): number {
  const datos = muestrasPorCanal * canales * BYTES_POR_MUESTRA;
  return 44 + datos;
}

function escribirUint32(destino: Uint8Array, offset: number, valor: number): void {
  destino[offset] = valor & 0xff;
  destino[offset + 1] = (valor >> 8) & 0xff;
  destino[offset + 2] = (valor >> 16) & 0xff;
  destino[offset + 3] = (valor >> 24) & 0xff;
}

function escribirUint16(destino: Uint8Array, offset: number, valor: number): void {
  destino[offset] = valor & 0xff;
  destino[offset + 1] = (valor >> 8) & 0xff;
}

function escribirTexto(destino: Uint8Array, offset: number, texto: string): void {
  for (let i = 0; i < texto.length; i += 1) {
    destino[offset + i] = texto.charCodeAt(i);
  }
}

/**
 * Codifica canales Float32 (rango nominal [-1, 1], se recortan a ese rango)
 * como WAV PCM 16 bits little-endian.
 */
export function codificarWav(canales: Float32Array[], tasaMuestreo: number): Uint8Array {
  if (!Array.isArray(canales) || canales.length === 0 || canales.length > CANALES_MAXIMOS) {
    throw new ErrorValidacion({
      codigo: 'WAV_CANALES_INVALIDOS',
      mensaje: `Se necesita entre 1 y ${CANALES_MAXIMOS} canales (recibido: ${canales?.length}).`,
      mensajeUsuario: 'El audio a exportar tiene un número de canales no soportado.',
      reintentable: false,
    });
  }
  if (!Number.isInteger(tasaMuestreo) || tasaMuestreo < TASA_MINIMA || tasaMuestreo > TASA_MAXIMA) {
    throw new ErrorValidacion({
      codigo: 'WAV_TASA_INVALIDA',
      mensaje: `La tasa de muestreo debe estar entre ${TASA_MINIMA} y ${TASA_MAXIMA} Hz (recibida: ${String(tasaMuestreo)}).`,
      mensajeUsuario: 'La tasa de muestreo del audio no es soportada por el exportador WAV.',
      reintentable: false,
    });
  }
  const muestras = canales[0]!.length;
  for (const [indice, canal] of canales.entries()) {
    if (!(canal instanceof Float32Array) || canal.length !== muestras) {
      throw new ErrorValidacion({
        codigo: 'WAV_CANALES_INCONSISTENTES',
        mensaje: `El canal ${indice} no es Float32Array o no tiene ${muestras} muestras.`,
        mensajeUsuario: 'Los canales del audio a exportar son inconsistentes.',
        reintentable: false,
      });
    }
  }
  const tamañoArchivo = calcularTamañoRiff(muestras, canales.length);
  if (tamañoArchivo > 0xffffffff) {
    throw new ErrorValidacion({
      codigo: 'WAV_DEMASIADO_GRANDE',
      mensaje: `El WAV resultante (${tamañoArchivo} bytes) excede el límite RIFF de 4 GiB.`,
      mensajeUsuario: 'El audio es demasiado largo para exportarlo como WAV en una sola pieza (límite 4 GiB).',
      reintentable: false,
    });
  }

  const salida = new Uint8Array(tamañoArchivo);
  escribirTexto(salida, 0, 'RIFF');
  escribirUint32(salida, 4, tamañoArchivo - 8);
  escribirTexto(salida, 8, 'WAVE');
  escribirTexto(salida, 12, 'fmt ');
  escribirUint32(salida, 16, 16); // tamaño del bloque fmt
  escribirUint16(salida, 20, 1); // PCM
  escribirUint16(salida, 22, canales.length);
  escribirUint32(salida, 24, tasaMuestreo);
  escribirUint32(salida, 28, tasaMuestreo * canales.length * BYTES_POR_MUESTRA); // bytes/seg
  escribirUint16(salida, 32, canales.length * BYTES_POR_MUESTRA); // alineación de bloque
  escribirUint16(salida, 34, 16); // bits por muestra
  escribirTexto(salida, 36, 'data');
  escribirUint32(salida, 40, tamañoArchivo - 44);

  let offset = 44;
  for (let muestra = 0; muestra < muestras; muestra += 1) {
    for (const canal of canales) {
      const bruto = canal[muestra]!;
      const recortado = bruto > 1 ? 1 : bruto < -1 ? -1 : bruto;
      const entero = Math.round(recortado * 32767);
      const enteroSeguro = entero > 32767 ? 32767 : entero < -32768 ? -32768 : entero;
      salida[offset] = enteroSeguro & 0xff;
      salida[offset + 1] = (enteroSeguro >> 8) & 0xff;
      offset += 2;
    }
  }
  return salida;
}
