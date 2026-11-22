/**
 * Utilidad compartida por los nodos que producen audio: mezclar un plan de
 * buffers y registrar el resultado como nuevo activo WAV en la biblioteca.
 */

import { codificarWav } from '../nucleo/codificarWav';
import type { ContextoProcesador } from '@telar/motor';
import type { MetadatosActivo, PlanMezcla } from '@telar/motor';

export interface ResultadoRender {
  idActivo: string;
  meta: MetadatosActivo;
}

/**
 * Normaliza el nombre de un WAV de salida: si el nombre heredado ya termina
 * en una extensión de audio, no se le añade otra («x.wav» → «x.wav», nunca
 * «x.wav.wav»).
 */
export function normalizarNombreWav(nombre: string): string {
  const sinExtension = nombre.replace(/\.(wav|mp3|m4a|aac|ogg|oga|flac|webm|opus|aiff?)$/i, '');
  return `${sinExtension}.wav`;
}

/**
 * Renderiza el plan y guarda el WAV resultante en la biblioteca de activos.
 * `desde`/`hasta` delimitan el tramo [0,1] de progreso que esta fase ocupa
 * dentro del nodo, para que varias fases convivan sin pisarse.
 */
export async function renderizarAActivo(
  plan: PlanMezcla,
  nombre: string,
  contexto: ContextoProcesador,
  desde: number,
  hasta: number,
): Promise<ResultadoRender> {
  const { servicios } = contexto;
  const tramo = hasta - desde;
  const en = (fraccion: number): number => desde + tramo * Math.min(Math.max(fraccion, 0), 1);

  const buffer = await servicios.render.mezclar(plan, {
    senal: contexto.senal,
    progreso: (fraccion) => {
      contexto.reportarProgreso(en(0.05 + fraccion * 0.6), 'Mezclando audio (render offline)…');
    },
  });

  contexto.reportarProgreso(en(0.75), 'Codificando WAV…');
  const canales: Float32Array[] = [];
  for (let canal = 0; canal < buffer.numberOfChannels; canal += 1) {
    canales.push(buffer.getChannelData(canal));
  }
  const bytes = codificarWav(canales, buffer.sampleRate);

  contexto.reportarProgreso(en(0.9), 'Guardando resultado en la biblioteca…');
  const meta = await servicios.activos.poner(new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' }), {
    nombre: normalizarNombreWav(nombre),
    mime: 'audio/wav',
    duracionMs: Math.round(buffer.duration * 1000),
    tasaMuestreo: buffer.sampleRate,
    canales: buffer.numberOfChannels,
    bytes: bytes.byteLength,
    origen: 'nodo',
  });
  return { idActivo: meta.id, meta };
}
