'use client';

/**
 * Página del estudio: composición de todos los organismos (topbar, panel
 * izquierdo con paleta/biblioteca, lienzo de nodos + inspector o editor de
 * línea de tiempo, barra de estado y avisos). La lógica vive en el almacén;
 * aquí solo se cablea.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { DefinicionNodo, DatoRegistrado } from '@telar/motor';
import { useAlmacen } from '../estado/almacen';
import { Avisos } from './Avisos';
import { BibliotecaActivos } from './BibliotecaActivos';
import { DatosSesion } from './DatosSesion';
import { VisoresDatos } from './VisoresDatos';
import { FronteraError, Icono, Inspector, LienzoNodos, Marca, PaletaNodos } from '@telar/ui';
import type { ConexionEntrante } from '@telar/ui';
import { EditorLineaTiempo } from '@telar/ui';

export function Estudio() {
  const estudio = useAlmacen((estado) => estado.estudio);
  const errorInicio = useAlmacen((estado) => estado.errorInicio);
  const inicializar = useAlmacen((estado) => estado.inicializar);

  const instancias = useAlmacen((estado) => estado.instancias);
  const aristas = useAlmacen((estado) => estado.aristas);
  const estadosNodos = useAlmacen((estado) => estado.estadosNodos);
  const idSeleccionado = useAlmacen((estado) => estado.idSeleccionado);
  const ejecutando = useAlmacen((estado) => estado.ejecutando);
  const ultimoInforme = useAlmacen((estado) => estado.ultimoInforme);

  const activos = useAlmacen((estado) => estado.activos);
  const pistas = useAlmacen((estado) => estado.pistas);
  const puedeDeshacer = useAlmacen((estado) => estado.puedeDeshacer);
  const puedeRehacer = useAlmacen((estado) => estado.puedeRehacer);
  const ocupadoLineaTiempo = useAlmacen((estado) => estado.ocupadoLineaTiempo);
  const errorLineaTiempo = useAlmacen((estado) => estado.errorLineaTiempo);

  const estadoBackend = useAlmacen((estado) => estado.estadoBackend);
  const verificarBackend = useAlmacen((estado) => estado.verificarBackend);
  const versionDatos = useAlmacen((estado) => estado.versionDatos);
  const revisarDato = useAlmacen((estado) => estado.revisarDato);

  const pestañaIzquierda = useAlmacen((estado) => estado.pestañaIzquierda);
  const pestañaPrincipal = useAlmacen((estado) => estado.pestañaPrincipal);
  const fijarPestañaIzquierda = useAlmacen((estado) => estado.fijarPestañaIzquierda);
  const fijarPestañaPrincipal = useAlmacen((estado) => estado.fijarPestañaPrincipal);

  const añadirNodo = useAlmacen((estado) => estado.añadirNodo);
  const cargarEjemplo = useAlmacen((estado) => estado.cargarEjemplo);
  const conectar = useAlmacen((estado) => estado.conectar);
  const moverNodo = useAlmacen((estado) => estado.moverNodo);
  const eliminarNodos = useAlmacen((estado) => estado.eliminarNodos);
  const eliminarAristas = useAlmacen((estado) => estado.eliminarAristas);
  const seleccionar = useAlmacen((estado) => estado.seleccionar);
  const cambiarParametro = useAlmacen((estado) => estado.cambiarParametro);
  const reordenarEntrada = useAlmacen((estado) => estado.reordenarEntrada);
  const accionNodo = useAlmacen((estado) => estado.accionNodo);
  const ejecutarGrafo = useAlmacen((estado) => estado.ejecutarGrafo);
  const cancelarEjecucion = useAlmacen((estado) => estado.cancelarEjecucion);

  const subirArchivos = useAlmacen((estado) => estado.subirArchivos);
  const ocupadoMp3 = useAlmacen((estado) => estado.ocupadoMp3);
  const eliminarActivo = useAlmacen((estado) => estado.eliminarActivo);
  const descargarActivo = useAlmacen((estado) => estado.descargarActivo);
  const exportarActivoMp3 = useAlmacen((estado) => estado.exportarActivoMp3);

  const guardarProyecto = useAlmacen((estado) => estado.guardarProyecto);
  const cargarProyecto = useAlmacen((estado) => estado.cargarProyecto);
  const ocupadoProyecto = useAlmacen((estado) => estado.ocupadoProyecto);
  const entradaProyecto = useRef<HTMLInputElement>(null);

  const pistasEditadasDesdeMotor = useAlmacen((estado) => estado.pistasEditadasDesdeMotor);
  const eliminarPistaDeTiempo = useAlmacen((estado) => estado.eliminarPistaDeTiempo);
  const deshacerLineaTiempo = useAlmacen((estado) => estado.deshacerLineaTiempo);
  const rehacerLineaTiempo = useAlmacen((estado) => estado.rehacerLineaTiempo);
  const eliminarRegion = useAlmacen((estado) => estado.eliminarRegion);
  const mezclarYExportar = useAlmacen((estado) => estado.mezclarYExportar);

  useEffect(() => {
    inicializar();
  }, [inicializar]);

  /** Pluralización correcta en español para los contadores del pie. */
  const plural = (n: number, singular: string, pluralPalabra: string) =>
    `${n} ${n === 1 ? singular : pluralPalabra}`;

  const definicionesMap = useMemo(() => {
    const mapa = new Map<string, DefinicionNodo>();
    if (!estudio) {
      return mapa;
    }
    for (const definicion of estudio.registro.listar()) {
      mapa.set(definicion.tipo, definicion);
    }
    return mapa;
  }, [estudio]);

  const seleccionado = useMemo(
    () => instancias.find((instancia) => instancia.id === idSeleccionado) ?? null,
    [instancias, idSeleccionado],
  );

  /* Datos de la sesión para el panel «Datos» y para saber si hay algo que
   * guardar. La lista del registro no es reactiva: los cambios llegan por
   * versionDatos (revisión/carga) y ultimoInforme (fin de ejecución). */
  const datosSesion = useMemo<DatoRegistrado[]>(
    () => estudio?.datos.listar() ?? [],
    [estudio, versionDatos, ultimoInforme],
  );
  const hayParaGuardar = pistas.length > 0 || datosSesion.length > 0;

  const conexionesEntrantes = useMemo<ConexionEntrante[]>(() => {
    if (!seleccionado || !estudio) {
      return [];
    }
    const etiquetaDeNodo = (idNodo: string): string => {
      const instancia = instancias.find((i) => i.id === idNodo);
      const definicion = instancia ? definicionesMap.get(instancia.tipo) : undefined;
      return definicion?.etiqueta ?? idNodo.slice(0, 8);
    };
    return aristas
      .filter((arista) => arista.destino.nodo === seleccionado.id)
      .map((arista) => ({
        aristaId: arista.id,
        puerto: arista.destino.puerto,
        etiquetaOrigen: etiquetaDeNodo(arista.origen.nodo),
        orden: arista.orden,
      }));
  }, [aristas, definicionesMap, instancias, seleccionado, estudio]);

  if (errorInicio) {
    return (
      <div className="tlr-frontera" style={{ maxWidth: 640, margin: '80px auto' }}>
        <h2>Telar no pudo arrancar</h2>
        <p>{errorInicio}</p>
        <p style={{ color: 'var(--tlr-texto-suave)', fontSize: 13 }}>
          Revisa el archivo de configuración de la aplicación (packages/app/src/config/config.default.json)
          y recarga la página.
        </p>
      </div>
    );
  }

  if (!estudio) {
    return (
      <div className="tlr-cargando">
        <div className="tlr-cargando-inner">
          <Marca tamaño={44} />
          <div className="tlr-hilandero" aria-hidden="true" />
          <div className="tlr-cargando-texto">Montando el telar…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tlr-estudio">
      <header className="tlr-topbar">
        <span className="tlr-marca">
          <Marca tamaño={25} />
          <span className="tlr-marca-nombre">Telar</span>
          <span className="tlr-marca-tag">postproducción de narración</span>
        </span>
        <span className="tlr-topbar-separador" aria-hidden="true" />
        <span
          className="tlr-pill-estado"
          title={
            estadoBackend?.disponible
              ? `Backend local v${estadoBackend.version ?? '?'} · capacidades: ${estadoBackend.capacidades.join(', ')}`
              : (estadoBackend?.detalle ?? 'Comprobar el backend opcional')
          }
        >
          <span className={`tlr-punto ${estadoBackend?.disponible ? 'tlr-punto-activo' : 'tlr-punto-inactivo'}`} />
          {estadoBackend?.disponible
            ? `backend local · v${estadoBackend.version ?? '?'} · ${estadoBackend.capacidades.length} servicios`
            : 'backend local inactivo · solo nodos de navegador'}
        </span>
        <button
          type="button"
          className="tlr-boton tlr-boton-mini"
          onClick={() => void verificarBackend()}
          title="Volver a comprobar la conexión con el backend local"
        >
          <Icono nombre="reintentar" tamaño={11} />
          Comprobar
        </button>
        <span style={{ flex: 1 }} />
        <input
          ref={entradaProyecto}
          type="file"
          accept=".telar.json,application/json"
          style={{ display: 'none' }}
          onChange={(evento) => {
            const archivo = evento.target.files?.[0];
            if (archivo) {
              void cargarProyecto(archivo);
            }
            evento.target.value = '';
          }}
        />
        <button
          type="button"
          className="tlr-boton tlr-boton-mini"
          onClick={() => void guardarProyecto()}
          disabled={ocupadoProyecto || !hayParaGuardar}
          title={
            hayParaGuardar
              ? 'Guarda la línea de tiempo (con su audio) y las transcripciones/datos en un archivo .telar.json'
              : 'Nada que guardar: la línea de tiempo y los datos están vacíos'
          }
          data-testid="guardar-proyecto"
        >
          <Icono nombre="disco" tamaño={12} />
          {ocupadoProyecto ? 'Guardando…' : 'Guardar'}
        </button>
        <button
          type="button"
          className="tlr-boton tlr-boton-mini"
          onClick={() => entradaProyecto.current?.click()}
          disabled={ocupadoProyecto}
          title="Carga un proyecto .telar.json guardado: restaura la línea de tiempo (con su audio) y las transcripciones/datos"
          data-testid="abrir-proyecto"
        >
          <Icono nombre="abrir" tamaño={12} />
          {ocupadoProyecto ? 'Cargando…' : 'Abrir'}
        </button>
        <button
          type="button"
          className={`tlr-boton tlr-boton-primario ${ejecutando ? 'tlr-boton-ejecutando' : ''}`}
          onClick={() => void ejecutarGrafo()}
          disabled={ejecutando || instancias.length === 0}
          title={
            instancias.length === 0
              ? 'El grafo está vacío: añade nodos desde la paleta o carga el ejemplo'
              : 'Teje el grafo completo: ejecuta cada nodo en orden y reutiliza la caché'
          }
          data-testid="ejecutar-grafo"
        >
          <Icono nombre={ejecutando ? 'rayo' : 'reproducir'} tamaño={13} />
          {ejecutando ? 'Tejiendo…' : 'Ejecutar grafo'}
        </button>
        {ejecutando ? (
          <button type="button" className="tlr-boton tlr-boton-peligro" onClick={cancelarEjecucion}>
            <Icono nombre="detener" tamaño={13} />
            Detener
          </button>
        ) : null}
      </header>

      <div className="tlr-panel-central">
        <div className="tlr-pestanas" role="tablist" aria-label="Panel izquierdo">
          <button
            type="button"
            role="tab"
            aria-selected={pestañaIzquierda === 'paleta'}
            onClick={() => fijarPestañaIzquierda('paleta')}
          >
            <Icono nombre="nodos" tamaño={13} />
            <span>Nodos</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pestañaIzquierda === 'biblioteca'}
            onClick={() => fijarPestañaIzquierda('biblioteca')}
          >
            <Icono nombre="carpeta" tamaño={13} />
            <span>Biblioteca</span>
            <span className="tlr-pestanas-cuenta">{activos.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pestañaIzquierda === 'datos'}
            onClick={() => fijarPestañaIzquierda('datos')}
            title="Transcripciones y datos de la sesión (se guardan y cargan con el proyecto)"
          >
            <Icono nombre="capas" tamaño={13} />
            <span>Datos</span>
            {datosSesion.length > 0 ? (
              <span className="tlr-pestanas-cuenta">{datosSesion.length}</span>
            ) : null}
          </button>
        </div>
        <div className="tlr-pestanas-contenido">
          {pestañaIzquierda === 'paleta' ? (
            <PaletaNodos definiciones={estudio.registro.listar()} onAñadir={(tipo) => añadirNodo(tipo)} />
          ) : pestañaIzquierda === 'biblioteca' ? (
            <BibliotecaActivos
              activos={activos}
              ocupadoMp3={ocupadoMp3}
              onSubir={(archivos) => {
                void subirArchivos([...archivos]);
              }}
              onDescargar={descargarActivo}
              onExportarMp3={(id) => void exportarActivoMp3(id)}
              onEliminar={eliminarActivo}
            />
          ) : (
            <DatosSesion
              datos={datosSesion}
              registro={estudio.datos}
              catalogoMuletillas={estudio.config.catalogos.muletillas}
              onRevisar={revisarDato}
            />
          )}
        </div>
      </div>

      <main className="tlr-panel-principal">
        <div className="tlr-pestanas tlr-pestanas-principal" role="tablist" aria-label="Área principal">
          <button
            type="button"
            role="tab"
            aria-selected={pestañaPrincipal === 'grafo'}
            onClick={() => fijarPestañaPrincipal('grafo')}
          >
            <Icono nombre="grafo" tamaño={13} />
            <span>Grafo de nodos</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={pestañaPrincipal === 'linea-tiempo'}
            onClick={() => fijarPestañaPrincipal('linea-tiempo')}
          >
            <Icono nombre="onda" tamaño={13} />
            <span>Línea de tiempo</span>
        {pistas.length > 0 ? (
          <span className="tlr-pestanas-cuenta">{pistas.length}</span>
        ) : null}
          </button>
        </div>
        {pestañaPrincipal === 'grafo' ? (
          <div className={`tlr-zona-lienzo ${seleccionado ? 'tlr-zona-lienzo-con-inspector' : ''}`}>
            <LienzoNodos
              definiciones={definicionesMap}
              instancias={instancias}
              aristas={aristas}
              estados={estadosNodos}
              idSeleccionado={idSeleccionado}
              enEjecucion={ejecutando}
              onAñadirNodo={(tipo, posicion) => añadirNodo(tipo, posicion)}
              onConectar={conectar}
              onMoverNodo={moverNodo}
              onEliminarNodos={eliminarNodos}
              onEliminarAristas={eliminarAristas}
              onSeleccionar={seleccionar}
              onAccionNodo={accionNodo}
              onCargarEjemplo={cargarEjemplo}
              activos={activos}
            />
            {seleccionado ? (
              <FronteraError titulo="El inspector falló">
                <Inspector
                  definicion={definicionesMap.get(seleccionado.tipo)!}
                  instancia={seleccionado}
                  estado={estadosNodos[seleccionado.id]}
                  activos={activos}
                  conexionesEntrantes={conexionesEntrantes}
                  onCerrar={() => seleccionar(null)}
                  onCambiarParametro={(clave, valor) => cambiarParametro(seleccionado.id, clave, valor)}
                  onAccion={accionNodo}
                  onReordenarEntrada={reordenarEntrada}
                  visoresDatos={
                    estudio ? (
                      <VisoresDatos
                        salida={estudio.motor.salidaDe(seleccionado.id)}
                        datos={estudio.datos}
                        catalogoMuletillas={estudio.config.catalogos.muletillas}
                        onRevisar={revisarDato}
                      />
                    ) : null
                  }
                />
              </FronteraError>
            ) : null}
          </div>
        ) : (
          <FronteraError titulo="El editor de línea de tiempo falló">
            <EditorLineaTiempo
              pistas={pistas}
              onPistasCambio={pistasEditadasDesdeMotor}
              onEliminarPista={eliminarPistaDeTiempo}
              puedeDeshacer={puedeDeshacer}
              puedeRehacer={puedeRehacer}
              onDeshacer={deshacerLineaTiempo}
              onRehacer={rehacerLineaTiempo}
              onEliminarRegion={(pistaId, desde, hasta) => void eliminarRegion(pistaId, desde, hasta)}
              onMezclarExportar={() => void mezclarYExportar()}
              ocupado={ocupadoLineaTiempo}
              errorCarga={errorLineaTiempo}
              onIrAGrafo={() => fijarPestañaPrincipal('grafo')}
            />
          </FronteraError>
        )}
      </main>

      <footer className="tlr-estado">
        {ejecutando ? (
          <span className="tlr-estado-vivo">tejiendo el grafo…</span>
        ) : (
          <span>listo</span>
        )}
        {ultimoInforme ? (
          <>
            <span className="tlr-estado-separador">·</span>
            <span>
              última ejecución · {ultimoInforme.resumen.ejecutados} ejecutados · {ultimoInforme.resumen.cacheados} caché ·
              {' '}{ultimoInforme.resumen.omitidos} desactivados · {ultimoInforme.resumen.bloqueados} bloqueados ·
              {' '}{ultimoInforme.resumen.errores} errores · {ultimoInforme.duracionTotalMs} ms
            </span>
          </>
        ) : (
          <>
            <span className="tlr-estado-separador">·</span>
            <span>sin ejecuciones todavía</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <span className="tlr-estado-contadores">
          {plural(instancias.length, 'nodo', 'nodos')} · {plural(aristas.length, 'conexión', 'conexiones')} ·{' '}
          {plural(activos.length, 'archivo en biblioteca', 'archivos en biblioteca')}
        </span>
      </footer>

      <Avisos />
    </div>
  );
}
