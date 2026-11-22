'use client';

/**
 * Inspector de nodo: formulario generado DINÁMICAMENTE a partir de la
 * especificación de parámetros del contrato (Fase 4 + Fase 5), con validación
 * en vivo, entradas conectadas (reordenable en puertos ordenados), modos de
 * fallo documentados y acciones del nodo.
 */

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { validarValoresParametros } from '@telar/motor';
import type {
  DefinicionNodo,
  EstadoNodoDetalle,
  InstanciaNodo,
  MetadatosActivo,
  ValorParametro,
} from '@telar/motor';
import { InsigniaEstado } from '../comunes/Insignia';
import { Icono } from '../comunes/Icono';
import type { AccionNodo } from '../tipos';

export interface ConexionEntrante {
  aristaId: string;
  puerto: string;
  etiquetaOrigen: string;
  orden?: number;
}

export interface PropsInspector {
  definicion: DefinicionNodo;
  instancia: InstanciaNodo;
  estado?: EstadoNodoDetalle;
  activos: MetadatosActivo[];
  conexionesEntrantes: ConexionEntrante[];
  onCambiarParametro: (clave: string, valor: ValorParametro) => void;
  onAccion: (idNodo: string, accion: AccionNodo) => void;
  onReordenarEntrada: (aristaId: string, direccion: -1 | 1) => void;
  /** Cierra el inspector (deselecciona el nodo). Opcional. */
  onCerrar?: () => void;
  /**
   * Visores de datos de salida del nodo (transcripción, curva de tensión,
   * colocaciones…): la app los construye según el tipo de dato y los
   * inyecta aquí; el inspector permanece agnóstico del dominio.
   */
  visoresDatos?: ReactNode;
}

