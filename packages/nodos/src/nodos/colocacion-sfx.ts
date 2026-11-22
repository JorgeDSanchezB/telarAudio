/**
 * Nodo "Efectos de sonido por contexto" — migra la Fase 2.5 de bardoStudio:
 * un diccionario (configuración de la app, migración del formato de
 * sfx_config.json) aplica efectos sobre las palabras de la transcripción;
 * cada coincidencia suena en el segundo exacto del fin de la palabra. Emite
 * también un dato con las colocaciones para activar/desactivar en el inspector.
 */

import { ErrorConfiguracion, ErrorValidacion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';
import { comoTranscripcion, TIPO_DATO_TRANSCRIPCION } from '../nucleo/transcripcion';
import { planSfx } from '../nucleo/sfx';
import type { EfectoCatalogo } from '../nucleo/sfx';
import { renderizarAActivo } from './util-render';
import { resolverDato } from './usoDatos';

export const TIPO_DATO_COLOCACIONES = 'colocaciones-sfx/v1';

/** Catálogo de ejemplo: archivos sintéticos originales servidos por la app. */
export const SFX_DEFECTO: EfectoCatalogo[] = [
  {
    id: 'campana',
    nombre: 'Campana',
    ruta: '/sfx/campana.wav',
    terminos: ['campana', 'campanadas', 'ding', 'doblaron', 'esquila', 'repique'],
  },
  {
    id: 'trueno',
    nombre: 'Trueno',
    ruta: '/sfx/trueno.wav',
    terminos: ['trueno', 'truenos', 'tormenta', 'relámpago', 'relampago', 'rayo', 'rayos'],
  },
  {
    id: 'viento',
    nombre: 'Viento',
    ruta: '/sfx/viento.wav',
    terminos: ['viento', 'brisa', 'ventisca', 'soplaba', 'aurora'],
  },
  {
    id: 'golpe',
    nombre: 'Golpe',
    ruta: '/sfx/golpe.wav',
    terminos: ['golpe', 'portazo', 'golpez', 'porrazo', 'puñetazo', 'punetazo', 'impacto'],
  },
  {
    id: 'agua',
    nombre: 'Agua',
    ruta: '/sfx/agua.wav',
    terminos: ['agua', 'río', 'rio', 'lluvia', 'ola', 'olas', 'arroyo', 'cascada'],
  },
  {
    id: 'pajaro',
    nombre: 'Pájaro',
    ruta: '/sfx/pajaro.wav',
    terminos: ['pájaro', 'pajaro', 'pájaros', 'pajaros', 'ruiseñor', 'ruiseñor', 'gorrión', 'gorrion', 'ave'],
  },
];

export function crearDefinicionSfx(): DefinicionNodo {
  return {
    tipo: 'colocacion-sfx',
    version: '1.0.0',
    etiqueta: 'Efectos de sonido por contexto',
    descripcion:
      'Coloca efectos de sonido donde la narración los menciona: el diccionario (configuración, catálogo auditable) ' +
      'dispara cada efecto en el segundo exacto en que termina la palabra. Las colocaciones se listan en el inspector ' +
      'para activarlas, desactivarlas o desplazarlas, y la mezcla se recalcula solo.',
    categoria: 'enriquecimiento',
    runtime: 'cliente',
    entradas: [
      { clave: 'voz', etiqueta: 'Voz', tipo: 'audio', requerida: true },
      {
        clave: 'transcripcion',
        etiqueta: 'Transcripción',
        tipo: 'dato',
        tipoDato: TIPO_DATO_TRANSCRIPCION,
        requerida: true,
      },
    ],
    salidas: [
      { clave: 'mezcla', etiqueta: 'Voz + efectos', tipo: 'audio' },
      {
        clave: 'colocaciones',
        etiqueta: 'Colocaciones',
        tipo: 'dato',
        tipoDato: TIPO_DATO_COLOCACIONES,
        descripcion: 'Lista de colocaciones para revisar en el inspector.',
      },
    ],
    parametros: [
      {
        tipo: 'numero',
        clave: 'gananciaSfxDb',
        etiqueta: 'Volumen efectos',
        defecto: -12,
        min: -40,
        max: 6,
        paso: 1,
        unidad: 'dB',
        descripcion: 'Volumen de los efectos respecto a la voz.',
      },
      {
        tipo: 'numero',
        clave: 'desplazamientoMs',
        etiqueta: 'Desplazamiento',
        defecto: 0,
        min: -2000,
        max: 2000,
        paso: 50,
        unidad: 'ms',
        descripcion: 'Mueve TODOS los efectos respecto al fin de su palabra (los finos, en el inspector).',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'DATO_INCOMPATIBLE',
        categoria: 'validacion',
        descripcion: 'La entrada de transcripción no es transcripcion/v1.',
        reintentable: false,
      },
      {
        codigo: 'SFX_SIN_VOZ',
        categoria: 'configuracion',
        descripcion: 'No hay audio de voz conectado.',
        reintentable: false,
      },
      {
        codigo: 'SIN_EFECTOS_EN_CATALOGO',
        categoria: 'configuracion',
        descripcion: 'El catálogo de efectos de la configuración está vacío.',
        reintentable: false,
      },
      {
        codigo: 'SFX_ARCHIVO_INACCESIBLE',
        categoria: 'configuracion',
        descripcion: 'El archivo de algún efecto del catálogo no se pudo cargar.',
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
            codigo: 'SFX_SIN_VOZ',
            mensaje: 'El nodo necesita audio de voz en la entrada "voz".',
            mensajeUsuario: 'Conecta la narración a la entrada de voz del nodo de efectos.',
            reintentable: false,
          });
        }
        const datos = contexto.servicios.datos;
        if (!datos) {
          throw new ErrorConfiguracion({
            codigo: 'ALMACEN_DATOS_NO_CONFIGURADO',
            mensaje: 'No hay almacén de datos en la sesión.',
            mensajeUsuario: 'La sesión no puede registrar colocaciones. Reinicia la aplicación.',
            reintentable: false,
          });
        }

        // Catálogo desde la configuración validada.
        const configuracion = contexto.servicios.configuracion;
        const catalogoBruto = configuracion?.leer<EfectoCatalogo[]>('catalogos.sfx');
        const catalogo =
          Array.isArray(catalogoBruto) && catalogoBruto.length > 0 ? catalogoBruto : SFX_DEFECTO;
        if (catalogo.length === 0) {
          throw new ErrorConfiguracion({
            codigo: 'SIN_EFECTOS_EN_CATALOGO',
            mensaje: 'catalogos.sfx está vacío en la configuración.',
            mensajeUsuario:
              'El catálogo de efectos está vacío. Añade efectos en la configuración (catalogos.sfx).',
            reintentable: false,
          });
        }

        const dato = resolverDato(
          contexto,
          entrada.entradas.transcripcion ?? [],
          TIPO_DATO_TRANSCRIPCION,
          'Efectos de sonido',
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

        const plan = planSfx(transcripcion, catalogo, {
          gananciaSfxDb: entrada.parametros.gananciaSfxDb as number,
          desplazamientoMs: entrada.parametros.desplazamientoMs as number,
        });
        contexto.registrar(
          `SFX: ${plan.activas.length} colocación(es) activa(s) de ${plan.colocaciones.length}` +
            ` con ${new Set(plan.activas.map((c) => c.efecto.id)).size} efecto(s).`,
        );

        contexto.reportarProgreso(0.15, 'Decodificando la voz…');
        const bufferVoz = await contexto.servicios.audio.decodificar(valorVoz.idActivo, contexto.senal);
        const duracionVozMs = Math.round(bufferVoz.duration * 1000);

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
        ];

        if (plan.activas.length > 0) {
          // Cargar cada efecto UNA vez (por id, cacheado por contenido) y
          // registrarlo como activo: auditable en la biblioteca y reutilizable.
          const buffers = new Map<string, { idActivo: string; buffer: AudioBuffer }>();
          for (const colocacion of plan.activas) {
            const { efecto } = colocacion;
            if (!buffers.has(efecto.id)) {
              contexto.reportarProgreso(0.3, `Cargando el efecto «${efecto.nombre}»…`);
              try {
                const respuesta = await fetch(efecto.ruta, { signal: contexto.senal });
                if (!respuesta.ok) {
                  throw new Error(`HTTP ${respuesta.status}`);
                }
                const bytes = new Uint8Array(await respuesta.arrayBuffer());
                const meta = await contexto.servicios.activos.poner(
                  new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' }),
                  {
                    nombre: `SFX — ${efecto.nombre}.wav`,
                    mime: 'audio/wav',
                    duracionMs: null,
                    tasaMuestreo: null,
                    canales: null,
                    bytes: bytes.byteLength,
                    origen: 'nodo',
                  },
                );
                const buffer = await contexto.servicios.audio.decodificar(meta.id, contexto.senal);
                buffers.set(efecto.id, { idActivo: meta.id, buffer });
              } catch (causa) {
                if (causa instanceof ErrorConfiguracion) throw causa;
                throw new ErrorConfiguracion(
                  {
                    codigo: 'SFX_ARCHIVO_INACCESIBLE',
                    mensaje: `No se pudo cargar el efecto "${efecto.nombre}" desde ${efecto.ruta}.`,
                    mensajeUsuario:
                      `El archivo del efecto «${efecto.nombre}» no está accesible (${efecto.ruta}). ` +
                      'Comprueba que exista en packages/app/public/sfx/ o ajusta la configuración.',
                    reintentable: false,
                  },
                  causa instanceof Error ? causa : undefined,
                );
              }
            }
            const cargado = buffers.get(efecto.id)!;
            elementos.push({
              buffer: cargado.buffer,
              inicioMs: colocacion.enMs,
              duracionMs: Math.round(cargado.buffer.duration * 1000),
              offsetMs: 0,
              gananciaDb:
                (entrada.parametros.gananciaSfxDb as number) + (efecto.gananciaDb ?? 0),
              fundidoEntradaMs: 10,
              fundidoSalidaMs: Math.round(Math.min(120, cargado.buffer.duration * 500)),
            });
          }
        }

        const resultado = await renderizarAActivo(
          { elementos, duracionTotalMs: duracionVozMs },
          'Narración con efectos.wav',
          contexto,
          0.45,
          1,
        );

        // Dato de colocaciones para el inspector (revisable sin puertas).
        const datoColocaciones = await datos.registrar(TIPO_DATO_COLOCACIONES, {
          tipoDato: TIPO_DATO_COLOCACIONES,
          idTranscripcion: dato.idDato,
          colocaciones: plan.colocaciones.map((c) => ({
            indicePalabra: c.indicePalabra,
            efecto: c.efecto.id,
            nombre: c.efecto.nombre,
            palabra: c.palabra,
            enMs: c.enMs,
            activa: c.activa,
          })),
          desplazamientoMs: entrada.parametros.desplazamientoMs as number,
        });

        return {
          salidas: {
            mezcla: { tipo: 'audio', idActivo: resultado.idActivo },
            colocaciones: { tipo: 'dato', idDato: datoColocaciones.idDato, tipoDato: TIPO_DATO_COLOCACIONES },
          },
        };
      },
    }),
  };
}
