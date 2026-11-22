/**
 * Configuración del motor, validada al construirlo (cero hardcoding: cada
 * límite vive aquí y tiene un rango comprobado).
 */

import { ErrorConfiguracion } from '../errores';

export interface ConfigMotor {
  /** Nodos que pueden ejecutarse en paralelo. 1 = secuencial. */
  maxConcurrencia: number;
  /** Activa la reutilización de resultados intermedios por clave de caché. */
  cacheResultados: boolean;
  /** Tamaño máximo del LRU de resultados cacheados. */
  maxResultadosCache: number;
  /** Tiempo máximo de ejecución de un nodo antes de abortarlo. */
  timeoutNodoMs: number;
}

export const CONFIG_DEFECTO_MOTOR: ConfigMotor = {
  maxConcurrencia: 3,
  cacheResultados: true,
  maxResultadosCache: 64,
  timeoutNodoMs: 10 * 60 * 1000,
};

const RANGOS_NUMERICOS: Record<'maxConcurrencia' | 'maxResultadosCache' | 'timeoutNodoMs', { min: number; max: number }> = {
  maxConcurrencia: { min: 1, max: 16 },
  maxResultadosCache: { min: 1, max: 1024 },
  timeoutNodoMs: { min: 1000, max: 60 * 60 * 1000 },
};

/**
 * Valida y completa una configuración parcial. Falla rápido con
 * `ErrorConfiguracion` si algún valor está fuera de rango: una configuración
 * inválida no se degrada en silencio.
 */
export function validarConfigMotor(parcial: Partial<ConfigMotor> | undefined): ConfigMotor {
  const config: ConfigMotor = { ...CONFIG_DEFECTO_MOTOR, ...parcial };
  if (typeof config.cacheResultados !== 'boolean') {
    throw new ErrorConfiguracion({
      codigo: 'CONFIG_MOTOR_INVALIDA',
      mensaje: `El campo "cacheResultados" debe ser booleano (recibido: ${String(config.cacheResultados)}).`,
      mensajeUsuario: 'La configuración del motor contiene un valor inválido. Revisa la configuración de la aplicación.',
      reintentable: false,
    });
  }
  for (const clave of Object.keys(RANGOS_NUMERICOS) as (keyof typeof RANGOS_NUMERICOS)[]) {
    const valor = config[clave];
    const rango = RANGOS_NUMERICOS[clave];
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < rango.min || valor > rango.max) {
      throw new ErrorConfiguracion({
        codigo: 'CONFIG_MOTOR_INVALIDA',
        mensaje: `El campo "${clave}" debe ser un número entre ${rango.min} y ${rango.max} (recibido: ${String(valor)}).`,
        mensajeUsuario: 'La configuración del motor contiene un valor fuera de rango. Revisa la configuración de la aplicación.',
        reintentable: false,
      });
    }
  }
  return config;
}
