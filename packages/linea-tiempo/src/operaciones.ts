/**
 * Operaciones puras e inmutables sobre el documento de la línea de tiempo.
 *
 * Invariantes que estas funciones garantizan (ver `validarDocumento`):
 *  - ids de pistas y clips únicos en todo el documento;
 *  - clips ordenados y sin solaparse dentro de una pista;
 *  - 0 <= offset y offset+duración <= duración del audio fuente;
 *  - posiciones (start) nunca negativas.
 */

import { ErrorValidacion } from '@telar/motor';
import type { PlanMezcla } from '@telar/motor';
import type { AudioClip } from '@waveform-playlist/browser';
import { dbALineal } from './tipos';
import type { PistaTelar, TipoPista } from './tipos';

export interface FalloValidacionDocumento {
  codigo: string;
  mensaje: string;
}

function nuevoId(): string {
  return crypto.randomUUID();
}

function clipCompleto(buffer: AudioBuffer, startSample: number, gain: number): AudioClip {
  return {
    id: nuevoId(),
    audioBuffer: buffer,
    startSample,
    durationSamples: buffer.length,
    offsetSamples: 0,
    sampleRate: buffer.sampleRate,
    sourceDurationSamples: buffer.length,
    gain,
  };
}

/** Crea una pista nueva con un clip que abarca todo el buffer. */
export function crearPistaDesdeBuffer(
  nombre: string,
  tipoPista: TipoPista,
  buffer: AudioBuffer,
  opciones: { gananciaDb?: number; color?: string } = {},
): PistaTelar {
  if (!nombre || typeof nombre !== 'string') {
    throw new ErrorValidacion({
      codigo: 'PISTA_NOMBRE_INVALIDO',
      mensaje: 'La pista necesita un nombre.',
      mensajeUsuario: 'La pista necesita un nombre.',
      reintentable: false,
    });
  }
  return {
    id: nuevoId(),
    name: nombre,
    tipoPista,
    clips: [clipCompleto(buffer, 0, opciones.gananciaDb !== undefined ? dbALineal(opciones.gananciaDb) : 1)],
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
    ...(opciones.color !== undefined ? { color: opciones.color } : {}),
  };
}

export function eliminarPista(pistas: PistaTelar[], pistaId: string): PistaTelar[] {
  return pistas.filter((pista) => pista.id !== pistaId);
}

/** Sustituye una pista (por id) manteniendo el orden del documento. */
export function sustituirPista(pistas: PistaTelar[], pistaNueva: PistaTelar): PistaTelar[] {
  return pistas.map((pista) => (pista.id === pistaNueva.id ? pistaNueva : pista));
}

export interface ResultadoEliminarRango {
  pistas: PistaTelar[];
  pistaModificada: PistaTelar;
  muestrasEliminadas: number;
}

/**
 * ELIMINACIÓN DESTRUCTIVA de un rango [desde, hasta) de una pista (nivel
 * documento): los clips se recortan/dividen alrededor del rango y los clips
 * posteriores se desplazan a la izquierda. La persistencia real del audio
 * resultante la hace la aplicación con un rebounce (render) de la pista.
 */
export function eliminarRangoDePista(
  pistas: PistaTelar[],
  pistaId: string,
  desdeMuestra: number,
  hastaMuestra: number,
): ResultadoEliminarRango {
  const pista = pistas.find((p) => p.id === pistaId);
  if (!pista) {
    throw new ErrorValidacion({
      codigo: 'PISTA_INEXISTENTE',
      mensaje: `No existe la pista ${pistaId}.`,
      mensajeUsuario: 'Esa pista ya no existe en la línea de tiempo.',
      reintentable: false,
    });
  }
  if (
    !Number.isInteger(desdeMuestra) ||
    !Number.isInteger(hastaMuestra) ||
    desdeMuestra < 0 ||
    hastaMuestra <= desdeMuestra
  ) {
    throw new ErrorValidacion({
      codigo: 'RANGO_INVALIDO',
      mensaje: `El rango [${desdeMuestra}, ${hastaMuestra}) no es válido.`,
      mensajeUsuario: 'La selección para eliminar no es válida.',
      reintentable: false,
    });
  }
  const ancho = hastaMuestra - desdeMuestra;
  const clipsNuevos: AudioClip[] = [];
  let muestrasEliminadas = 0;
  for (const clip of [...pista.clips].sort((a, b) => a.startSample - b.startSample)) {
    const inicio = clip.startSample;
    const fin = clip.startSample + clip.durationSamples;
    // Parte del clip dentro del rango a eliminar:
    const dentroInicio = Math.max(inicio, desdeMuestra);
    const dentroFin = Math.min(fin, hastaMuestra);
    const muestrasDentro = Math.max(0, dentroFin - dentroInicio);

    if (muestrasDentro === 0) {
      // Fuera del rango: se conserva; los posteriores se desplazan a la izquierda.
      clipsNuevos.push(inicio >= hastaMuestra ? { ...clip, startSample: inicio - ancho } : { ...clip });
      continue;
    }

    muestrasEliminadas += muestrasDentro;
    const izquierdaDur = dentroInicio - inicio; // samples que sobreviven antes del rango
    const derechaDur = fin - dentroFin; // samples que sobreviven después del rango
    if (izquierdaDur > 0) {
      clipsNuevos.push({ ...clip, durationSamples: izquierdaDur });
    }
    if (derechaDur > 0) {
      // La parte derecha se pega a continuación de la izquierda superviviente:
      // arranca en `desde` (su inicio original menos el ancho eliminado) y
      // consume el buffer a partir de offset + (dentroFin - inicio).
      clipsNuevos.push({
        ...clip,
        id: nuevoId(),
        startSample: dentroFin - ancho,
        durationSamples: derechaDur,
        offsetSamples: clip.offsetSamples + (dentroFin - inicio),
      });
    }
  }
  const pistaModificada: PistaTelar = { ...pista, clips: clipsNuevos };
  return { pistas: sustituirPista(pistas, pistaModificada), pistaModificada, muestrasEliminadas };
}

