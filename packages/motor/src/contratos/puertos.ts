/**
 * Contratos de puertos de un nodo: por dónde entra y sale la información.
 *
 * Los valores que circulan por las aristas son referencias (no los datos en
 * bruto): activos de audio direccionados por contenido o datos estructurados.
 * Así las salidas se pueden cachear y compartir sin copiar memoria.
 */

/** Tipo de dato que puede circular por un puerto. */
export type TipoPuerto = 'audio' | 'dato';

export interface DefinicionPuerto {
  /** Identificador del puerto. Debe cumplir `^[a-z][a-zA-Z0-9]*$`. */
  clave: string;
  /** Etiqueta visible en la UI. */
  etiqueta: string;
  tipo: TipoPuerto;
  descripcion?: string;
  /** Solo en entradas: admite varias aristas simultáneas (p. ej. fusión). */
  multiple?: boolean;
  /**
   * Solo en entradas múltiples: las aristas se ordenan por el campo `orden`
   * de la arista. Imprescindible para la fusión secuencial de audios.
   */
  ordenado?: boolean;
  /**
   * Solo en entradas: si es `true` (por defecto), el nodo no puede ejecutarse
   * sin al menos una arista conectada a este puerto.
   */
  requerida?: boolean;
  /**
   * Contrato v1.1: subtipo de dato esperado cuando `tipo === 'dato'`
   * (p. ej. 'transcripcion/v1'). En entradas declara lo que el nodo consume;
   * en salidas, lo que emite. Si ambos extremos de una arista lo declaran,
   * deben coincidir (validado al conectar). Opcional para no romper los
   * contratos v1.0 existentes.
   */
  tipoDato?: string;
}

/** Referencia a un puerto concreto de un nodo concreto del grafo. */
export interface ReferenciaPuerto {
  nodo: string;
  puerto: string;
}

/**
 * Valor que viaja por una arista. Unión cerrada y extensible por versión del
 * contrato: los nodos de análisis (pendientes) emitirán valores `dato`.
 */
export type ValorPuerto =
  | { tipo: 'audio'; idActivo: string }
  | { tipo: 'dato'; idDato: string; tipoDato: string };

export function esValorAudio(valor: ValorPuerto): valor is { tipo: 'audio'; idActivo: string } {
  return valor.tipo === 'audio';
}

/**
 * Extrae el valor `dato` de una lista de entradas comprobando el subtipo
 * (contrato v1.1). Devuelve undefined si el puerto no llega conectado y
 * lanza nada: la comprobación de compatibilidad es responsabilidad de quien
 * llama (los nodos la convierten en su modo de fallo DATO_INCOMPATIBLE).
 */
export function esValorDato(
  valor: ValorPuerto,
): valor is { tipo: 'dato'; idDato: string; tipoDato: string } {
  return valor.tipo === 'dato' && typeof valor.idDato === 'string' && typeof valor.tipoDato === 'string';
}
