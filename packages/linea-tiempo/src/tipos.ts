/**
 * Tipos del dominio de línea de tiempo.
 *
 * Decisión (ADR-003): reutilizamos los tipos de datos de
 * `@waveform-playlist` (ClipTrack/AudioClip) como modelo de la aplicación en
 * lugar de mantener un modelo paralelo propio: evita una sincronización
 * bidireccional propensa a bugs y mantiene una única fuente de verdad. Este
 * paquete añade, alrededor de esos tipos, las operaciones puras validadas y
 * el historial de undo/redo que la librería no ofrece de forma documentada.
 *
 * Unidad de tiempo: MUESTRAS a la tasa global de la línea de tiempo
 * (la app fija 48 kHz; ver ADR-011). Las conversiones a ms viven aquí.
 */

import type { AudioClip, ClipTrack } from '@waveform-playlist/browser';

/** Papel semántico de una pista (heredado del nodo que la generó). */
export type TipoPista = 'voz' | 'musica' | 'efectos' | 'salida';

/**
 * Pista de Telar: un ClipTrack de la librería más el papel semántico.
 * La librería ignora el campo extra (tipado estructural).
 */
export interface PistaTelar extends ClipTrack {
  tipoPista: TipoPista;
}

export type { AudioClip, ClipTrack };

export function dbALineal(db: number): number {
  return Math.pow(10, db / 20);
}

export function linealADb(lineal: number): number {
  if (lineal <= 0) {
    return -Infinity;
  }
  return 20 * Math.log10(lineal);
}

export function msAMuestras(ms: number, tasaMuestreo: number): number {
  return Math.round((ms / 1000) * tasaMuestreo);
}

export function muestrasAMs(muestras: number, tasaMuestreo: number): number {
  return (muestras / tasaMuestreo) * 1000;
}
