/**
 * Tipos compartidos de la UI de Telar (presentación pura: nada de estado
 * global aquí; todo entra por props desde la aplicación).
 */

import type { Node } from '@xyflow/react';
import type { DefinicionNodo, EstadoNodoDetalle, InstanciaNodo, MetadatosActivo } from '@telar/motor';

export type AccionNodo =
  | 'ejecutar'
  | 'reintentar'
  | 'invalidar'
  | 'alternar-desactivado'
  | 'enviar-linea-tiempo'
  | 'descargar';

export interface DatosTarjetaNodo extends Record<string, unknown> {
  instancia: InstanciaNodo;
  definicion: DefinicionNodo;
  estado?: EstadoNodoDetalle;
  seleccionada: boolean;
  enEjecucion: boolean;
  /** Validación de parámetros ya falla: los botones de ejecución se desactivan. */
  bloqueada: boolean;
  /** Activos de la sesión: nombre real del archivo elegido en nodos fuente. */
  activos: MetadatosActivo[];
  onAccion: (idNodo: string, accion: AccionNodo) => void;
}

export type NodoFlujo = Node<DatosTarjetaNodo, 'telar-nodo'>;

export const ETIQUETAS_CATEGORIA: Record<string, string> = {
  fuente: 'Fuentes',
  limpieza: 'Limpieza',
  edicion: 'Edición',
  enriquecimiento: 'Enriquecimiento',
  salida: 'Salida',
};
