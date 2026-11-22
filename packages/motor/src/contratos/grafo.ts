/**
 * Modelo del grafo: instancias de nodos y aristas (el "documento del grafo").
 *
 * Cumple la convención de entidades del proyecto: identificador UUID y marca
 * temporal de creación (`creadoEn`, ms desde epoch).
 */

export type IdNodo = string;
export type IdArista = string;

/** Instancia de un nodo dentro del grafo de un proyecto. */
export interface InstanciaNodo {
  /** UUID v4. */
  id: IdNodo;
  /** Tipo registrado al que pertenece (referencia a `DefinicionNodo.tipo`). */
  tipo: string;
  /** Parámetros crudos tal cual los guardó el usuario; se validan al editar y al ejecutar. */
  parametros: Record<string, unknown>;
  /** Posición en el lienzo. Solo la UI la usa; el motor la ignora. */
  posicion: { x: number; y: number };
  /** Un nodo desactivado no se computa y bloquea a sus dependientes. */
  desactivado: boolean;
  creadoEn: number;
}

/** Conexión entre un puerto de salida y un puerto de entrada. */
export interface Arista {
  id: IdArista;
  /** Puerto de salida de origen. */
  origen: { nodo: IdNodo; puerto: string };
  /** Puerto de entrada de destino. */
  destino: { nodo: IdNodo; puerto: string };
  /**
   * Clave de orden para puertos de entrada `ordenado` (p. ej. el orden de
   * fusión de audios). Opcional: sin ella se conserva el orden de creación.
   */
  orden?: number;
  creadoEn: number;
}

/** Documento serializable del grafo de un proyecto. */
export interface DocumentoGrafo {
  version: 1;
  nodos: InstanciaNodo[];
  aristas: Arista[];
}
