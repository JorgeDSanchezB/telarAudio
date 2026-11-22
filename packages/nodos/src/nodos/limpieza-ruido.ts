/**
 * Nodo "Limpieza de ruido" (nodo PESADO, runtime backend): delega en el
 * backend opcional FastAPI, que aplica FFmpeg (afftdn o arnndn/RNNoise).
 *
 * Regla de arquitectura híbrida: el cliente NUNCA intenta ejecutar este nodo
 * en el navegador. Si el backend no está disponible, el nodo falla con un
 * error de configuración cuyo mensaje explica cómo arrancarlo.
 */

import { ErrorConfiguracion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';

export const CAPACIDAD_LIMPIEZA_RUIDO = 'limpieza-ruido';

export function crearDefinicionLimpiezaRuido(): DefinicionNodo {
  return {
    tipo: 'limpieza-ruido',
    version: '1.0.0',
    etiqueta: 'Limpieza de ruido',
    descripcion:
      'Reduce el ruido de fondo de una narración con FFmpeg (filtro afftdn o modelo RNNoise arnndn). Se ejecuta en el backend Python local: arrácalo desde la carpeta backend/ (ver README) y este nodo lo usará automáticamente.',
    categoria: 'limpieza',
    runtime: 'backend',
    capacidadBackend: CAPACIDAD_LIMPIEZA_RUIDO,
    entradas: [{ clave: 'entrada', etiqueta: 'Audio con ruido', tipo: 'audio', requerida: true }],
    salidas: [{ clave: 'salida', etiqueta: 'Audio limpio', tipo: 'audio' }],
    parametros: [
      {
        tipo: 'opcion',
        clave: 'intensidad',
        etiqueta: 'Intensidad',
        defecto: 'media',
        opciones: [
          { valor: 'ligera', etiqueta: 'Ligera' },
          { valor: 'media', etiqueta: 'Media' },
          { valor: 'fuerte', etiqueta: 'Fuerte' },
        ],
        descripcion: 'Cuánta reducción de ruido aplica el filtro.',
      },
      {
        tipo: 'opcion',
        clave: 'filtro',
        etiqueta: 'Filtro',
        defecto: 'afftdn',
        opciones: [
          { valor: 'afftdn', etiqueta: 'afftdn (sin modelo, siempre disponible)' },
          { valor: 'arnndn', etiqueta: 'arnndn (RNNoise, requiere modelo en el backend)' },
        ],
        descripcion: 'affftn usa el reductor FFT incluido en FFmpeg; arnndn usa una red neuronal RNNoise con modelo entrenado.',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'BACKEND_NO_CONFIGURADO',
        categoria: 'configuracion',
        descripcion: 'La sesión se inició sin cliente de backend (no debería ocurrir con la app completa).',
        reintentable: false,
      },
      {
        codigo: 'BACKEND_NO_DISPONIBLE',
        categoria: 'configuracion',
        descripcion: 'El backend local no está arrancado o no responde.',
        reintentable: false,
      },
      {
        codigo: 'CAPACIDAD_NO_DISPONIBLE',
        categoria: 'configuracion',
        descripcion: 'El backend está arriba pero no ofrece la capacidad de limpieza de ruido (¿versión antigua?).',
        reintentable: false,
      },
      {
        codigo: 'LIMPIEZA_SIN_ENTRADA',
        categoria: 'configuracion',
        descripcion: 'No hay audio conectado a la entrada.',
        reintentable: false,
      },
      {
        codigo: 'ERROR_TEMPORAL_BACKEND',
        categoria: 'temporal',
        descripcion: 'El backend falló de forma transitoria (red ocupada, 429, 503). Reintentable.',
        reintentable: true,
      },
      {
        codigo: 'MODELO_RNNOISE_AUSENTE',
        categoria: 'configuracion',
        descripcion: 'El filtro arnndn necesita un modelo .rnnn que el backend no tiene configurado.',
        reintentable: false,
      },
    ],
    crearProcesador: () => ({
      ejecutar: async (entrada, contexto) => {
        const backend = contexto.servicios.backend;
        if (!backend) {
          throw new ErrorConfiguracion({
            codigo: 'BACKEND_NO_CONFIGURADO',
            mensaje: 'No hay cliente de backend en esta sesión.',
            mensajeUsuario:
              'La limpieza de ruido se ejecuta en el backend Python local, que no está activo. Arráncalo con: cd backend && uvicorn app.main:app --port 8000 (pasos exactos en el README, sección "Backend opcional").',
            reintentable: false,
          });
        }

        contexto.reportarProgreso(0.02, 'Comprobando el backend local…');
        const capacidad = await backend.verificar();
        if (!capacidad.disponible) {
          throw new ErrorConfiguracion({
            codigo: 'BACKEND_NO_DISPONIBLE',
            mensaje: `El backend no está disponible: ${capacidad.detalle ?? 'sin detalle'}`,
            mensajeUsuario:
              'El backend local no responde. Arranca el servidor con "uvicorn app.main:app --port 8000" desde la carpeta backend/ y vuelve a ejecutar el grafo.',
            reintentable: false,
          });
        }
        if (!(capacidad.capacidades ?? []).includes(CAPACIDAD_LIMPIEZA_RUIDO)) {
          throw new ErrorConfiguracion({
            codigo: 'CAPACIDAD_NO_DISPONIBLE',
            mensaje: `El backend no ofrece la capacidad ${CAPACIDAD_LIMPIEZA_RUIDO}.`,
            mensajeUsuario:
              'El backend está activo pero no ofrece limpieza de ruido. Actualiza el backend a la versión de este repositorio.',
            reintentable: false,
          });
        }

        const valorEntrada = entrada.entradas.entrada?.[0];
        if (!valorEntrada || valorEntrada.tipo !== 'audio') {
          throw new ErrorConfiguracion({
            codigo: 'LIMPIEZA_SIN_ENTRADA',
            mensaje: 'El nodo de limpieza necesita una entrada de audio.',
            mensajeUsuario: 'Conecta un audio a la entrada del nodo de limpieza.',
            reintentable: false,
          });
        }

        contexto.registrar(
          'Ejecutando limpieza de ruido en el BACKEND local (FFmpeg): el audio se envía a 127.0.0.1 y el resultado vuelve a esta biblioteca.',
        );
        const { idActivoSalida } = await backend.ejecutarNodo({
          capacidad: CAPACIDAD_LIMPIEZA_RUIDO,
          idActivoEntrada: valorEntrada.idActivo,
          parametrosNodo: {
            intensidad: entrada.parametros.intensidad,
            filtro: entrada.parametros.filtro,
          },
          onProgreso: (fraccion, mensaje) => {
            contexto.reportarProgreso(0.05 + fraccion * 0.94, mensaje);
          },
          senal: contexto.senal,
        });
        return { salidas: { salida: { tipo: 'audio', idActivo: idActivoSalida } } };
      },
    }),
  };
}
