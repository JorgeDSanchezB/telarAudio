/**
 * Utilidades compartidas por los nodos que consumen datos (contrato v1.1):
 * resolver el valor de un puerto `dato`, validarlo contra el subtipo esperado
 * y convertir el fallo en el modo DATO_INCOMPATIBLE del nodo.
 */

import { ErrorConfiguracion, ErrorValidacion } from '@telar/motor';
import type { ValorPuerto } from '@telar/motor';
import type { ContextoProcesador } from '@telar/motor';

export interface DatoResuelto {
  idDato: string;
  tipoDato: string;
  contenido: unknown;
}

/**
 * Resuelve el primer valor de un puerto dato. Lanza ErrorConfiguracion si no
 * hay servicio de datos (sesión sin almacén de datos) o ErrorValidacion
 * DATO_INCOMPATIBLE si el subtipo no es el esperado.
 */
export function resolverDato(
  contexto: ContextoProcesador,
  valores: ValorPuerto[],
  tipoEsperado: string,
  etiquetaNodo: string,
): DatoResuelto {
  const datos = contexto.servicios.datos;
  if (!datos) {
    throw new ErrorConfiguracion({
      codigo: 'ALMACEN_DATOS_NO_CONFIGURADO',
      mensaje: 'La sesión no tiene almacén de datos (ServicioRegistroDatos).',
      mensajeUsuario:
        'Esta sesión no puede trabajar con datos de análisis. Reinicia la aplicación y repórtalo si persiste.',
      reintentable: false,
    });
  }
  const valor = valores[0];
  if (!valor || valor.tipo !== 'dato') {
    throw new ErrorValidacion({
      codigo: 'DATO_INCOMPATIBLE',
      mensaje: `${etiquetaNodo} necesita un dato de tipo "${tipoEsperado}" en la entrada.`,
      mensajeUsuario:
        `Conecta una salida de datos "${tipoEsperado}" (p. ej. la transcripción de su nodo) a la entrada de este nodo.`,
      reintentable: false,
    });
  }
  if (valor.tipoDato !== tipoEsperado) {
    throw new ErrorValidacion({
      codigo: 'DATO_INCOMPATIBLE',
      mensaje: `La entrada recibió "${valor.tipoDato}" pero ${etiquetaNodo} espera "${tipoEsperado}".`,
      mensajeUsuario: `Esa conexión trae datos "${valor.tipoDato}" y este nodo necesita "${tipoEsperado}".`,
      reintentable: false,
    });
  }
  const dato = datos.obtener(valor.idDato);
  if (!dato) {
    throw new ErrorConfiguracion({
      codigo: 'DATO_NO_ENCONTRADO',
      mensaje: `El dato ${valor.idDato} ya no está en el almacén de la sesión.`,
      mensajeUsuario: 'El dato de entrada ya no existe (¿se reinició la sesión?). Vuelve a ejecutar el nodo origen.',
      reintentable: false,
    });
  }
  return { idDato: valor.idDato, tipoDato: dato.tipoDato, contenido: dato.contenido };
}
