'use client';

/**
 * Pila de avisos (toasts) con clasificación por categoría de error y cierre.
 */

import { useAlmacen } from '../estado/almacen';
import { Icono } from '@telar/ui';
import type { NombreIcono } from '@telar/ui';

const ICONO_CATEGORIA: Record<string, NombreIcono> = {
  validacion: 'alerta',
  temporal: 'info',
  configuracion: 'alerta',
  autorizacion: 'fallo',
  critico: 'fallo',
  exito: 'exito',
};

export function Avisos() {
  const avisos = useAlmacen((estado) => estado.avisos);
  const cerrarAviso = useAlmacen((estado) => estado.cerrarAviso);

  if (avisos.length === 0) {
    return null;
  }
  return (
    <div className="tlr-avisos" role="status" aria-live="polite" data-testid="avisos">
      {avisos.map((aviso) => (
        <div key={aviso.id} className={`tlr-aviso tlr-aviso-${aviso.categoria}`}>
          <span className="tlr-aviso-icono">
            <Icono nombre={ICONO_CATEGORIA[aviso.categoria] ?? 'info'} tamaño={15} />
          </span>
          <div className="tlr-aviso-cuerpo">
            <div className="tlr-aviso-titulo">{aviso.titulo}</div>
            {aviso.detalle ? <div className="tlr-aviso-detalle">{aviso.detalle}</div> : null}
            {aviso.acciones && aviso.acciones.length > 0 ? (
              <div className="tlr-aviso-acciones">
                {aviso.acciones.map((accion) => (
                  <button
                    key={accion.etiqueta}
                    type="button"
                    className="tlr-boton tlr-boton-mini"
                    onClick={() => {
                      accion.alPulsar();
                      cerrarAviso(aviso.id);
                    }}
                  >
                    {accion.etiqueta}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="tlr-aviso-cerrar"
            aria-label="Cerrar aviso"
            onClick={() => cerrarAviso(aviso.id)}
          >
            <Icono nombre="cerrar" tamaño={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
