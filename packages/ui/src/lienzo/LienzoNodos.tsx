'use client';

/**
 * Lienzo de nodos: React Flow conectado al estado del grafo de la aplicación.
 *
 * El lienzo es presentación pura: recibe instancias, aristas y estados del
 * motor por props y comunica interacciones hacia arriba (conectar, mover,
 * eliminar, soltar desde la paleta, acciones por nodo). Toda la lógica vive
 * en la app; nada de red ni de motor aquí.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../estilos/telar.css';
import { TarjetaNodo } from './TarjetaNodo';
import { Marca } from '../comunes/Marca';
import { Icono } from '../comunes/Icono';
import type { AccionNodo, NodoFlujo } from '../tipos';
import type { Arista, DefinicionNodo, EstadoNodoDetalle, InstanciaNodo, MetadatosActivo, ReferenciaPuerto } from '@telar/motor';
import { validarValoresParametros } from '@telar/motor';
import type { Edge } from '@xyflow/react';

export interface PropsLienzoNodos {
  definiciones: Map<string, DefinicionNodo>;
  instancias: InstanciaNodo[];
  aristas: Arista[];
  estados: Record<string, EstadoNodoDetalle | undefined>;
  idSeleccionado: string | null;
  enEjecucion: boolean;
  onAñadirNodo: (tipo: string, posicion: { x: number; y: number }) => void;
  onConectar: (conexion: { origen: ReferenciaPuerto; destino: ReferenciaPuerto }) => void;
  onMoverNodo: (idNodo: string, posicion: { x: number; y: number }) => void;
  onEliminarNodos: (ids: string[]) => void;
  onEliminarAristas: (ids: string[]) => void;
  onSeleccionar: (idNodo: string | null) => void;
  onAccionNodo: (idNodo: string, accion: AccionNodo) => void;
  /** Opcional: monta un grafo de ejemplo desde el estado vacío. */
  onCargarEjemplo?: () => void;
  /** Activos de la sesión: para mostrar el archivo elegido en cada tarjeta. */
  activos: MetadatosActivo[];
}

const TIPOS_NODO = { 'telar-nodo': TarjetaNodo };

/** Color del hilo de cada categoría, para el minimapa. */
const COLOR_CATEGORIA: Record<string, string> = {
  fuente: '#56bcae',
  limpieza: '#a48fd8',
  edicion: '#e2a24a',
  enriquecimiento: '#e07a8b',
  salida: '#a9c25b',
};

