import { describe, expect, it } from 'vitest';
import { calcularTamañoRiff, codificarWav } from '@telar/nodos';
import { ErrorValidacion } from '@telar/motor';

function leerTexto(bytes: Uint8Array, offset: number, longitud: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + longitud));
}

function leerUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function leerUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  );
}

describe('codificarWav', () => {
  it('escribe una cabecera RIFF/WAVE PCM correcta', () => {
    const muestras = new Float32Array([0, 0.5, -0.5, 1]);
    const bytes = codificarWav([muestras], 48_000);
    expect(bytes.length).toBe(calcularTamañoRiff(4, 1));
    expect(leerTexto(bytes, 0, 4)).toBe('RIFF');
    expect(leerUint32(bytes, 4)).toBe(bytes.length - 8);
    expect(leerTexto(bytes, 8, 4)).toBe('WAVE');
    expect(leerTexto(bytes, 12, 4)).toBe('fmt ');
    expect(leerUint32(bytes, 16)).toBe(16);
    expect(leerUint16(bytes, 20)).toBe(1); // PCM
    expect(leerUint16(bytes, 22)).toBe(1); // mono
    expect(leerUint32(bytes, 24)).toBe(48_000);
    expect(leerUint32(bytes, 28)).toBe(48_000 * 2); // bytes por segundo
    expect(leerUint16(bytes, 32)).toBe(2); // alineación de bloque
    expect(leerUint16(bytes, 34)).toBe(16); // bits
    expect(leerTexto(bytes, 36, 4)).toBe('data');
    expect(leerUint32(bytes, 40)).toBe(bytes.length - 44);
  });

  it('cuantiza y recorta al rango de 16 bits', () => {
    const muestras = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
    const bytes = codificarWav([muestras], 8000);
    const leerMuestra = (i: number): number => leerUint16(bytes, 44 + i * 2) << 16 >> 16;
    expect(leerMuestra(0)).toBe(0);
    expect(leerMuestra(1)).toBe(16384);
    // JS redondea .5 hacia +Infinity: -0.5*32767 = -16383.5 -> -16383.
    expect(leerMuestra(2)).toBe(-16383);
    expect(leerMuestra(3)).toBe(32767);
    expect(leerMuestra(4)).toBe(-32767);
    expect(leerMuestra(5)).toBe(32767); // recortado por arriba
    expect(leerMuestra(6)).toBe(-32767); // recortado por abajo
  });

  it('intercala los canales estéreo muestra a muestra', () => {
    const izq = new Float32Array([1, 0]);
    const der = new Float32Array([0, 1]);
    const bytes = codificarWav([izq, der], 44_100);
    expect(leerUint16(bytes, 22)).toBe(2);
    // Muestra 0: primero canal izquierdo (32767), luego derecho (0).
    const leerEn = (offset: number): number => leerUint16(bytes, 44 + offset * 2);
    expect(leerEn(0)).toBe(32767);
    expect(leerEn(1)).toBe(0);
    expect(leerEn(2)).toBe(0);
    expect(leerEn(3)).toBe(32767);
  });

  it('rechaza canales inconsistentes y tasas inválidas', () => {
    expect(() => codificarWav([], 44_100)).toThrowError(ErrorValidacion);
    expect(() => codificarWav([new Float32Array(4)], 1000)).toThrowError(/tasa/i);
    expect(() =>
      codificarWav([new Float32Array(4), new Float32Array(2)], 44_100),
    ).toThrowError(/inconsistentes/i);
  });
});
