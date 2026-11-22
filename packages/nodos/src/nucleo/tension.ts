/**
 * Heurística de tensión narrativa (v1, sin LLM) — migración de la Fase 2 de
 * bardoStudio con la decisión de producto documentada: energía+ritmo+signos
 * en función pura; la variante LLM queda como nodo backend aparte si algún
 * día se decide (docs/pending/analisis-tension.md).
 *
 * Señales por ventana (todas normalizadas y combinadas):
 *  - densidad de palabras (palabras/minuto): más ritmo → más tensión;
 *  - proporción de pausa dentro de la ventana: menos aire → más tensión;
 *  - signos de exclimación/interrogación y mayúsculas: picos puntuales;
 *  - longitud media de palabra: vocabulario más denso → leve subida.
 */

import { aplanarPalabras } from './transcripcion';
import type { TranscripcionV1 } from './transcripcion';

export const TIPO_DATO_TENSION = 'tension/v1';

export interface PuntoTension {
  inicioMs: number;
  /** Tensión 0..100 (entera para ser legible y estable entre revisiones). */
  tension: number;
  /** Etiqueta orientativa del estado narrativo dominante. */
  animo?: string;
}

export interface TensionV1 {
  tipoDato: typeof TIPO_DATO_TENSION;
  puntos: PuntoTension[];
  /** La curva es corregible en el inspector (arrastrar puntos). */
  corregible: true;
  /** Motor que la calculó (transparencia). */
  motor: 'heuristica' | 'llm-backend';
  revision?: number;
}

export interface ParametrosTension {
  /** Tamaño de la ventana de análisis. */
  granularidadS: number;
}

function etiqueta(tension: number): string {
  if (tension >= 75) return 'clímax';
  if (tension >= 55) return 'alta';
  if (tension >= 35) return 'media';
  if (tension >= 18) return 'calma';
  return 'intro';
}

/**
 * Calcula la curva de tensión a partir de la transcripción. Función pura:
 * misma transcripción y granularidad → misma curva (testeable en Node).
 */
export function calcularCurvaTension(
  transcripcion: TranscripcionV1,
  parametros: ParametrosTension,
): TensionV1 {
  const granularidadMs = Math.max(5_000, parametros.granularidadS * 1_000);
  const duracionMs = Math.max(transcripcion.duracionMs, 1);
  const palabras = aplanarPalabras(transcripcion);

  const puntos: PuntoTension[] = [];
  for (let inicioMs = 0; inicioMs < duracionMs; inicioMs += granularidadMs) {
    const finMs = Math.min(inicioMs + granularidadMs, duracionMs);
    const enVentana = palabras.filter((p) => p.finMs > inicioMs && p.inicioMs < finMs);
    const ventanaMs = finMs - inicioMs;

    if (enVentana.length === 0) {
      // Silencio: la tensión decae hacia la calma.
      const previa = puntos[puntos.length - 1];
      const decaida = previa ? Math.max(10, Math.round(previa.tension * 0.6)) : 10;
      puntos.push({ inicioMs, tension: decaida, animo: etiqueta(decaida) });
      continue;
    }

    // 1) Densidad: palabras por minuto de VENTANA con voz (0..~250 ppm).
    const conVozMs = Math.min(
      ventanaMs,
      Math.max(1, enVentana[enVentana.length - 1]!.finMs - enVentana[0]!.inicioMs),
    );
    const ppm = (enVentana.length / conVozMs) * 60_000;
    const sDensidad = Math.min(1, ppm / 200); // 200 ppm ≈ narración muy rápida

    // 2) Aire: proporción de pausa dentro de la ventana (más pausa → menos tensión).
    const habladoMs = enVentana.reduce((total, p) => total + (p.finMs - p.inicioMs), 0);
    const pausa = Math.max(0, 1 - habladoMs / ventanaMs);
    const sAire = 1 - Math.min(1, pausa / 0.7); // 70 % de pausa ≈ relajado del todo

    // 3) Signos y énfasis en la ventana.
    const texto = enVentana.map((p) => p.palabra).join(' ');
    const exclamaciones = (texto.match(/[¡!]/g) ?? []).length;
    const interrogaciones = (texto.match(/[¿?]/g) ?? []).length;
    const enfasis = Math.min(1, (exclamaciones * 0.5 + interrogaciones * 0.35) / 2);
    const mayusculas = enVentana.filter((p) => /^[A-ZÁÉÍÓÚÑ]{3,}$/.test(p.palabra)).length;

    // 4) Vocabulario: longitud media de palabra (denso → leve subida).
    const longitudMedia = enVentana.reduce((t, p) => t + p.palabra.trim().length, 0) / enVentana.length;
    const sLexico = Math.min(1, Math.max(0, (longitudMedia - 3.5) / 4));

    const bruto =
      22 + // base de narración en calma
      sDensidad * 34 +
      sAire * 18 +
      enfasis * 16 +
      Math.min(6, mayusculas * 3) +
      sLexico * 8;

    const tension = Math.max(0, Math.min(100, Math.round(bruto)));
    puntos.push({ inicioMs, tension, animo: etiqueta(tension) });
  }

  // Suavizado: media móvil de 3 puntos para evitar dientes de sierra.
  const suavizados = puntos.map((punto, indice) => {
    if (indice === 0 || indice === puntos.length - 1) return punto;
    const ventana = [puntos[indice - 1]!, punto, puntos[indice + 1]!];
    const media = Math.round(ventana.reduce((t, p) => t + p.tension, 0) / 3);
    return { ...punto, tension: media, animo: etiqueta(media) };
  });

  return { tipoDato: TIPO_DATO_TENSION, puntos: suavizados, corregible: true, motor: 'heuristica' };
}

/** Valida un contenido como tension/v1 (para nodos consumidores). */
export function comoTension(contenido: unknown): TensionV1 | null {
  if (typeof contenido !== 'object' || contenido === null) return null;
  const candidato = contenido as Partial<TensionV1>;
  if (candidato.tipoDato !== TIPO_DATO_TENSION || !Array.isArray(candidato.puntos)) return null;
  for (const punto of candidato.puntos) {
    if (typeof punto?.inicioMs !== 'number' || typeof punto?.tension !== 'number') return null;
  }
  return contenido as TensionV1;
}
