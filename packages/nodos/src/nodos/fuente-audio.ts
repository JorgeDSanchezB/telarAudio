/**
 * Nodo "Fuente de audio": introduce un activo de la biblioteca de la sesión
 * en el grafo. Es el punto de entrada de todo audio subido por el usuario.
 */

import { ErrorConfiguracion } from '@telar/motor';
import type { DefinicionNodo } from '@telar/motor';

export function crearDefinicionFuente(): DefinicionNodo {
  return {
    tipo: 'fuente-audio',
    version: '1.0.0',
    etiqueta: 'Fuente de audio',
    descripcion:
      'Introduce en el grafo un archivo de la biblioteca de audio de la sesión (subido por ti o generado por otro nodo).',
    categoria: 'fuente',
    runtime: 'cliente',
    entradas: [],
    salidas: [{ clave: 'salida', etiqueta: 'Audio', tipo: 'audio' }],
    parametros: [
      {
        tipo: 'activo',
        clave: 'archivo',
        etiqueta: 'Archivo de la biblioteca',
        formato: 'audio',
        defecto: '',
        descripcion: 'Activo de audio que este nodo pone a disposición del grafo.',
      },
    ],
    modosDeFallo: [
      {
        codigo: 'ACTIVO_NO_ENCONTRADO',
        categoria: 'configuracion',
        descripcion: 'El archivo elegido ya no está en la biblioteca (¿se eliminó o el proyecto es de otra sesión?).',
        reintentable: false,
      },
    ],
    crearProcesador: () => ({
      ejecutar: async (entrada, contexto) => {
        const idActivo = entrada.parametros.archivo as string;
        if (!contexto.servicios.activos.existe(idActivo)) {
          throw new ErrorConfiguracion({
            codigo: 'ACTIVO_NO_ENCONTRADO',
            mensaje: `El activo ${idActivo} no está en la biblioteca.`,
            mensajeUsuario:
              'El archivo de este nodo ya no está en la biblioteca. Vuelve a elegirlo en el inspector del nodo.',
            reintentable: false,
          });
        }
        return { salidas: { salida: { tipo: 'audio', idActivo } } };
      },
    }),
  };
}
