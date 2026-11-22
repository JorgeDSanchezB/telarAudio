/**
 * Nodo "Análisis de tensión narrativa" — migra la Fase 2 de bardoStudio con
 * la decisión documentada: v1 heurística SIN LLM (energía del texto: ritmo,
 * pausas, signos, léxico), función pura y corregible en el inspector. La
 * variante LLM queda declarada como opción y falla con MOTOR_NO_DISPONIBLE
 * hasta que se decida (no se promete lo no verificado).
 */

import { ErrorConfiguracion, ErrorValidacion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';
import { comoTranscripcion, TIPO_DATO_TRANSCRIPCION } from '../nucleo/transcripcion';
import { calcularCurvaTension, TIPO_DATO_TENSION } from '../nucleo/tension';
import { resolverDato } from './usoDatos';

export function crearDefinicionTension(): DefinicionNodo {
  return {
    tipo: 'analisis-tension',
    version: '1.0.0',
    etiqueta: 'Análisis de tensión narrativa',
    descripcion:
      'Calcula una curva de tensión (0–100) por ventanas a partir de la transcripción: ritmo de palabras, pausas, ' +
      'signos de exclamación/interrogación y densidad léxica. Sin LLM: heurística explicable y verificable. ' +
      'La curva es corregible arrastrando los puntos en el inspector.',
    categoria: 'enriquecimiento',
    runtime: 'cliente',
    entradas: [
      {
        clave: 'transcripcion',
        etiqueta: 'Transcripción',
        tipo: 'dato',
        tipoDato: TIPO_DATO_TRANSCRIPCION,
        requerida: true,
      },
    ],
    salidas: [
      {
        clave: 'curva',
        etiqueta: 'Curva de tensión',
        tipo: 'dato',
        tipoDato: TIPO_DATO_TENSION,
        descripcion: 'Puntos {inicioMs, tension 0..100} (tension/v1), corregibles.',
      },
    ],
    parametros: [
      {
        tipo: 'numero',
        clave: 'granularidadS',
        etiqueta: 'Granularidad',
        defecto: 30,
        min: 5,
        max: 120,
        paso: 5,
        unidad: 's',
        descripcion: 'Tamaño de la ventana de análisis: ventanas cortas reaccionan antes, largas suavizan.',
      },
      {
        tipo: 'opcion',
        clave: 'motor',
        etiqueta: 'Motor',
        defecto: 'heuristica',
        opciones: [
          { valor: 'heuristica', etiqueta: 'Heurística (sin LLM, explicable)' },
          { valor: 'llm-backend', etiqueta: 'LLM en backend (pendiente de decisión)' },
        ],
        descripcion:
          'bardoStudio usaba un LLM; aquí la heurística es la opción verificada. El LLM queda deshabilitado hasta decidir proveedor/modelo.',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'DATO_INCOMPATIBLE',
        categoria: 'validacion',
        descripcion: 'La entrada no es un dato transcripcion/v1.',
        reintentable: false,
      },
      {
        codigo: 'MOTOR_NO_DISPONIBLE',
        categoria: 'configuracion',
        descripcion: 'Se pidió el motor LLM, que aún no está decidido/implementado.',
        reintentable: false,
      },
    ],
    crearProcesador: () => ({
      ejecutar: async (entrada, contexto) => {
        if (entrada.parametros.motor === 'llm-backend') {
          throw new ErrorConfiguracion({
            codigo: 'MOTOR_NO_DISPONIBLE',
            mensaje: 'El motor LLM de tensión no está implementado.',
            mensajeUsuario:
              'El análisis con LLM está pendiente de una decisión de producto (modelo/proveedor). Usa la heurística, ' +
              'que ya produce una curva corregible.',
            reintentable: false,
          });
        }
        const datos = contexto.servicios.datos;
        if (!datos) {
          throw new ErrorConfiguracion({
            codigo: 'ALMACEN_DATOS_NO_CONFIGURADO',
            mensaje: 'No hay almacén de datos en la sesión.',
            mensajeUsuario: 'La sesión no puede registrar la curva. Reinicia la aplicación.',
            reintentable: false,
          });
        }

        const dato = resolverDato(
          contexto,
          entrada.entradas.transcripcion ?? [],
          TIPO_DATO_TRANSCRIPCION,
          'Análisis de tensión',
        );
        const transcripcion = comoTranscripcion(dato.contenido);
        if (!transcripcion) {
          throw new ErrorValidacion({
            codigo: 'DATO_INCOMPATIBLE',
            mensaje: 'El dato de transcripción tiene formato inválido.',
            mensajeUsuario: 'La transcripción llegó mal formada. Vuelve a ejecutar el nodo de transcripción.',
            reintentable: false,
          });
        }

        contexto.reportarProgreso(0.3, 'Calculando la curva de tensión (heurística)…');
        const curva = calcularCurvaTension(transcripcion, {
          granularidadS: entrada.parametros.granularidadS as number,
        });
        contexto.registrar(
          `Curva de tensión: ${curva.puntos.length} punto(s), máximo ${Math.max(
            ...curva.puntos.map((p) => p.tension),
          )}, mínimo ${Math.min(...curva.puntos.map((p) => p.tension))}.`,
        );
        const registrado = await datos.registrar(TIPO_DATO_TENSION, curva);
        return { salidas: { curva: { tipo: 'dato', idDato: registrado.idDato, tipoDato: TIPO_DATO_TENSION } } };
      },
    }),
  };
}
