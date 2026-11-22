/**
 * Nodo "Ganancia/Normalización": ajusta el volumen de una entrada, bien con
 * un valor fijo en dB, bien normalizando el pico a un objetivo en dBFS.
 * Es también el ejemplo canónico de "variante de nodo" añadida sin tocar el
 * núcleo (su modo "normalizar pico" es una variante de la ganancia fija).
 */

import { ErrorValidacion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';
import { calcularPicoDbfs } from '../nucleo/picos';
import { renderizarAActivo } from './util-render';

/** Límite de ganancia aplicable en una sola pasada, en dB. */
export const LIMITE_GANANCIA_DB = 48;

export function crearDefinicionGanancia(): DefinicionNodo {
  return {
    tipo: 'ganancia',
    version: '1.0.0',
    etiqueta: 'Ganancia/Normalización',
    descripcion:
      'Sube o baja el volumen de un audio (ganancia fija en dB) o normaliza su pico al nivel objetivo en dBFS.',
    categoria: 'edicion',
    runtime: 'cliente',
    entradas: [{ clave: 'entrada', etiqueta: 'Audio de entrada', tipo: 'audio', requerida: true }],
    salidas: [{ clave: 'salida', etiqueta: 'Audio ajustado', tipo: 'audio' }],
    parametros: [
      {
        tipo: 'opcion',
        clave: 'modo',
        etiqueta: 'Modo',
        defecto: 'ganancia_fija',
        opciones: [
          { valor: 'ganancia_fija', etiqueta: 'Ganancia fija' },
          { valor: 'normalizar_pico', etiqueta: 'Normalizar pico' },
        ],
        descripcion: 'Fija aplica los dB indicados; normalizar ajusta para que el punto más alto alcance el objetivo.',
      },
      {
        tipo: 'numero',
        clave: 'gananciaDb',
        etiqueta: 'Ganancia',
        defecto: 0,
        min: -LIMITE_GANANCIA_DB,
        max: LIMITE_GANANCIA_DB,
        paso: 0.5,
        unidad: 'dB',
        descripcion: 'Solo en modo "Ganancia fija": dB a aplicar (negativo para bajar).',
      },
      {
        tipo: 'numero',
        clave: 'objetivoDbfs',
        etiqueta: 'Pico objetivo',
        defecto: -3,
        min: -30,
        max: 0,
        paso: 0.5,
        unidad: 'dBFS',
        descripcion: 'Solo en modo "Normalizar pico": nivel máximo permitido.',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'GANANCIA_SIN_ENTRADA',
        categoria: 'validacion',
        descripcion: 'No hay audio conectado a la entrada.',
        reintentable: false,
      },
      {
        codigo: 'GANANCIA_AUDIO_SILENTE',
        categoria: 'validacion',
        descripcion: 'No se puede normalizar un audio completamente silencioso.',
        reintentable: false,
      },
      {
        codigo: 'ACTIVO_NO_ENCONTRADO',
        categoria: 'configuracion',
        descripcion: 'El audio de entrada ya no está en la biblioteca.',
        reintentable: false,
      },
    ],
    crearProcesador: () => ({
      ejecutar: async (entrada, contexto) => {
        const valorEntrada = entrada.entradas.entrada?.[0];
        if (!valorEntrada || valorEntrada.tipo !== 'audio') {
          throw new ErrorValidacion({
            codigo: 'GANANCIA_SIN_ENTRADA',
            mensaje: 'El nodo de ganancia necesita una entrada de audio.',
            mensajeUsuario: 'Conecta un audio a la entrada del nodo de ganancia.',
            reintentable: false,
          });
        }
        contexto.reportarProgreso(0.05, 'Decodificando audio…');
        const buffer = await contexto.servicios.audio.decodificar(valorEntrada.idActivo, contexto.senal);

        let gananciaDb: number;
        const modo = entrada.parametros.modo as string;
        if (modo === 'normalizar_pico') {
          contexto.reportarProgreso(0.3, 'Midiendo pico…');
          const canales: Float32Array[] = [];
          for (let canal = 0; canal < buffer.numberOfChannels; canal += 1) {
            canales.push(buffer.getChannelData(canal));
          }
          const pico = calcularPicoDbfs(canales);
          if (!Number.isFinite(pico)) {
            throw new ErrorValidacion({
              codigo: 'GANANCIA_AUDIO_SILENTE',
              mensaje: 'El audio es silencio absoluto; no hay pico que normalizar.',
              mensajeUsuario: 'No se puede normalizar un audio completamente silencioso.',
              reintentable: false,
            });
          }
          const objetivo = entrada.parametros.objetivoDbfs as number;
          gananciaDb = Math.min(Math.max(objetivo - pico, -LIMITE_GANANCIA_DB), LIMITE_GANANCIA_DB);
          contexto.registrar(`Pico medido: ${pico.toFixed(2)} dBFS; ganancia aplicada: ${gananciaDb.toFixed(2)} dB.`);
        } else {
          gananciaDb = entrada.parametros.gananciaDb as number;
        }

        const meta = contexto.servicios.activos.obtenerMeta(valorEntrada.idActivo);
        const duracionMs = Math.round(buffer.duration * 1000);
        const resultado = await renderizarAActivo(
          {
            elementos: [
              {
                buffer,
                inicioMs: 0,
                duracionMs,
                offsetMs: 0,
                gananciaDb,
                fundidoEntradaMs: 0,
                fundidoSalidaMs: 0,
              },
            ],
            duracionTotalMs: duracionMs,
          },
          /* sin extensión aquí: renderizarAActivo normaliza el nombre del WAV
             (así un origen «x.wav» no produce «x.wav.wav») */
          `Ganancia (${gananciaDb > 0 ? '+' : ''}${gananciaDb.toFixed(1)} dB) — ${meta?.nombre ?? 'audio'}`,
          contexto,
          0.35,
          1,
        );
        return { salidas: { salida: { tipo: 'audio', idActivo: resultado.idActivo } } };
      },
    }),
  };
}
