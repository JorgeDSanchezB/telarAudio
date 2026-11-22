'use client';

/**
 * Tarjeta de nodo del lienzo: cabecera con estado, puertos con sus handles,
 * resumen de parámetros, barra de progreso y acciones rápidas.
 * Es un nodo personalizado de React Flow: presentación pura sobre el estado
 * que le pasa el lienzo (que a su vez lo recibe del almacén de la app).
 */

import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Fragment } from 'react';
import type { MetadatosActivo } from '@telar/motor';
import { InsigniaEstado } from '../comunes/Insignia';
import { Icono } from '../comunes/Icono';
import type { AccionNodo, NodoFlujo } from '../tipos';

function resumenParametros(definicion: NodoFlujo['data']['definicion'], instancia: NodoFlujo['data']['instancia'], activos: MetadatosActivo[]): React.ReactNode[] {
  const partes: React.ReactNode[] = [];
  for (const parametro of definicion.parametros.slice(0, 2)) {
    const valor = instancia.parametros[parametro.clave];
    if (valor === undefined) {
      continue;
    }
    const etiqueta = parametro.etiqueta;
    let texto: string;
    if (parametro.tipo === 'booleano') {
      texto = valor ? 'sí' : 'no';
    } else if (parametro.tipo === 'numero' && typeof valor === 'number') {
      texto = `${valor}${parametro.unidad ? ` ${parametro.unidad}` : ''}`;
    } else if (parametro.tipo === 'opcion') {
      const opcion = parametro.opciones.find((o) => o.valor === valor);
      texto = opcion?.etiqueta ?? String(valor);
    } else if (parametro.tipo === 'activo') {
      /* el nombre real del archivo (corto), no un «elegido» sin contexto */
      const meta = typeof valor === 'string' ? activos.find((a) => a.id === valor) : undefined;
      texto = meta ? nombreCorto(meta.nombre) : 'sin elegir';
    } else {
      texto = String(valor);
    }
    partes.push(
      <span key={parametro.clave} title={`${etiqueta}: ${texto}`}>
        <span className="tlr-param-clave">{etiqueta}: </span>
        <span className="tlr-param-valor">{texto}</span>
      </span>,
    );
  }
  return partes;
}

/** Nombre legible y acotado para la tarjeta: quita extensión y recorta. */
function nombreCorto(nombre: string): string {
  const sinExtension = nombre.replace(/\.[a-z0-9]+$/i, '');
  return sinExtension.length > 26 ? `${sinExtension.slice(0, 25)}…` : sinExtension;
}

export function TarjetaNodo({ data }: NodeProps<NodoFlujo>) {
  const { instancia, definicion, estado, seleccionada, enEjecucion, bloqueada, activos, onAccion } = data;
  const detalle = estado;
  const progreso = detalle?.progreso;
  const resumen = resumenParametros(definicion, instancia, activos);
  const tieneSalidaAudio = definicion.salidas.some((s) => s.tipo === 'audio');
  const puedeDescargar =
    tieneSalidaAudio && (detalle?.estado === 'listo' || detalle?.estado === 'cacheado');

  const clases = [
    'tlr-nodo',
    seleccionada ? 'tlr-nodo-seleccionada' : '',
    instancia.desactivado ? 'tlr-nodo-desactivado' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={clases}
      data-categoria={definicion.categoria}
      data-estado={detalle?.estado}
    >
      <div className="tlr-nodo-cabecera">
        <span className="tlr-nodo-titulo" title={definicion.etiqueta}>
          <span className="tlr-nodo-punto" />
          <span className="tlr-nodo-etiqueta">{definicion.etiqueta}</span>
          {bloqueada ? (
            <span className="tlr-chip tlr-chip-revisar" title="Hay parámetros sin completar: ábrelo y revísalos">
              <Icono nombre="alerta" tamaño={10} />
              revisar
            </span>
          ) : null}
          {definicion.runtime === 'backend' ? (
            <span className="tlr-chip" title="Este nodo se ejecuta en el backend local">
              <Icono nombre="cpu" tamaño={10} />
              backend
            </span>
          ) : null}
        </span>
        <InsigniaEstado estado={detalle?.estado ?? 'inactivo'} motivoBloqueo={detalle?.motivoBloqueo} />
      </div>

      <div className="tlr-nodo-cuerpo">
        <div className="tlr-nodo-params">
          {resumen.length > 0
            ? resumen.map((parte, indice) => (
                <Fragment key={indice}>
                  {indice > 0 ? <span className="tlr-param-clave"> · </span> : null}
                  {parte}
                </Fragment>
              ))
            : 'Sin parámetros'}
        </div>

        {enEjecucion && typeof progreso === 'number' ? (
          <div
            className="tlr-nodo-progreso"
            role="progressbar"
            aria-valuenow={Math.round(progreso * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div style={{ width: `${Math.min(100, Math.max(0, progreso * 100))}%` }} />
          </div>
        ) : null}

        {detalle?.mensajeProgreso && enEjecucion ? (
          <div className="tlr-nodo-mensaje" title={detalle.mensajeProgreso}>
            {detalle.mensajeProgreso}
          </div>
        ) : null}

        {detalle?.error ? <div className="tlr-nodo-error">{detalle.error.mensajeUsuario}</div> : null}

        <div className="tlr-nodo-acciones">
          <button
            type="button"
            className="tlr-boton tlr-boton-mini"
            title={
              bloqueada
                ? 'Arregla primero los parámetros marcados (abre el nodo)'
                : 'Ejecutar este nodo (y lo que falte para su salida)'
            }
            disabled={enEjecucion || instancia.desactivado || bloqueada}
            onClick={(evento) => {
              evento.stopPropagation();
              onAccion(instancia.id, 'ejecutar');
            }}
          >
            <Icono nombre="reproducir" tamaño={11} />
            Ejecutar
          </button>
          {detalle?.estado === 'error' ? (
            <button
              type="button"
              className="tlr-boton tlr-boton-mini"
              title="Reintentar este nodo y su rama"
              disabled={enEjecucion}
              onClick={(evento) => {
                evento.stopPropagation();
                onAccion(instancia.id, 'reintentar');
              }}
            >
              <Icono nombre="reintentar" tamaño={11} />
              Reintentar
            </button>
          ) : null}
          {puedeDescargar ? (
            <button
              type="button"
              className="tlr-boton tlr-boton-mini"
              title="Descargar el WAV de la salida de este nodo"
              onClick={(evento) => {
                evento.stopPropagation();
                onAccion(instancia.id, 'descargar');
              }}
            >
              <Icono nombre="descargar" tamaño={11} />
              Descargar
            </button>
          ) : null}
        </div>
      </div>

      {definicion.entradas.length > 0 ? (
        <div className="tlr-puertos">
          {definicion.entradas.map((puerto) => (
            <div key={puerto.clave} className="tlr-puerto tlr-puerto-entrada">
              <Handle
                id={puerto.clave}
                type="target"
                position={Position.Left}
                style={{ top: 'auto', bottom: 'auto', left: -7 }}
              />
              {puerto.etiqueta}
              {puerto.multiple ? <span className="tlr-chip">múltiple</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {definicion.salidas.length > 0 ? (
        <div className="tlr-puertos">
          {definicion.salidas.map((puerto) => (
            <div key={puerto.clave} className="tlr-puerto tlr-puerto-salida">
              {puerto.etiqueta}
              <Handle
                id={puerto.clave}
                type="source"
                position={Position.Right}
                style={{ top: 'auto', bottom: 'auto', right: -7 }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
