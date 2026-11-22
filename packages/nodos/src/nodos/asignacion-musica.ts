/**
 * Nodo "Música de fondo" — migra la Fase 3–4 de bardoStudio: la pista (de la
 * biblioteca) se repite cubriendo la voz, su volumen sigue los bloques de la
 * curva de tensión y baja donde hay voz (ducking por energía). La curva se
 * corrige en el inspector y este nodo se recalcula solo.
 */

import { ErrorConfiguracion, ErrorValidacion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';
import { TIPO_DATO_TENSION } from '../nucleo/tension';
import { planMusica, ventanasConVoz, validarCurva } from '../nucleo/musica';
import { renderizarAActivo } from './util-render';
import { resolverDato } from './usoDatos';

/** RMS por ventana para el ducking: energía de la voz sin Web Audio en el núcleo. */
function rmsPorVentanas(buffer: AudioBuffer, ventanaMs: number): Float32Array {
  const muestrasPorVentana = Math.max(1, Math.round((buffer.sampleRate * ventanaMs) / 1000));
  const total = Math.ceil(buffer.length / muestrasPorVentana);
  const salida = new Float32Array(total);
  const canal = buffer.numberOfChannels > 0 ? buffer.getChannelData(0) : new Float32Array(0);
  for (let v = 0; v < total; v += 1) {
    const desde = v * muestrasPorVentana;
    const hasta = Math.min(desde + muestrasPorVentana, canal.length);
    let suma = 0;
    for (let i = desde; i < hasta; i += 1) {
      suma += canal[i]! * canal[i]!;
    }
    salida[v] = hasta > desde ? Math.sqrt(suma / (hasta - desde)) : 0;
  }
  return salida;
}

export function crearDefinicionMusica(): DefinicionNodo {
  return {
    tipo: 'asignacion-musica',
    version: '1.0.0',
    etiqueta: 'Música de fondo',
    descripcion:
      'Añade una pista musical que se repite bajo la narración siguiendo la curva de tensión (más tensión, más ' +
      'presencia) y baja automáticamente cuando hay voz (ducking). La pista sale de la biblioteca: importa tu propia ' +
      'música o usa las pistas de ejemplo que la app trae (catalogos.musica en la configuración).',
    categoria: 'enriquecimiento',
    runtime: 'cliente',
    entradas: [
      { clave: 'voz', etiqueta: 'Voz', tipo: 'audio', requerida: true },
      {
        clave: 'curva',
        etiqueta: 'Curva de tensión',
        tipo: 'dato',
        tipoDato: TIPO_DATO_TENSION,
        requerida: true,
        descripcion: 'La curva del nodo Análisis de tensión (corregible en su inspector).',
      },
    ],
    salidas: [{ clave: 'mezcla', etiqueta: 'Voz + música', tipo: 'audio' }],
    parametros: [
      {
        tipo: 'activo',
        clave: 'pista',
        etiqueta: 'Pista musical',
        formato: 'audio',
        defecto: '',
        descripcion: 'Un archivo de música de la biblioteca (impórtala arriba o usa las pistas de ejemplo).',
      },
      {
        tipo: 'numero',
        clave: 'gananciaMusicaDb',
        etiqueta: 'Volumen música',
        defecto: -18,
        min: -40,
        max: 0,
        paso: 1,
        unidad: 'dB',
        descripcion: 'Volumen base de la música; la tensión añade hasta +6 dB en los picos.',
      },
      {
        tipo: 'booleano',
        clave: 'ducking',
        etiqueta: 'Bajar música bajo la voz',
        defecto: true,
        descripcion: 'Duck automático: la música baja cuando la narración habla.',
      },
      {
        tipo: 'numero',
        clave: 'gananciaDuckingDb',
        etiqueta: 'Cuánto baja con voz',
        defecto: -8,
        min: -24,
        max: 0,
        paso: 1,
        unidad: 'dB',
        descripcion: 'Cuántos dB se resta la música en las ventanas con voz.',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'SIN_PISTA',
        categoria: 'validacion',
        descripcion: 'No se eligió pista musical.',
        reintentable: false,
      },
      {
        codigo: 'CURVA_INCOMPATIBLE',
        categoria: 'validacion',
        descripcion: 'La entrada curva no es un dato tension/v1.',
        reintentable: false,
      },
      {
        codigo: 'MUSICA_SIN_VOZ',
        categoria: 'configuracion',
        descripcion: 'No hay audio de voz conectado.',
        reintentable: false,
      },
      {
        codigo: 'NODO_TIMEOUT',
        categoria: 'temporal',
        descripcion: 'La mezcla superó el tiempo máximo de ejecución.',
        reintentable: true,
      },
    ],
    crearProcesador: () => ({
      ejecutar: async (entrada, contexto) => {
        const valorVoz = entrada.entradas.voz?.[0];
        if (!valorVoz || valorVoz.tipo !== 'audio') {
          throw new ErrorConfiguracion({
            codigo: 'MUSICA_SIN_VOZ',
            mensaje: 'El nodo necesita audio de voz en la entrada "voz".',
            mensajeUsuario: 'Conecta la narración a la entrada de voz del nodo de música.',
            reintentable: false,
          });
        }
        const idPista = entrada.parametros.pista;
        if (typeof idPista !== 'string' || idPista === '') {
          throw new ErrorValidacion({
            codigo: 'SIN_PISTA',
            mensaje: 'El parámetro pista musical está vacío.',
            mensajeUsuario:
              'Elige una pista musical en el parámetro "Pista musical" (impórtala a la biblioteca o usa las de ejemplo).',
            reintentable: false,
          });
        }
        const metaPista = contexto.servicios.activos.obtenerMeta(idPista);
        if (!metaPista) {
          throw new ErrorConfiguracion({
            codigo: 'SIN_PISTA',
            mensaje: `La pista ${idPista} ya no está en la biblioteca.`,
            mensajeUsuario: 'La pista elegida ya no está en la biblioteca. Vuelve a elegirla en el parámetro "Pista musical".',
            reintentable: false,
          });
        }

        const dato = resolverDato(
          contexto,
          entrada.entradas.curva ?? [],
          TIPO_DATO_TENSION,
          'Música de fondo',
        );
        const curva = validarCurva(dato.contenido);
        if (!curva) {
          throw new ErrorValidacion({
            codigo: 'CURVA_INCOMPATIBLE',
            mensaje: 'El dato de curva tiene formato inválido.',
            mensajeUsuario: 'La curva de tensión llegó mal formada. Vuelve a ejecutar el nodo de análisis.',
            reintentable: false,
          });
        }

        contexto.reportarProgreso(0.1, 'Decodificando voz y música…');
        const [bufferVoz, bufferPista] = await Promise.all([
          contexto.servicios.audio.decodificar(valorVoz.idActivo, contexto.senal),
          contexto.servicios.audio.decodificar(idPista, contexto.senal),
        ]);
        const duracionVozMs = Math.round(bufferVoz.duration * 1000);
        const duracionPistaMs = Math.max(1, Math.round(bufferPista.duration * 1000));

        // Ventanas con voz para el ducking (energía RMS de la propia voz).
        const ventanaMs = 100;
        const ventanas = ventanasConVoz(rmsPorVentanas(bufferVoz, ventanaMs), ventanaMs);

        contexto.reportarProgreso(0.35, 'Planificando la música según la tensión…');
        const plan = planMusica(curva, duracionVozMs, duracionPistaMs, {
          gananciaMusicaDb: entrada.parametros.gananciaMusicaDb as number,
          ducking: entrada.parametros.ducking === true,
          gananciaDuckingDb: entrada.parametros.gananciaDuckingDb as number,
          fundidoMs: 250,
        }, ventanas);
        contexto.registrar(
          `Música: ${plan.tramos.length} tramo(s) sobre ${duracionVozMs} ms` +
            ` (pista «${metaPista.nombre}» de ${duracionPistaMs} ms, ${ventanas.length} ventana(s) con voz).`,
        );

        const elementos: Parameters<typeof renderizarAActivo>[0]['elementos'] = [
          {
            buffer: bufferVoz,
            inicioMs: 0,
            duracionMs: duracionVozMs,
            offsetMs: 0,
            gananciaDb: 0,
            fundidoEntradaMs: 0,
            fundidoSalidaMs: 0,
          },
          ...plan.tramos.map((tramo) => ({
            buffer: bufferPista,
            inicioMs: tramo.inicioMs,
            duracionMs: tramo.duracionMs,
            offsetMs: tramo.offsetMs,
            gananciaDb: tramo.gananciaDb,
            fundidoEntradaMs: tramo.fundidoEntradaMs,
            fundidoSalidaMs: tramo.fundidoSalidaMs,
          })),
        ];

        const resultado = await renderizarAActivo(
          { elementos, duracionTotalMs: plan.duracionTotalMs },
          'Narración con música.wav',
          contexto,
          0.5,
          1,
        );
        return { salidas: { mezcla: { tipo: 'audio', idActivo: resultado.idActivo } } };
      },
    }),
  };
}
