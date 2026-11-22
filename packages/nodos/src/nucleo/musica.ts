/**
 * Lógica pura de música de fondo por tensión + ducking (migración de las
 * Fases 3–4 de bardoStudio): la pista se repite cubriendo la duración de la
 * voz, su ganancia sigue los bloques de la curva de tensión y baja donde hay
 * voz (ducking). Todo como elementos de mezcla del plan estándar.
 */

import { comoTension } from './tension';
import type { TensionV1 } from './tension';

export interface ParametrosMusica {
  gananciaMusicaDb: number;
  /** Bajar la música bajo la voz. */
  ducking: boolean;
  /** Cuánto se baja la música con voz (dB, negativo). */
  gananciaDuckingDb: number;
  /** Crossfade entre bloques de tensión y en los bordes de ducking. */
  fundidoMs: number;
}

/** Un tramo de música con ganancia constante (los cambios de ganancia cortan). */
export interface TramoMusica {
  /** Posición en la mezcla final. */
  inicioMs: number;
  duracionMs: number;
  /** Offset dentro de la pista original (loop). */
  offsetMs: number;
  gananciaDb: number;
  fundidoEntradaMs: number;
  fundidoSalidaMs: number;
}

/** Extra de ganancia por punto de tensión (0..100 → dB). */
function extraPorTension(tension: number, rangoDb: number): number {
  return (tension / 100) * rangoDb;
}

/**
 * Divide [0, duracionVozMs] en tramos con ganancia constante: bordes de
 * bloque de tensión, bordes de ventana de voz (ducking) y vueltas de loop de
 * la pista. La pista hace loop desde el principio cuando se agota.
 */
export function planMusica(
  curva: TensionV1,
  duracionVozMs: number,
  duracionPistaMs: number,
  parametros: ParametrosMusica,
  /** Ventanas con voz [desdeMs, hastaMs] (para ducking), en orden. */
  ventanasVoz: Array<{ desdeMs: number; hastaMs: number }> = [],
): { tramos: TramoMusica[]; duracionTotalMs: number } {
  if (duracionVozMs <= 0 || duracionPistaMs <= 0) {
    return { tramos: [], duracionTotalMs: 0 };
  }

  // 1) Ganancia objetivo por instante: bloques de tensión interpolados.
  const puntos = [...curva.puntos].sort((a, b) => a.inicioMs - b.inicioMs);
  const gananciaEn = (ms: number): number => {
    let tension = puntos.length > 0 ? puntos[0]!.tension : 40;
    for (const punto of puntos) {
      if (punto.inicioMs <= ms) tension = punto.tension;
      else break;
    }
    return parametros.gananciaMusicaDb + extraPorTension(tension, 6);
  };
  const duckEn = (ms: number): boolean => {
    if (!parametros.ducking) return false;
    return ventanasVoz.some((v) => ms >= v.desdeMs && ms < v.hastaMs);
  };

  // 2) Puntos de corte: bordes de bloque, bordes de voz, vueltas de loop.
  const cortes = new Set<number>([0, duracionVozMs]);
  for (const punto of puntos) {
    if (punto.inicioMs > 0 && punto.inicioMs < duracionVozMs) cortes.add(punto.inicioMs);
  }
  for (const ventana of ventanasVoz) {
    const desde = Math.max(0, ventana.desdeMs - parametros.fundidoMs);
    const hasta = Math.min(duracionVozMs, ventana.hastaMs + parametros.fundidoMs);
    if (desde > 0) cortes.add(desde);
    if (hasta < duracionVozMs) cortes.add(hasta);
  }
  for (let ms = duracionPistaMs; ms < duracionVozMs; ms += duracionPistaMs) {
    cortes.add(ms);
  }
  const ordenados = [...cortes].sort((a, b) => a - b);

  // 3) Un tramo por par de cortes consecutivos con ganancia constante.
  const tramos: TramoMusica[] = [];
  for (let i = 0; i < ordenados.length - 1; i += 1) {
    const desdeMs = ordenados[i]!;
    const hastaMs = ordenados[i + 1]!;
    const duracionMs = hastaMs - desdeMs;
    if (duracionMs <= 0) continue;
    const gananciaDb = duckEn(desdeMs + duracionMs / 2)
      ? gananciaEn(desdeMs + duracionMs / 2) + parametros.gananciaDuckingDb
      : gananciaEn(desdeMs + duracionMs / 2);
    const esBorde = i === 0 || i === ordenados.length - 2;
    const fundidoEntrada = esBorde && i === 0 ? Math.min(parametros.fundidoMs * 4, duracionMs / 2) : Math.min(parametros.fundidoMs, duracionMs / 2);
    const fundidoSalida = i === ordenados.length - 2 ? Math.min(parametros.fundidoMs * 4, duracionMs / 2) : Math.min(parametros.fundidoMs, duracionMs / 2);
    tramos.push({
      inicioMs: desdeMs,
      duracionMs,
      offsetMs: desdeMs % duracionPistaMs,
      gananciaDb,
      fundidoEntradaMs: fundidoEntrada,
      fundidoSalidaMs: fundidoSalida,
    });
  }

  return { tramos, duracionTotalMs: duracionVozMs };
}

/**
 * Ventanas con voz a partir de la energía RMS de la voz (para el ducking):
 * recorre ventanas cortas y agrupa las que superan el umbral relativo.
 * Función pura sobre los valores RMS (testeable sin Web Audio).
 */
export function ventanasConVoz(
  rmsPorVentana: Float32Array | number[],
  ventanaMs: number,
  opciones?: { umbralRelativo?: number; paddingMs?: number },
): Array<{ desdeMs: number; hastaMs: number }> {
  if (rmsPorVentana.length === 0) return [];
  const umbralRelativo = opciones?.umbralRelativo ?? 0.06;
  const paddingMs = opciones?.paddingMs ?? 250;

  let maximo = 0;
  for (const valor of rmsPorVentana) maximo = Math.max(maximo, valor);
  if (maximo <= 0) return [];
  const umbral = maximo * umbralRelativo;

  const ventanas: Array<{ desdeMs: number; hastaMs: number }> = [];
  let abierta: number | null = null;
  for (let i = 0; i < rmsPorVentana.length; i += 1) {
    const conVoz = rmsPorVentana[i]! >= umbral;
    if (conVoz && abierta === null) abierta = i * ventanaMs;
    if (!conVoz && abierta !== null) {
      ventanas.push({ desdeMs: abierta, hastaMs: i * ventanaMs });
      abierta = null;
    }
  }
  if (abierta !== null) {
    ventanas.push({ desdeMs: abierta, hastaMs: rmsPorVentana.length * ventanaMs });
  }

  // Padding + fusión de ventanas que quedan pegadas.
  const conPadding = ventanas.map((v) => ({
    desdeMs: Math.max(0, v.desdeMs - paddingMs),
    hastaMs: v.hastaMs + paddingMs,
  }));
  const fusionadas: Array<{ desdeMs: number; hastaMs: number }> = [];
  for (const ventana of conPadding) {
    const ultima = fusionadas[fusionadas.length - 1];
    if (ultima && ventana.desdeMs <= ultima.hastaMs) {
      ultima.hastaMs = Math.max(ultima.hastaMs, ventana.hastaMs);
    } else {
      fusionadas.push({ ...ventana });
    }
  }
  return fusionadas;
}

/** Valida y tipa el contenido del puerto curva (tension/v1). */
export function validarCurva(contenido: unknown): TensionV1 | null {
  return comoTension(contenido);
}
