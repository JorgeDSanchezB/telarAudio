/**
 * Contrato central de nodos: `DefinicionNodo` (el contrato declarativo) y
 * `AudioProcessor` (la parte ejecutable).
 *
 * Regla de extensibilidad del proyecto: añadir un nodo o una variante de nodo
 * compatible NO requiere tocar este archivo ni ningún archivo del núcleo del
 * motor. Basta con construir una `DefinicionNodo` y registrarla en un
 * `RegistroNodos`. El test `Motor.test.ts > extensibilidad` lo demuestra
 * registrando un nodo nuevo creado dentro del propio test.
 */

import type { CategoriaError, DetalleFallo } from '../errores';
import type { DefinicionPuerto, ValorPuerto } from './puertos';
import type { EspecificacionParametro, ValorParametro } from './params';
import type { InstanciaNodo } from './grafo';
import type { ServiciosMotor } from './servicios';

export type CategoriaNodo = 'fuente' | 'limpieza' | 'edicion' | 'enriquecimiento' | 'salida';

/**
 * Dónde se ejecuta el nodo. `backend` significa que el procesador delega en el
 * backend opcional mediante `ServiciosMotor.backend`; si no está disponible,
 * debe fallar con `ErrorConfiguracion` (nunca intentar ejecutarlo en el
 * navegador).
 */
export type RuntimeNodo = 'cliente' | 'backend';

/** Modo de fallo documentado del contrato de un nodo (se muestra en la UI). */
export interface ModoFallo {
  codigo: string;
  categoria: CategoriaError;
  descripcion: string;
  reintentable: boolean;
}

/**
 * Definición declarativa de un tipo de nodo. Es un POD salvo
 * `crearProcesador`: el resto se puede serializar y mostrar en la UI.
 */
export interface DefinicionNodo {
  /** Identificador del tipo. Debe cumplir `^[a-z][a-z0-9-]*$` y ser único en el registro. */
  tipo: string;
  /** Versión semver del CONTRATO (no de la implementación). Al cambiar puertos o parámetros, incrementa. */
  version: string;
  etiqueta: string;
  descripcion: string;
  categoria: CategoriaNodo;
  runtime: RuntimeNodo;
  /** Requerido si `runtime === 'backend'`: capacidad que debe anunciar el backend. */
  capacidadBackend?: string;
  entradas: DefinicionPuerto[];
  salidas: DefinicionPuerto[];
  parametros: EspecificacionParametro[];
  /** Modos de fallo que el nodo puede emitir, documentados para la persona usuaria. */
  modosDeFallo: ModoFallo[];
  /** Fábrica del procesador. El registro la invoca una vez por ejecución de nodo. */
  crearProcesador(): AudioProcessor;
}

/** Contexto de ejecución que el motor inyecta a cada procesador. */
export interface ContextoProcesador {
  servicios: ServiciosMotor;
  /** Señal de cancelación; los procesadores deben consultarla en sus await largos. */
  senal: AbortSignal;
  /** Progreso de 0 a 1 para reflejarlo en la UI. */
  reportarProgreso(fraccion: number, mensaje?: string): void;
  /** Registro de auditoría del nodo (aparece en la consola y en el log de la sesión). */
  registrar(mensaje: string): void;
}

/** Entrada tipada que el motor entrega al procesador. */
export interface EntradaEjecucion {
  nodo: InstanciaNodo;
  /** Parámetros ya validados y normalizados contra la especificación. */
  parametros: Record<string, ValorParametro>;
  /**
   * Valores entrantes por puerto. Cada entrada es un arreglo (vacío si el
   * puerto es opcional y no está conectado) ordenado por `orden` de arista
   * cuando el puerto lo declara.
   */
  entradas: Record<string, ValorPuerto[]>;
}

/** Salida que el procesador debe devolver. */
export interface SalidaEjecucion {
  /** Un valor por cada puerto de salida declarado. */
  salidas: Record<string, ValorPuerto>;
}

/**
 * Interfaz común que implementa cualquier nodo del DAG, independientemente de
 * su stack (Web Audio, ffmpeg.wasm o backend FastAPI).
 *
 * Contrato del procesador:
 *  - debe ser determinista: mismas entradas y parámetros producen la misma
 *    salida (la caché del motor depende de ello);
 *  - debe consultar `contexto.senal` antes de operaciones largas y abortar
 *    lanzando un error;
 *  - debe clasificar sus fallos con las subclases de `ErrorMotor`;
 *  - no debe capturar en silencio errores de sus dependencias.
 */
export interface AudioProcessor {
  ejecutar(entrada: EntradaEjecucion, contexto: ContextoProcesador): Promise<SalidaEjecucion>;
}

/** Utilidad para describir fallos en los procesadores sin repetir estructura. */
export function modoFallo(detalle: DetalleFallo, descripcion: string): ModoFallo {
  return {
    codigo: detalle.codigo,
    categoria: detalle.categoria,
    descripcion,
    reintentable: detalle.reintentable,
  };
}
