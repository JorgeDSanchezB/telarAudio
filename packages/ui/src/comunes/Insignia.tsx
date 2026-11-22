'use client';

/**
 * Insignia de estado de un nodo del DAG (nomenclatura compartida con el motor).
 */

import type { EstadoNodo } from '@telar/motor';

const ETIQUETAS: Record<EstadoNodo, string> = {
  inactivo: 'Inactivo',
  bloqueado: 'Bloqueado',
  'en-cola': 'En cola',
  ejecutando: 'Ejecutando',
  listo: 'Listo',
  cacheado: 'En caché',
  error: 'Error',
  cancelado: 'Cancelado',
  desactivado: 'Desactivado',
};

export function InsigniaEstado({ estado, motivoBloqueo }: { estado: EstadoNodo; motivoBloqueo?: string }) {
  const clase = `tlr-insignia tlr-insignia-${estado}`;
  const titulo = motivoBloqueo ? `Bloqueado: ${motivoBloqueo}` : undefined;
  return (
    <span className={clase} title={titulo}>
      {ETIQUETAS[estado]}
    </span>
  );
}