function LienzoInterno(props: PropsLienzoNodos) {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const nodosInicializados = useNodesInitialized();

  /**
   * Selección de React Flow (incluye multiselección con Mayús): se mantiene
   * aquí porque es estado de presentación. Es lo que la tecla Suprimir/
   * Retroceso borra (deleteKeyCode de ReactFlow). Los nodos que se pasan al
   * lienzo son controlados: sin este conjunto, cada re-render recrearía los
   * objetos sin `selected` y la selección interna se perdería, dejando la
   * tecla de borrado sin efecto.
   */
  const [seleccionFlujo, setSeleccionFlujo] = useState<ReadonlySet<string>>(new Set());

  /**
   * Reencuadra el grafo al (des)seleccionar un nodo y cuando llega material
   * nuevo al lienzo (añadir / cargar ejemplo). Se espera a que React Flow
   * tenga las medidas de los nodos (useNodesInitialized) para que el encuadre
   * sea el real y no el del estado anterior.
   */
  useEffect(() => {
    if (!nodosInicializados || props.instancias.length === 0) {
      return;
    }
    fitView({ padding: 0.22, duration: 360, maxZoom: 1.05 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodosInicializados, props.idSeleccionado, props.instancias.length]);

  const nodos: NodoFlujo[] = useMemo(
    () =>
      props.instancias.map((instancia) => {
        const definicion = props.definiciones.get(instancia.tipo);
        if (!definicion) {
          throw new Error(`Tipo de nodo no registrado: ${instancia.tipo}`);
        }
        return {
          id: instancia.id,
          type: 'telar-nodo' as const,
          position: instancia.posicion,
          selected: seleccionFlujo.has(instancia.id),
          data: {
            instancia,
            definicion,
            estado: props.estados[instancia.id],
            seleccionada: props.idSeleccionado === instancia.id,
            enEjecucion: props.enEjecucion,
            bloqueada: !validarValoresParametros(definicion.parametros, instancia.parametros).ok,
            activos: props.activos,
            onAccion: props.onAccionNodo,
          },
        };
      }),
    [props.instancias, props.definiciones, props.estados, props.idSeleccionado, props.enEjecucion, props.onAccionNodo, props.activos, seleccionFlujo],
  );

  // Mientras el grafo se ejecuta, las aristas se vuelven «hilos en movimiento».
  // Las aristas del nodo seleccionado se encienden: la selección se lee en el
  // conjunto (nodo + sus conexiones), no solo en el borde de la tarjeta.
  const aristasFlujo: Edge[] = useMemo(
    () =>
      props.aristas.map((arista) => {
        const conectadaAlSeleccionado =
          props.idSeleccionado !== null &&
          (arista.origen.nodo === props.idSeleccionado || arista.destino.nodo === props.idSeleccionado);
        return {
          id: arista.id,
          source: arista.origen.nodo,
          sourceHandle: arista.origen.puerto,
          target: arista.destino.nodo,
          targetHandle: arista.destino.puerto,
          type: 'default',
          animated: props.enEjecucion,
          selected: conectadaAlSeleccionado,
        };
      }),
    [props.aristas, props.enEjecucion, props.idSeleccionado],
  );

  const onDrop = useCallback(
    (evento: React.DragEvent) => {
      evento.preventDefault();
      const tipo = evento.dataTransfer.getData('application/telar-tipo-nodo');
      if (!tipo) {
        return;
      }
      const posicion = screenToFlowPosition({ x: evento.clientX, y: evento.clientY });
      props.onAñadirNodo(tipo, posicion);
    },
    [props, screenToFlowPosition],
  );

  return (
    <div
      className="tlr-lienzo"
      data-testid="lienzo-nodos"
      onDrop={onDrop}
      onDragOver={(evento) => {
        evento.preventDefault();
        evento.dataTransfer.dropEffect = 'copy';
      }}
    >
      {props.instancias.length === 0 ? (
        <div className="tlr-lienzo-vacio">
          <div className="tlr-lienzo-vacio-inner">
            <Marca tamaño={56} />
            <div className="tlr-onda-viva" aria-hidden="true">
              <span /><span /><span /><span /><span /><span /><span />
            </div>
            <div className="tlr-lienzo-vacio-titulo">El lienzo está vacío</div>
            <div className="tlr-lienzo-vacio-sub">
              Arrastra un nodo desde la paleta — o haz clic en él — para empezar a tejer tu narración.
            </div>
            <div className="tlr-lienzo-vacio-pista" aria-hidden="true">
              <span>arrastrar</span>
              <span style={{ opacity: 0.5 }}>o</span>
              <kbd>clic</kbd>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>los nodos se conectan por sus puertos</span>
            </div>
            {props.onCargarEjemplo ? (
              <button type="button" className="tlr-boton tlr-boton-primario" onClick={props.onCargarEjemplo}>
                <Icono nombre="reproducir" tamaño={13} />
                Cargar narración de ejemplo
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <ReactFlow
        nodes={nodos}
        edges={aristasFlujo}
        nodeTypes={TIPOS_NODO}
        fitView
        minZoom={0.2}
        maxZoom={2}
        onNodeClick={(_, nodo) => props.onSeleccionar(nodo.id)}
        onPaneClick={() => props.onSeleccionar(null)}
        onNodeDragStop={(_, nodo) => props.onMoverNodo(nodo.id, nodo.position)}
        onNodesChange={(cambios) => {
          // Solo los cambios de selección: posición y borrado llegan por sus
          // callbacks dedicados y el estado del grafo vive en la app.
          const seleccion = cambios.getByType('select');
          if (seleccion.length === 0) {
            return;
          }
          setSeleccionFlujo((previa) => {
            const nueva = new Set(previa);
            for (const cambio of seleccion) {
              if (cambio.selected) {
                nueva.add(cambio.id);
              } else {
                nueva.delete(cambio.id);
              }
            }
            return nueva;
          });
        }}
        onNodesDelete={(nodosBorrados) => {
          setSeleccionFlujo((previa) => {
            const nueva = new Set(previa);
            for (const nodo of nodosBorrados) {
              nueva.delete(nodo.id);
            }
            return nueva;
          });
          props.onEliminarNodos(nodosBorrados.map((n) => n.id));
        }}
        onEdgesDelete={(aristasBorradas) => props.onEliminarAristas(aristasBorradas.map((a) => a.id))}
        onConnect={(conexion) => {
          if (!conexion.source || !conexion.target || !conexion.sourceHandle || !conexion.targetHandle) {
            return;
          }
          props.onConectar({
            origen: { nodo: conexion.source, puerto: conexion.sourceHandle },
            destino: { nodo: conexion.target, puerto: conexion.targetHandle },
          });
        }}
        deleteKeyCode={['Delete', 'Backspace']}
      >
        {/* trama de telar: cruz suave en lugar de puntos sueltos */}
        <Background
          variant={BackgroundVariant.Cross}
          gap={30}
          size={1}
          lineWidth={1}
          color="rgba(237, 231, 223, 0.09)"
        />
        {props.instancias.length > 0 ? (
          <>
            <Controls showInteractive={false} position="top-left" orientation="horizontal" />
            <MiniMap
              pannable
              zoomable
              /* el minimapa dibuja las tarjetas como son: oscuras con el
                 hilo de su categoría en el contorno (no bloques de color) */
              nodeColor={() => '#241f26'}
              nodeStrokeColor={(nodo) =>
                COLOR_CATEGORIA[(nodo as NodoFlujo).data?.definicion?.categoria] ?? '#6b5f6d'
              }
              nodeStrokeWidth={1.5}
              nodeBorderRadius={3}
              maskColor="rgba(12, 10, 13, 0.72)"
            />
          </>
        ) : null}
      </ReactFlow>
    </div>
  );
}

export function LienzoNodos(props: PropsLienzoNodos) {
  return (
    <ReactFlowProvider>
      <LienzoInterno {...props} />
    </ReactFlowProvider>
  );
}
