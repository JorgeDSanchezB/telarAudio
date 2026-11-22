/**
 * Renderizado offline (bounce) con OfflineAudioContext: coloca los elementos
 * del plan en una línea de tiempo virtual, aplica ganancias y fundidos y
 * produce un AudioBuffer nuevo. Es el mismo servicio para la fusión, la
 * ganancia y el bounce de la línea de tiempo: una sola fuente de verdad de
 * cómo suena una mezcla.
 */

import { ErrorValidacion } from '@telar/motor';
import type { PlanMezcla, ServicioRenderizado } from '@telar/motor';
import { dbALineal } from '@telar/linea-tiempo';

const GANANCIA_MINIMA = 0.0001;

export class RenderizadorWebAudio implements ServicioRenderizado {
  constructor(private readonly tasaMuestreo: number) {}

  async mezclar(
    plan: PlanMezcla,
    opciones: { senal?: AbortSignal; progreso?: (fraccion: number) => void } = {},
  ): Promise<AudioBuffer> {
    const duracionSegundos = plan.duracionTotalMs / 1000;
    if (!Number.isFinite(duracionSegundos) || duracionSegundos < 0) {
      throw new ErrorValidacion({
        codigo: 'RENDER_PLAN_INVALIDO',
        mensaje: `Duración total de mezcla inválida: ${String(plan.duracionTotalMs)} ms.`,
        mensajeUsuario: 'El plan de mezcla es inválido y no se pudo renderizar.',
        reintentable: false,
      });
    }
    const totalMuestras = Math.max(1, Math.ceil(duracionSegundos * this.tasaMuestreo));
    const contexto = new OfflineAudioContext(2, totalMuestras, this.tasaMuestreo);

    plan.elementos.forEach((elemento, indice) => {
      const fuente = contexto.createBufferSource();
      fuente.buffer = elemento.buffer;
      const nodoGanancia = contexto.createGain();
      const ganancia = dbALineal(elemento.gananciaDb);
      const inicio = elemento.inicioMs / 1000;
      const duracion = elemento.duracionMs / 1000;
      const offset = elemento.offsetMs / 1000;
      const fundidoEntrada = elemento.fundidoEntradaMs / 1000;
      const fundidoSalida = elemento.fundidoSalidaMs / 1000;

      if (fundidoEntrada > 0) {
        nodoGanancia.gain.setValueAtTime(GANANCIA_MINIMA, inicio);
        nodoGanancia.gain.linearRampToValueAtTime(ganancia, inicio + fundidoEntrada);
      } else {
        nodoGanancia.gain.setValueAtTime(ganancia, inicio);
      }
      if (fundidoSalida > 0) {
        const arranqueSalida = Math.max(inicio + fundidoEntrada, inicio + duracion - fundidoSalida);
        nodoGanancia.gain.setValueAtTime(ganancia, arranqueSalida);
        nodoGanancia.gain.linearRampToValueAtTime(GANANCIA_MINIMA, inicio + duracion);
      }

      fuente.connect(nodoGanancia);
      nodoGanancia.connect(contexto.destination);
      fuente.start(inicio, offset, duracion);
      opciones.progreso?.((indice + 1) / (plan.elementos.length + 1));
    });

    opciones.senal?.throwIfAborted();
    const renderizado = await contexto.startRendering();
    opciones.progreso?.(1);
    return renderizado;
  }
}