export function Inspector(props: PropsInspector) {
  const { definicion, instancia, estado, activos, conexionesEntrantes } = props;

  const validacion = useMemo(
    () => validarValoresParametros(definicion.parametros, instancia.parametros),
    [definicion, instancia],
  );
  const erroresPorClave = new Map<string, string>();
  if (!validacion.ok) {
    for (const fallo of validacion.errores) {
      if (!erroresPorClave.has(fallo.clave)) {
        erroresPorClave.set(fallo.clave, fallo.mensaje);
      }
    }
  }

  const puertosOrdenados = definicion.entradas.filter((p) => p.ordenado);
  const valor = (clave: string): unknown => instancia.parametros[clave];

  return (
    <aside
      className="tlr-inspector"
      data-testid="inspector"
      data-categoria={definicion.categoria}
      aria-label={`Inspector de ${definicion.etiqueta}`}
    >
      <div className="tlr-inspector-cabecera">
        <div className="tlr-inspector-cabecera-textos">
          <h2>
            <span className="tlr-nodo-punto" />
            {definicion.etiqueta}
          </h2>
          <p className="tlr-inspector-desc" title={definicion.descripcion}>
            {definicion.descripcion}
          </p>
          <div className="tlr-inspector-meta">
            <InsigniaEstado estado={estado?.estado ?? 'inactivo'} motivoBloqueo={estado?.motivoBloqueo} />
            <span className="tlr-chip">
              <Icono nombre={definicion.runtime === 'backend' ? 'cpu' : 'rayo'} tamaño={10} />
              {definicion.runtime === 'backend' ? 'backend local' : 'en tu navegador'}
            </span>
            <span className="tlr-chip">contrato v{definicion.version}</span>
          </div>
        </div>
        {props.onCerrar ? (
          <button
            type="button"
            className="tlr-inspector-cerrar"
            aria-label="Cerrar inspector"
            title="Cerrar (deseleccionar nodo)"
            onClick={props.onCerrar}
          >
            <Icono nombre="cerrar" tamaño={14} />
          </button>
        ) : null}
      </div>

      {estado?.error ? (
        <div className="tlr-seccion">
          <h3>Último fallo</h3>
          <div className="tlr-nodo-error" style={{ marginBottom: 8 }}>
            <strong>{estado.error.mensajeUsuario}</strong>
          </div>
          <div className="tlr-nodo-mensaje" style={{ marginBottom: 8 }}>
            Código {estado.error.codigo} · categoría {estado.error.categoria}
          </div>
          <button
            type="button"
            className="tlr-boton tlr-boton-mini"
            onClick={() => props.onAccion(instancia.id, 'reintentar')}
          >
            <Icono nombre="reintentar" tamaño={11} />
            Reintentar este nodo
          </button>
        </div>
      ) : null}

      {definicion.parametros.length > 0 ? (
        <div className="tlr-seccion">
          <h3>Parámetros</h3>
          {definicion.parametros.map((parametro) => {
            const errorCampo = erroresPorClave.get(parametro.clave);
            return (
              <div className="tlr-campo" key={parametro.clave}>
                <label htmlFor={`param-${parametro.clave}`}>
                  {parametro.etiqueta}
                  {'unidad' in parametro && parametro.unidad ? ` (${parametro.unidad})` : ''}
                </label>
                {parametro.tipo === 'numero' ? (
                  <input
                    id={`param-${parametro.clave}`}
                    type="number"
                    min={parametro.min}
                    max={parametro.max}
                    step={parametro.paso}
                    placeholder={String(parametro.defecto)}
                    value={typeof valor(parametro.clave) === 'number' ? (valor(parametro.clave) as number) : ''}
                    onChange={(evento) => {
                      const numero = evento.target.valueAsNumber;
                      props.onCambiarParametro(parametro.clave, Number.isFinite(numero) ? numero : parametro.defecto);
                    }}
                  />
                ) : null}
                {parametro.tipo === 'booleano' ? (
                  <input
                    id={`param-${parametro.clave}`}
                    type="checkbox"
                    checked={valor(parametro.clave) === true}
                    onChange={(evento) => props.onCambiarParametro(parametro.clave, evento.target.checked)}
                  />
                ) : null}
                {parametro.tipo === 'opcion' ? (
                  <select
                    id={`param-${parametro.clave}`}
                    value={typeof valor(parametro.clave) === 'string' ? (valor(parametro.clave) as string) : parametro.defecto}
                    onChange={(evento) => props.onCambiarParametro(parametro.clave, evento.target.value)}
                  >
                    {parametro.opciones.map((opcion) => (
                      <option key={opcion.valor} value={opcion.valor}>
                        {opcion.etiqueta}
                      </option>
                    ))}
                  </select>
                ) : null}
                {parametro.tipo === 'activo' ? (
                  <select
                    id={`param-${parametro.clave}`}
                    value={typeof valor(parametro.clave) === 'string' ? (valor(parametro.clave) as string) : ''}
                    onChange={(evento) => props.onCambiarParametro(parametro.clave, evento.target.value)}
                  >
                    <option value="">Elige un archivo de la biblioteca…</option>
                    {activos.map((activo) => (
                      <option key={activo.id} value={activo.id}>
                        {activo.nombre}
                        {activo.duracionMs !== null ? ` (${(activo.duracionMs / 1000).toFixed(1)} s)` : ''}
                      </option>
                    ))}
                  </select>
                ) : null}
                {parametro.descripcion ? (
                  <span className="tlr-inspector-desc" style={{ margin: 0 }}>
                    {parametro.descripcion}
                  </span>
                ) : null}
                {errorCampo ? <span className="tlr-campo-error">{errorCampo}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {props.visoresDatos ? (
        <div className="tlr-seccion" data-testid="visores-datos">
          {props.visoresDatos}
        </div>
      ) : null}

      {puertosOrdenados.length > 0 ? (
        <div className="tlr-seccion">
          <h3>Orden de entradas</h3>
          {puertosOrdenados.map((puerto) => {
            const conexiones = conexionesEntrantes
              .filter((c) => c.puerto === puerto.clave)
              .sort((a, b) => (a.orden ?? Number.MAX_SAFE_INTEGER) - (b.orden ?? Number.MAX_SAFE_INTEGER));
            return (
              <div key={puerto.clave} style={{ marginBottom: 10 }}>
                <div className="tlr-inspector-desc" style={{ margin: '0 0 6px' }}>
                  {puerto.etiqueta}: sube o baja cada conexión para fijar el orden.
                </div>
                <div className="tlr-lista-entradas">
                  {conexiones.length === 0 ? (
                    <span className="tlr-inspector-desc">Sin conexiones todavía.</span>
                  ) : null}
                  {conexiones.map((conexion, indice) => (
                    <div className="tlr-entrada-item" key={conexion.aristaId}>
                      <span>
                        {indice + 1}. {conexion.etiquetaOrigen}
                      </span>
                      <span style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="tlr-boton tlr-boton-icono"
                          aria-label="Subir en el orden"
                          disabled={indice === 0}
                          onClick={() => props.onReordenarEntrada(conexion.aristaId, -1)}
                        >
                          <Icono nombre="subir" tamaño={12} />
                        </button>
                        <button
                          type="button"
                          className="tlr-boton tlr-boton-icono"
                          aria-label="Bajar en el orden"
                          disabled={indice === conexiones.length - 1}
                          onClick={() => props.onReordenarEntrada(conexion.aristaId, 1)}
                        >
                          <Icono nombre="descargar" tamaño={12} />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="tlr-seccion">
        <h3>Acciones</h3>
        <div className="tlr-inspector-acciones">
          <button
            type="button"
            className="tlr-boton tlr-boton-mini tlr-boton-primario"
            onClick={() => props.onAccion(instancia.id, 'ejecutar')}
            disabled={validacion.ok === false}
            title={
              validacion.ok === false
                ? 'Hay parámetros con errores: arréglalos antes de ejecutar'
                : 'Ejecuta este nodo y todo lo que falte aguas arriba'
            }
          >
            <Icono nombre="reproducir" tamaño={11} />
            Ejecutar este nodo
          </button>
          <button type="button" className="tlr-boton tlr-boton-mini" onClick={() => props.onAccion(instancia.id, 'invalidar')}>
            <Icono nombre="cache" tamaño={11} />
            Invalidar caché
          </button>
          <button type="button" className="tlr-boton tlr-boton-mini" onClick={() => props.onAccion(instancia.id, 'alternar-desactivado')}>
            <Icono nombre="poder" tamaño={11} />
            {instancia.desactivado ? 'Activar' : 'Desactivar'}
          </button>
          <button
            type="button"
            className="tlr-boton tlr-boton-mini"
            title="Disponible cuando el nodo esté listo o en caché: ejecútalo primero"
            disabled={estado?.estado !== 'listo' && estado?.estado !== 'cacheado'}
            onClick={() => props.onAccion(instancia.id, 'enviar-linea-tiempo')}
          >
            <Icono nombre="enviar" tamaño={11} />
            A línea de tiempo
          </button>
          <button
            type="button"
            className="tlr-boton tlr-boton-mini"
            title="Disponible cuando el nodo esté listo o en caché: ejecútalo primero"
            disabled={estado?.estado !== 'listo' && estado?.estado !== 'cacheado'}
            onClick={() => props.onAccion(instancia.id, 'descargar')}
          >
            <Icono nombre="descargar" tamaño={11} />
            Descargar salida
          </button>
        </div>
      </div>

      <div className="tlr-seccion">
        <h3>
          Fallos posibles
          <span className="tlr-chip">{definicion.modosDeFallo.length}</span>
        </h3>
        <details>
          <summary>
            Contrato del nodo: {definicion.modosDeFallo.length}{' '}
            {definicion.modosDeFallo.length === 1 ? 'modo' : 'modos'} de fallo documentado
            {definicion.modosDeFallo.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {definicion.modosDeFallo.map((modo) => (
              <li key={modo.codigo}>
                <code>{modo.codigo}</code> ({modo.categoria}
                {modo.reintentable ? ', reintentable' : ''}): {modo.descripcion}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </aside>
  );
}
