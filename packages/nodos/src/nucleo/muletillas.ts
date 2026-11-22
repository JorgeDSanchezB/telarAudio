/**
 * Lógica pura de eliminación de muletillas (migración de eliminaMuletillas):
 * detección sobre las palabras de la transcripción + plan de recortes con
 * cierre de huecos y crossfades. 100 % testeable en Node, sin Web Audio.
 */

import { aplanarPalabras, normalizarPalabra } from './transcripcion';
import type { PalabraTranscrita, TranscripcionV1 } from './transcripcion';

export interface ParametrosMuletillas {
  /** Pausa mínima alrededor de la muletilla para atreverse a cortar (modo seguro). */
  pausaMinimaMs: number;
  /** Crossfade en cada unión tras cerrar el hueco. */
  fundidoMs: number;
  /** 'solo_pausas' (seguro) o 'siempre' (agresivo). */
  modo: 'solo_pausas' | 'siempre';
}

/** Índice (en el aplanado) + palabra detectada como muletilla. */
export interface DeteccionMuletilla {
  indice: number;
  palabra: PalabraTranscrita;
  /** Pausa real antes y después de la palabra (para el modo seguro). */
  pausaAntesMs: number;
  pausaDespuesMs: number;
}

/**
 * Detecta muletillas: palabras cuyo texto normalizado está en el catálogo.
 * El modo 'solo_pausas' exige pausas ≥ pausaMinimaMs a ambos lados (o borde
 * del audio); 'siempre' corta aunque estén pegadas a otras palabras.
 */
export function detectarMuletillas(
  transcripcion: TranscripcionV1,
  catalogo: string[],
  parametros: ParametrosMuletillas,
): DeteccionMuletilla[] {
  const conjunto = new Set(catalogo.map((termino) => normalizarPalabra(termino)).filter(Boolean));
  if (conjunto.size === 0) return [];
  const excluidas = new Set(transcripcion.revision?.excluirMuletillas ?? []);
  const palabras = aplanarPalabras(transcripcion);

  const detecciones: DeteccionMuletilla[] = [];
  palabras.forEach((palabra, indice) => {
    if (excluidas.has(indice)) return;
    const normalizada = normalizarPalabra(palabra.palabra);
    if (!normalizada || !conjunto.has(normalizada)) return;

    const anterior = palabras[indice - 1];
    const siguiente = palabras[indice + 1];
    const pausaAntesMs = anterior ? Math.max(0, palabra.inicioMs - anterior.finMs) : Number.MAX_SAFE_INTEGER;
    const pausaDespuesMs = siguiente ? Math.max(0, siguiente.inicioMs - palabra.finMs) : Number.MAX_SAFE_INTEGER;

    if (parametros.modo === 'solo_pausas') {
      if (pausaAntesMs < parametros.pausaMinimaMs || pausaDespuesMs < parametros.pausaMinimaMs) {
        return;
      }
    }
    detecciones.push({ indice, palabra, pausaAntesMs, pausaDespuesMs });
  });
  return detecciones;
}

/** Un tramo de audio que se CONSERVA tras quitar las muletillas. */
export interface TramoConservado {
  /** Posición en el audio ORIGINAL donde empieza el tramo. */
  offsetMs: number;
  duracionMs: number;
  /** Posición en el audio RESULTADO (huecos cerrados). */
  inicioResultadoMs: number;
  /** Crossfade de entrada/salida de este tramo (en las uniones con cortes). */
  fundidoEntradaMs: number;
  fundidoSalidaMs: number;
}

export interface PlanSinMuletillas {
  tramos: TramoConservado[];
  duracionResultadoMs: number;
  /** ms de audio eliminados en total. */
  msEliminados: number;
  detecciones: DeteccionMuletilla[];
}

/**
 * Construye el plan de recortes: complemento de los cortes de muletillas
 * dentro de [0, duracionMs], con huecos cerrados y crossfades en las uniones.
 */
export function planSinMuletillas(
  transcripcion: TranscripcionV1,
  catalogo: string[],
  parametros: ParametrosMuletillas,
): PlanSinMuletillas {
  const duracionMs = Math.max(
    transcripcion.duracionMs,
    ...aplanarPalabras(transcripcion).map((p) => p.finMs),
    1,
  );
  const detecciones = detectarMuletillas(transcripcion, catalogo, parametros);

  // Intervalos a cortar, fusionados si se solapan.
  const cortes = detecciones
    .map((d) => [d.palabra.inicioMs, d.palabra.finMs] as const)
    .sort((a, b) => a[0] - b[0]);
  const fusionados: Array<[number, number]> = [];
  for (const corte of cortes) {
    const ultimo = fusionados[fusionados.length - 1];
    if (ultimo && corte[0] <= ultimo[1]) {
      ultimo[1] = Math.max(ultimo[1], corte[1]);
    } else {
      fusionados.push([corte[0], corte[1]]);
    }
  }

  // Complemento: tramos conservados.
  const tramos: TramoConservado[] = [];
  let cursorOriginal = 0;
  let cursorResultado = 0;
  let msEliminados = 0;
  for (const [desdeMs, hastaMs] of fusionados) {
    if (desdeMs > cursorOriginal) {
      const duracion = desdeMs - cursorOriginal;
      const cortaAntes = cursorOriginal > 0; // este tramo termina en un corte
      const cortaDespues = true; // el siguiente evento es un corte
      tramos.push({
        offsetMs: cursorOriginal,
        duracionMs: duracion,
        inicioResultadoMs: cursorResultado,
        fundidoSalidaMs: cortaDespues ? Math.min(parametros.fundidoMs, duracion / 2) : 0,
        fundidoEntradaMs: cortaAntes ? Math.min(parametros.fundidoMs, duracion / 2) : 0,
      });
      cursorResultado += duracion;
    }
    msEliminados += hastaMs - desdeMs;
    cursorOriginal = Math.max(cursorOriginal, hastaMs);
  }
  if (cursorOriginal < duracionMs) {
    const duracion = duracionMs - cursorOriginal;
    tramos.push({
      offsetMs: cursorOriginal,
      duracionMs: duracion,
      inicioResultadoMs: cursorResultado,
      fundidoEntradaMs: cursorOriginal > 0 ? Math.min(parametros.fundidoMs, duracion / 2) : 0,
      fundidoSalidaMs: 0,
    });
    cursorResultado += duracion;
  }

  return {
    tramos,
    duracionResultadoMs: Math.max(cursorResultado, 1),
    msEliminados,
    detecciones,
  };
}