/** Valida el documento completo y devuelve la lista de fallos (vacía si es válido). */
export function validarDocumento(pistas: PistaTelar[]): FalloValidacionDocumento[] {
  const fallos: FalloValidacionDocumento[] = [];
  const idsPista = new Set<string>();
  const idsClip = new Set<string>();
  for (const pista of pistas) {
    if (!pista.id || idsPista.has(pista.id)) {
      fallos.push({ codigo: 'PISTA_ID_INVALIDO', mensaje: `Id de pista duplicado o vacío: ${String(pista.id)}` });
    }
    idsPista.add(pista.id);
    let finAnterior = -1;
    for (const clip of [...pista.clips].sort((a, b) => a.startSample - b.startSample)) {
      if (!clip.id || idsClip.has(clip.id)) {
        fallos.push({ codigo: 'CLIP_ID_INVALIDO', mensaje: `Id de clip duplicado o vacío: ${String(clip.id)}` });
      }
      idsClip.add(clip.id);
      if (clip.startSample < 0) {
        fallos.push({ codigo: 'CLIP_POSICION_INVALIDA', mensaje: `El clip ${clip.id} empieza antes de 0.` });
      }
      if (clip.startSample < finAnterior) {
        fallos.push({ codigo: 'CLIP_SOLAPADO', mensaje: `El clip ${clip.id} se solapa con el anterior en la pista ${pista.id}.` });
      }
      finAnterior = Math.max(finAnterior, clip.startSample + clip.durationSamples);
      if (clip.durationSamples <= 0) {
        fallos.push({ codigo: 'CLIP_DURACION_INVALIDA', mensaje: `El clip ${clip.id} tiene duración no positiva.` });
      }
      if (clip.offsetSamples < 0 || clip.offsetSamples + clip.durationSamples > clip.sourceDurationSamples) {
        fallos.push({
          codigo: 'CLIP_FUERA_DE_FUENTE',
          mensaje: `El clip ${clip.id} excede los límites de su audio fuente.`,
        });
      }
    }
  }
  return fallos;
}

export interface OpcionesMezcla {
  tasaMuestreo: number;
}

/**
 * Convierte el documento en un PlanMezcla del motor (elementos con buffer,
 * posición en ms, ganancia combinada clip×pista y fundidos). Es la base del
 * "bounce" (exportación destructiva de la línea de tiempo).
 *
 * Semántica de mezcla: se excluyen las pistas silenciadas; si alguna pista
 * está en solo, solo se mezclan las pistas en solo.
 */
export function planificarMezclaPistas(pistas: PistaTelar[], opciones: OpcionesMezcla): PlanMezcla {
  const tasa = opciones.tasaMuestreo;
  const haySolo = pistas.some((p) => p.soloed);
  const activas = pistas.filter((p) => (haySolo ? p.soloed : !p.muted));
  let duracionMaximaMuestras = 0;
  const elementos: PlanMezcla['elementos'] = [];
  for (const pista of activas) {
    for (const clip of pista.clips) {
      if (!clip.audioBuffer) {
        throw new ErrorValidacion({
          codigo: 'CLIP_SIN_AUDIO',
          mensaje: `El clip ${clip.id} no tiene audio cargado y no se puede mezclar.`,
          mensajeUsuario: 'Uno de los clips aún no tiene su audio cargado. Espera a que termine de cargar y vuelve a intentarlo.',
          reintentable: true,
        });
      }
      const gananciaTotal = clip.gain * pista.volume;
      elementos.push({
        buffer: clip.audioBuffer,
        inicioMs: (clip.startSample / tasa) * 1000,
        duracionMs: (clip.durationSamples / tasa) * 1000,
        offsetMs: (clip.offsetSamples / clip.sampleRate) * 1000,
        gananciaDb: gananciaTotal > 0 ? 20 * Math.log10(gananciaTotal) : -60,
        fundidoEntradaMs: clip.fadeIn ? clip.fadeIn.duration * 1000 : 0,
        fundidoSalidaMs: clip.fadeOut ? clip.fadeOut.duration * 1000 : 0,
      });
      duracionMaximaMuestras = Math.max(duracionMaximaMuestras, clip.startSample + clip.durationSamples);
    }
  }
  return {
    elementos,
    duracionTotalMs: (duracionMaximaMuestras / tasa) * 1000,
  };
}
