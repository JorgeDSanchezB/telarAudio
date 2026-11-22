/**
 * Almacén de estado de la aplicación (zustand).
 *
 * Decisión (ADR-007): zustand frente a Redux (boilerplate desproporcionado
 * para una app de una sola página) y frente a Context (re-renders difíciles
 * de controlar con eventos del motor a alta frecuencia). El estado del motor
 * vive FUERA de React: el motor emite eventos y el almacén proyecta solo lo
 * que la UI necesita (estados por nodo, informe, ejecutando).
 *
 * El grafo es UNA instancia de GrafoDag que se muta in-place (su API lo
 * valida todo) y que el motor referencia siempre: así las ediciones no
 * invalidan la caché del motor, cuyas claves dependen del contenido, no de
 * la identidad del objeto grafo.
 */

'use client';

import { create } from 'zustand';
import { GrafoDag } from '@telar/motor';
import type {
  Arista,
  CategoriaError,
  EstadoNodoDetalle,
  InformeEjecucion,
  InstanciaNodo,
  MetadatosActivo,
  ValorParametro,
} from '@telar/motor';
import { ErrorCancelacion, ErrorMotor, ErrorTemporal, ErrorValidacion } from '@telar/motor';
import type { AccionNodo } from '@telar/ui';
import { Historial } from '@telar/linea-tiempo';
import {
  crearPistaDesdeBuffer,
  eliminarPista,
  eliminarRangoDePista,
  planificarMezclaPistas,
  sustituirPista,
} from '@telar/linea-tiempo';
import type { PistaTelar } from '@telar/linea-tiempo';
import { codificarWav } from '@telar/nodos';
import { crearEstudio } from '../servicios/estudio';
import type { Estudio } from '../servicios/estudio';
import { descargarBlob } from '../servicios/exportacion';
import { cargarConfig } from '../config/cargarConfig';
import type { ConfigApp } from '../config/esquema';

export interface Aviso {
  id: string;
  titulo: string;
  detalle?: string;
  categoria: CategoriaError | 'exito';
  acciones?: { etiqueta: string; alPulsar: () => void }[];
}

export interface EstadoBackend {
  verificadoEn: number;
  disponible: boolean;
  version?: string;
  capacidades: string[];
  detalle?: string;
}

interface EstadoAlmacen {
  // arranque
  estudio: Estudio | null;
  config: ConfigApp | null;
  errorInicio: string | null;

  // grafo
  instancias: InstanciaNodo[];
  aristas: Arista[];
  estadosNodos: Record<string, EstadoNodoDetalle | undefined>;
  idSeleccionado: string | null;
  ejecutando: boolean;
  ultimoInforme: InformeEjecucion | null;

  // biblioteca
  activos: MetadatosActivo[];

  // línea de tiempo
  pistas: PistaTelar[];
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  ocupadoLineaTiempo: boolean;
  errorLineaTiempo: string | null;

  // backend
  estadoBackend: EstadoBackend | null;

  // UI
  pestañaIzquierda: 'paleta' | 'biblioteca';
  pestañaPrincipal: 'grafo' | 'linea-tiempo';
  avisos: Aviso[];

  // acciones
  inicializar: () => void;
  añadirNodo: (tipo: string, posicion?: { x: number; y: number }) => void;
  /** Monta un grafo de narración de ejemplo (Fuente → Ganancia → Fusión). */
  cargarEjemplo: () => void;
  conectar: (conexion: { origen: { nodo: string; puerto: string }; destino: { nodo: string; puerto: string } }) => void;
  moverNodo: (idNodo: string, posicion: { x: number; y: number }) => void;
  eliminarNodos: (ids: string[]) => void;
  eliminarAristas: (ids: string[]) => void;
  seleccionar: (idNodo: string | null) => void;
  cambiarParametro: (idNodo: string, clave: string, valor: ValorParametro) => void;
  reordenarEntrada: (aristaId: string, direccion: -1 | 1) => void;
  accionNodo: (idNodo: string, accion: AccionNodo) => void;
  ejecutarGrafo: () => Promise<void>;
  cancelarEjecucion: () => void;

  subirArchivo: (archivo: File) => Promise<void>;
  subirArchivos: (archivos: File[]) => Promise<void>;
  eliminarActivo: (idActivo: string) => void;
  descargarActivo: (idActivo: string) => void;
  exportarActivoMp3: (idActivo: string) => Promise<void>;
  ocupadoMp3: boolean;

  /** Datos de la sesión: contador de revisiones (para re-render de visores). */
  versionDatos: number;
  /** Revisa un dato (misma ranura) e invalida solo sus consumidores. */
  revisarDato: (idDato: string, contenido: unknown) => void;
  /** Importa a la biblioteca las pistas musicales del catálogo de ejemplo. */
  importarMusicaEjemplo: () => Promise<void>;

  enviarALineaTiempo: (idNodo: string) => void;
  pistasEditadasDesdeMotor: (pistas: PistaTelar[]) => void;
  eliminarPistaDeTiempo: (pistaId: string) => void;
  deshacerLineaTiempo: () => void;
  rehacerLineaTiempo: () => void;
  eliminarRegion: (pistaId: string, desdeMuestra: number, hastaMuestra: number) => Promise<void>;
  mezclarYExportar: () => Promise<void>;

  verificarBackend: () => Promise<void>;
  fijarPestañaIzquierda: (pestaña: 'paleta' | 'biblioteca') => void;
  fijarPestañaPrincipal: (pestaña: 'grafo' | 'linea-tiempo') => void;
  cerrarAviso: (id: string) => void;

  // internas (usadas por otras acciones del propio almacén)
  avisar: (aviso: Omit<Aviso, 'id'>) => void;
}

/** Grafo vivo de la sesión: una sola instancia, mutada con validación. */
let grafoActual: GrafoDag | null = null;
/** Historial de la línea de tiempo (una instancia por sesión). */
let historial: Historial<PistaTelar[]> | null = null;
/** Estado previo pendiente de apilar (ráfagas de ediciones del motor). */
let pendienteApilar: PistaTelar[] | null = null;
let temporizadorConfirmacion: ReturnType<typeof setTimeout> | null = null;
/** Contador para colocar nodos nuevos en cascada (sin solapes). */
let contadorPosicionNodo = 0;

function posicionCascada(): { x: number; y: number } {
  const columna = contadorPosicionNodo % 3;
  const fila = Math.floor(contadorPosicionNodo / 3);
  contadorPosicionNodo += 1;
  return { x: 60 + columna * 300, y: 40 + fila * 260 };
}

function avisoErrorDesdeMotor(error: unknown, acciones?: Aviso['acciones']): Omit<Aviso, 'id'> {
  if (error instanceof ErrorMotor) {
    return {
      titulo: error.detalle.mensajeUsuario,
      detalle: `${error.codigo} · ${error.detalle.categoria}${error.detalle.reintentable ? ' · reintentable' : ''}`,
      categoria: error.detalle.categoria,
      acciones,
    };
  }
  return {
    titulo: error instanceof Error ? error.message : String(error),
    categoria: 'critico',
    acciones,
  };
}

/**
 * Rescate de archivos que el navegador no decodifica (AMR, 3gp, WMA, ALAC…).
 *
 * Orden de intentos, pensado para que el rescate casi nunca dependa de la
 * descarga grande (~32 MB) del transcodificador del navegador:
 * 1) Si el backend local ya está verificado y ofrece "transcodificar": backend
 *    primero (subida pequeña + FFmpeg real, todo local y rápido).
 * 2) En caso contrario, ffmpeg.wasm en el navegador (offline; la primera vez
 *    descarga ~32 MB, con límite de tiempo ffmpegMp3.timeoutCargaMs).
 * 3) El que no se haya probado, como respaldo.
 *
 * Si FFmpeg real (backend) tampoco puede leer el archivo, el error es
 * definitivo (corrupto o no-audio): se informa sin rodeos en lugar de
 * encadenar reintentos.
 */
async function rescatarAWav(
  get: () => EstadoAlmacen,
  bytes: Uint8Array,
  nombre: string,
): Promise<Uint8Array> {
  const { estudio, estadoBackend } = get();
  if (!estudio) {
    throw new ErrorCancelacion();
  }
  const fallos: string[] = [];

  const intentarBackend = async (): Promise<Uint8Array> =>
    estudio.clienteBackend.transcodificarAWav({ bytes });
  const intentarWasm = async (): Promise<Uint8Array> => estudio.transcodificador.transcodificarAWav(bytes);

  const errorDefinitivoWasm = (error: unknown): boolean =>
    error instanceof ErrorMotor &&
    (error.codigo === 'TRANSCODIFICACION_FALLIDA' || error.codigo === 'TRANSCODIFICADOR_DESHABILITADO');
  const errorDefinitivoBackend = (error: unknown): boolean =>
    error instanceof ErrorTemporal && error.codigo === 'FFMPEG_FALLO';

  const etiquetaFallo = (origen: string, error: unknown): string =>
    `${origen}: ${error instanceof Error ? error.message : String(error)}`;

  const backendYaVerificado =
    estadoBackend?.disponible === true && estadoBackend.capacidades.includes('transcodificar');

  if (backendYaVerificado) {
    get().avisar({
      titulo: `«${nombre}»: códec no soportado por el navegador.`,
      detalle: 'Transcodificando a WAV con el backend local (FFmpeg)…',
      categoria: 'exito',
    });
    try {
      return await intentarBackend();
    } catch (error) {
      if (errorDefinitivoBackend(error)) {
        // FFmpeg real tampoco pudo leerlo: no es cosa del navegador.
        throw new ErrorValidacion({
          codigo: 'AUDIO_NO_DECODIFICABLE',
          mensaje: `Ni el navegador ni FFmpeg pudieron leer "${nombre}".`,
          mensajeUsuario:
            'Ese archivo no es un formato de audio reconocido (ni el navegador ni FFmpeg pudieron leerlo). Comprueba que no esté corrupto o que sea realmente un audio.',
          reintentable: false,
        });
      }
      fallos.push(etiquetaFallo('backend local', error));
    }
    if (estudio.transcodificador.disponible()) {
      get().avisar({
        titulo: 'El backend no pudo transcodificar; probando en el navegador.',
        detalle: 'Preparando ffmpeg.wasm (descarga única de ~32 MB si es la primera vez)…',
        categoria: 'temporal',
      });
      try {
        return await intentarWasm();
      } catch (error) {
        if (errorDefinitivoWasm(error)) {
          throw error;
        }
        fallos.push(etiquetaFallo('ffmpeg.wasm', error));
      }
    } else {
      fallos.push('ffmpeg.wasm no preparado (falta "npm run preparar:ffmpeg")');
    }
  } else {
    // Sin backend verificado: ffmpeg.wasm primero (todo en el navegador).
    if (estudio.transcodificador.disponible()) {
      get().avisar({
        titulo: `«${nombre}»: códec no soportado por el navegador.`,
        detalle:
          'Transcodificando a WAV en el navegador con ffmpeg.wasm (descarga única de ~32 MB si es la primera vez)…',
        categoria: 'exito',
      });
      try {
        return await intentarWasm();
      } catch (error) {
        if (errorDefinitivoWasm(error)) {
          // FFmpeg tampoco pudo leerlo (o está deshabilitado a propósito):
          // el backend procesaría exactamente los mismos bytes.
          throw error;
        }
        fallos.push(etiquetaFallo('ffmpeg.wasm', error));
      }
    } else {
      fallos.push('ffmpeg.wasm no preparado (falta "npm run preparar:ffmpeg")');
    }

    get().avisar({
      titulo: 'Probando el backend local para transcodificar…',
      detalle: 'El transcodificador del navegador no estuvo disponible.',
      categoria: 'temporal',
    });
    try {
      return await intentarBackend();
    } catch (error) {
      if (errorDefinitivoBackend(error)) {
        // FFmpeg real tampoco pudo leerlo: no es cosa del navegador.
        throw new ErrorValidacion({
          codigo: 'AUDIO_NO_DECODIFICABLE',
          mensaje: `Ni el navegador ni FFmpeg pudieron leer "${nombre}".`,
          mensajeUsuario:
            'Ese archivo no es un formato de audio reconocido (ni el navegador ni FFmpeg pudieron leerlo). Comprueba que no esté corrupto o que sea realmente un audio.',
          reintentable: false,
        });
      }
      fallos.push(etiquetaFallo('backend local', error));
    }
  }

  throw new ErrorValidacion({
    codigo: 'AUDIO_NO_DECODIFICABLE',
    mensaje: `No se pudo decodificar ni rescatar "${nombre}".`,
    mensajeUsuario:
      `«${nombre}» usa un códec que el navegador no soporta y la transcodificación automática también falló ` +
      `(${fallos.join(' · ')}). Activa ffmpeg.wasm ejecutando "npm run preparar:ffmpeg" en la raíz del proyecto ` +
      '(una sola vez) o arranca el backend local (uvicorn, ver README) y vuelve a subirlo.',
    reintentable: false,
  });
}

function confirmarPendiente(): void {
  if (temporizadorConfirmacion !== null) {
    clearTimeout(temporizadorConfirmacion);
    temporizadorConfirmacion = null;
  }
  if (pendienteApilar) {
    historial?.apilar(pendienteApilar);
    pendienteApilar = null;
    useAlmacen.setState({
      puedeDeshacer: historial?.puedeDeshacer() ?? false,
      puedeRehacer: historial?.puedeRehacer() ?? false,
    });
  }
}

export const useAlmacen = create<EstadoAlmacen>((set, get) => ({
  estudio: null,
  config: null,
  errorInicio: null,

  instancias: [],
  aristas: [],
  estadosNodos: {},
  idSeleccionado: null,
  ejecutando: false,
  ultimoInforme: null,

  activos: [],

  pistas: [],
  puedeDeshacer: false,
  puedeRehacer: false,
  ocupadoLineaTiempo: false,
  errorLineaTiempo: null,
  ocupadoMp3: false,

  estadoBackend: null,

  pestañaIzquierda: 'paleta',
  pestañaPrincipal: 'grafo',
  avisos: [],
  versionDatos: 0,

  // ------------------------------------------------------------ arranque

  inicializar: () => {
    if (get().estudio || get().errorInicio) {
      return;
    }
    const resultadoConfig = cargarConfig();
    if (!resultadoConfig.ok) {
      set({ errorInicio: resultadoConfig.error });
      return;
    }
    const estudio = crearEstudio(resultadoConfig.config);
    grafoActual = new GrafoDag((tipo) => estudio.registro.obtener(tipo));
    estudio.motor.fijarGrafo(grafoActual);
    historial = new Historial<PistaTelar[]>(resultadoConfig.config.lineaTiempo.limiteHistorial);

    estudio.motor.suscribir((evento) => {
      if (evento.tipo === 'nodo:estado') {
        set((estado) => ({ estadosNodos: { ...estado.estadosNodos, [evento.nodoId]: evento.detalle } }));
        return;
      }
      if (evento.tipo === 'ejecucion:inicio') {
        set({ ejecutando: true });
        return;
      }
      if (evento.tipo === 'ejecucion:fin') {
        const { resumen } = evento.informe;
        const plural = (n: number, singular: string, pluralPalabra: string) =>
          `${n} ${n === 1 ? singular : pluralPalabra}`;
        const partes: string[] = [];
        if (resumen.ejecutados > 0) partes.push(plural(resumen.ejecutados, 'ejecutado', 'ejecutados'));
        if (resumen.cacheados > 0) partes.push(plural(resumen.cacheados, 'desde caché', 'desde caché'));
        if (resumen.omitidos > 0) partes.push(plural(resumen.omitidos, 'desactivado', 'desactivados'));
        if (resumen.bloqueados > 0) partes.push(plural(resumen.bloqueados, 'bloqueado', 'bloqueados'));
        if (resumen.cancelados > 0) partes.push(plural(resumen.cancelados, 'cancelado', 'cancelados'));
        set({
          ejecutando: false,
          ultimoInforme: evento.informe,
          // Los nodos registran sus salidas directamente en el registro de
          // activos: hay que proyectar la lista nueva a la UI.
          activos: estudio.activos.listar(),
        });
        if (resumen.errores > 0) {
          const primeroConError = evento.informe.nodos.find((n) => n.estado === 'error');
          get().avisar({
            titulo: `Ejecución terminada con ${resumen.errores} error(es).`,
            detalle: `${partes.join(', ')}. Primer fallo: ${primeroConError?.error?.mensajeUsuario ?? 'desconocido'}`,
            categoria: 'critico',
          });
        } else {
          get().avisar({ titulo: `Ejecución terminada: ${partes.join(', ')}.`, categoria: 'exito' });
        }
      }
    });

    set({ estudio, config: resultadoConfig.config });
    void get().verificarBackend();
    void get().importarMusicaEjemplo();
  },

  // -------------------------------------------------------------- grafo

  añadirNodo: (tipo, posicion) => {
    const { estudio } = get();
    if (!estudio || !grafoActual) return;
    const definicion = estudio.registro.obtener(tipo);
    if (!definicion) {
      get().avisar({ titulo: `El tipo de nodo "${tipo}" no existe en el catálogo.`, categoria: 'validacion' });
      return;
    }
    const parametros: Record<string, ValorParametro> = {};
    for (const parametro of definicion.parametros) {
      parametros[parametro.clave] = parametro.defecto;
    }
    const instancia: InstanciaNodo = {
      id: crypto.randomUUID(),
      tipo,
      parametros,
      posicion: posicion ?? posicionCascada(),
      desactivado: false,
      creadoEn: Date.now(),
    };
    try {
      grafoActual.agregarNodo(instancia);
    } catch (error) {
      get().avisar(avisoErrorDesdeMotor(error));
      return;
    }
    set({ instancias: grafoActual.listarNodos(), idSeleccionado: instancia.id });
  },

  conectar: (conexion) => {
    if (!grafoActual) return;
    try {
      grafoActual.conectar(conexion);
      set({ aristas: grafoActual.obtenerAristas() });
    } catch (error) {
      get().avisar(avisoErrorDesdeMotor(error));
    }
  },

  cargarEjemplo: () => {
    const { estudio } = get();
    if (!estudio || !grafoActual) return;
    const definicionFuente = estudio.registro.obtener('fuente-audio');
    const definicionGanancia = estudio.registro.obtener('ganancia');
    const definicionFusion = estudio.registro.obtener('fusion-audios');
    if (!definicionFuente || !definicionGanancia || !definicionFusion) {
      get().avisar({ titulo: 'El catálogo no tiene los nodos del ejemplo.', categoria: 'validacion' });
      return;
    }
    const primerActivo = get().activos.at(0);
    const parametrosPorDefecto = (definicion: typeof definicionFuente) => {
      const parametros: Record<string, ValorParametro> = {};
      for (const parametro of definicion.parametros) {
        parametros[parametro.clave] = parametro.defecto;
      }
      return parametros;
    };
    const fuente: InstanciaNodo = {
      id: crypto.randomUUID(),
      tipo: 'fuente-audio',
      parametros: {
        ...parametrosPorDefecto(definicionFuente),
        ...(primerActivo ? { archivo: primerActivo.id } : {}),
      },
      posicion: { x: 0, y: 0 },
      desactivado: false,
      creadoEn: Date.now(),
    };
    const ganancia: InstanciaNodo = {
      id: crypto.randomUUID(),
      tipo: 'ganancia',
      /* valores no triviales: la demo debe mostrar una transformación real */
      parametros: { ...parametrosPorDefecto(definicionGanancia), gananciaDb: -3 },
      posicion: { x: 360, y: 40 },
      desactivado: false,
      creadoEn: Date.now(),
    };
    const fusion: InstanciaNodo = {
      id: crypto.randomUUID(),
      tipo: 'fusion-audios',
      parametros: { ...parametrosPorDefecto(definicionFusion), separacionMs: 250, fundidoMs: 150 },
      posicion: { x: 720, y: -10 },
      desactivado: false,
      creadoEn: Date.now(),
    };
    try {
      grafoActual.agregarNodo(fuente);
      grafoActual.agregarNodo(ganancia);
      grafoActual.agregarNodo(fusion);
      grafoActual.conectar({
        origen: { nodo: fuente.id, puerto: 'salida' },
        destino: { nodo: ganancia.id, puerto: 'entrada' },
      });
      grafoActual.conectar({
        origen: { nodo: ganancia.id, puerto: 'salida' },
        destino: { nodo: fusion.id, puerto: 'entradas' },
      });
    } catch (error) {
      get().avisar(avisoErrorDesdeMotor(error));
      return;
    }
    set({
      instancias: grafoActual.listarNodos(),
      aristas: grafoActual.obtenerAristas(),
      idSeleccionado: null,
    });
    get().avisar({
      titulo: 'Grafo de ejemplo cargado',
      detalle: 'Ejecuta el grafo y envía la Fusión a la línea de tiempo.',
      categoria: 'exito',
    });
  },

  moverNodo: (idNodo, posicion) => {
    if (!grafoActual) return;
    const instancia = grafoActual.obtenerNodo(idNodo);
    if (instancia) {
      grafoActual.actualizarNodo({ ...instancia, posicion });
      set({ instancias: grafoActual.listarNodos() });
    }
  },

  eliminarNodos: (ids) => {
    const { estudio } = get();
    if (!estudio || !grafoActual) return;
    // Antes de borrar: quiénes quedan aguas abajo de lo borrado (sus estados
    // previos dejarán de ser válidos al perder la entrada).
    const afectados = new Set<string>();
    for (const id of ids) {
      for (const dependiente of grafoActual.dependientesTransitivos(id)) {
        if (!ids.includes(dependiente)) {
          afectados.add(dependiente);
        }
      }
    }
    for (const id of ids) {
      if (grafoActual.obtenerNodo(id)) {
        grafoActual.eliminarNodo(id);
      }
    }
    for (const id of afectados) {
      estudio.motor.restablecerEstados(id);
    }
    const restantes = new Set(grafoActual.listarNodos().map((n) => n.id));
    set((estado) => ({
      instancias: grafoActual!.listarNodos(),
      aristas: grafoActual!.obtenerAristas(),
      idSeleccionado: estado.idSeleccionado && !restantes.has(estado.idSeleccionado) ? null : estado.idSeleccionado,
      estadosNodos: Object.fromEntries(Object.entries(estado.estadosNodos).filter(([id]) => restantes.has(id))),
    }));
  },

  eliminarAristas: (ids) => {
    const { estudio } = get();
    if (!estudio || !grafoActual) return;
    const afectados = new Set<string>();
    for (const id of ids) {
      const arista = grafoActual.obtenerAristas().find((a) => a.id === id);
      if (arista) {
        afectados.add(arista.destino.nodo);
        try {
          grafoActual.desconectar(id);
        } catch {
          // La arista ya no existe: idempotente.
        }
      }
    }
    for (const id of afectados) {
      estudio.motor.restablecerEstados(id);
    }
    set({ aristas: grafoActual.obtenerAristas() });
  },

  seleccionar: (idNodo) => set({ idSeleccionado: idNodo }),

  cambiarParametro: (idNodo, clave, valor) => {
    const { estudio } = get();
    if (!estudio || !grafoActual) return;
    const instancia = grafoActual.obtenerNodo(idNodo);
    if (!instancia) return;
    grafoActual.actualizarNodo({ ...instancia, parametros: { ...instancia.parametros, [clave]: valor } });
    set({ instancias: grafoActual.listarNodos() });
    // El cambio invalida la rama: los estados previos dejan de ser válidos.
    estudio.motor.restablecerEstados(idNodo);
  },

  reordenarEntrada: (aristaId, direccion) => {
    const { estudio } = get();
    if (!estudio || !grafoActual) return;
    const arista = grafoActual.obtenerAristas().find((a) => a.id === aristaId);
    if (!arista) return;
    const lista = grafoActual.aristasHacia(arista.destino.nodo, arista.destino.puerto);
    const indice = lista.findIndex((a) => a.id === aristaId);
    const destino = indice + direccion;
    if (indice < 0 || destino < 0 || destino >= lista.length) return;
    // Normalizar órdenes a índices y luego intercambiar los dos implicados.
    lista.forEach((a, i) => {
      if ((a.orden ?? -1) !== i) {
        grafoActual!.actualizarOrdenArista(a.id, i);
      }
    });
    const ordenA = lista[indice]!.orden ?? indice;
    const ordenB = lista[destino]!.orden ?? destino;
    grafoActual.actualizarOrdenArista(lista[indice]!.id, ordenB);
    grafoActual.actualizarOrdenArista(lista[destino]!.id, ordenA);
    set({ aristas: grafoActual.obtenerAristas() });
    estudio.motor.restablecerEstados(arista.destino.nodo);
  },

  accionNodo: (idNodo, accion) => {
    const { estudio } = get();
    if (!estudio) return;
    if (accion === 'ejecutar' || accion === 'reintentar') {
      if (get().ejecutando) {
        get().avisar({
          titulo: 'Ya hay una ejecución en curso.',
          detalle: 'Espera a que termine o cancélala.',
          categoria: 'validacion',
        });
        return;
      }
      void (async () => {
        try {
          const informe =
            accion === 'reintentar'
              ? await estudio.motor.reintentarNodo(idNodo)
              : await estudio.motor.ejecutar({ objetivos: [idNodo] });
          void informe;
        } catch (error) {
          if (!(error instanceof ErrorCancelacion)) {
            set({ ejecutando: false });
            get().avisar(avisoErrorDesdeMotor(error));
          }
        }
      })();
      return;
    }
    if (accion === 'invalidar') {
      estudio.motor.invalidar(idNodo);
      set({ estadosNodos: Object.fromEntries(estudio.motor.estados()) });
      get().avisar({ titulo: 'Caché de la rama invalidada.', categoria: 'exito' });
      return;
    }
    if (accion === 'alternar-desactivado') {
      if (!grafoActual) return;
      const instancia = grafoActual.obtenerNodo(idNodo);
      if (instancia) {
        grafoActual.actualizarNodo({ ...instancia, desactivado: !instancia.desactivado });
        // El estado proyectado debe reflejar el cambio: sin esto, la insignia
        // mostraría un "Listo" caduco (hallazgo del árbitro, ronda 1).
        estudio.motor.restablecerEstados(idNodo);
        set({ instancias: grafoActual.listarNodos(), estadosNodos: Object.fromEntries(estudio.motor.estados()) });
      }
      return;
    }
    if (accion === 'enviar-linea-tiempo') {
      get().enviarALineaTiempo(idNodo);
      return;
    }
    if (accion === 'descargar') {
      const resultado = estudio.motor.salidaDe(idNodo);
      const salidaAudio = Object.values(resultado?.salidas ?? {}).find((valor) => valor.tipo === 'audio');
      if (salidaAudio && salidaAudio.tipo === 'audio') {
        get().descargarActivo(salidaAudio.idActivo);
      }
    }
  },

  ejecutarGrafo: async () => {
    const { estudio } = get();
    if (!estudio || get().ejecutando) {
      return;
    }
    try {
      const informe = await estudio.motor.ejecutar();
      void informe;
    } catch (error) {
      if (!(error instanceof ErrorCancelacion)) {
        set({ ejecutando: false });
        get().avisar(avisoErrorDesdeMotor(error));
      }
    }
  },

  cancelarEjecucion: () => {
    get().estudio?.motor.cancelar();
  },

  // ---------------------------------------------------------- biblioteca

  subirArchivos: async (archivos) => {
    // Cola con límite de concurrencia configurable (ui.maximoSubidasSimultaneas):
    // Promise.all sin más saturaría decodificaciones simultáneas.
    const { estudio } = get();
    if (!estudio) return;
    const maximo = estudio.config.ui.maximoSubidasSimultaneas;
    const pendientes = [...archivos];
    const trabajadoras = Array.from({ length: Math.min(maximo, pendientes.length) }, async () => {
      while (pendientes.length > 0) {
        const archivo = pendientes.shift();
        if (archivo) {
          await get().subirArchivo(archivo);
        }
      }
    });
    await Promise.all(trabajadoras);
  },

  subirArchivo: async (archivo) => {
    const { estudio } = get();
    if (!estudio) return;
    try {
      const bytes = await archivo.arrayBuffer();
      // decodeAudioData DESPRENDE el ArrayBuffer (queda a longitud 0):
      // guardamos una copia para el almacén (y para el rescate) antes de decodificar.
      const copia = bytes.slice(0);
      let buffer: AudioBuffer;
      let bytesDefinitivos: Uint8Array = new Uint8Array(copia);
      let nombre = archivo.name;
      let rescatado = false;
      try {
        buffer = await estudio.decodificador.decodificarBytes(bytes);
      } catch (error) {
        if (!(error instanceof ErrorValidacion) || error.codigo !== 'AUDIO_NO_DECODIFICABLE') {
          throw error;
        }
        // Rescate: el navegador no decodifica este códec (AMR, 3gp, WMA, ALAC…).
        // rescatarAWav elige el orden (backend local o ffmpeg.wasm) y avisa
        // de cada etapa al usuario.
        const rescatadoBytes = await rescatarAWav(get, new Uint8Array(copia), archivo.name);
        bytesDefinitivos = rescatadoBytes;
        rescatado = true;
        nombre = archivo.name.replace(/\.[a-z0-9]+$/i, '') + '.wav';
        buffer = await estudio.decodificador.decodificarBytes(
          bytesDefinitivos.slice(0).buffer.slice(0) as ArrayBuffer,
        );
      }
      const meta = await estudio.activos.poner(
        new Blob([bytesDefinitivos as unknown as BlobPart], { type: rescatado ? 'audio/wav' : archivo.type || 'audio/wav' }),
        {
          nombre,
          mime: rescatado ? 'audio/wav' : archivo.type || 'audio/wav',
          duracionMs: Math.round(buffer.duration * 1000),
          tasaMuestreo: buffer.sampleRate,
          canales: buffer.numberOfChannels,
          bytes: bytesDefinitivos.byteLength,
          origen: rescatado ? 'rescate' : 'subida',
        },
      );
      estudio.decodificador.registrarEnCache(meta.id, buffer);
      set({ activos: estudio.activos.listar() });
      get().avisar({
        titulo:
          `«${nombre}» añadido a la biblioteca (${buffer.duration.toFixed(1)} s)` +
          (rescatado ? ' — transcodificado a WAV automáticamente.' : '.'),
        detalle: 'Elíjelo en el parámetro "Archivo" de un nodo Fuente de audio.',
        categoria: 'exito',
      });
    } catch (error) {
      get().avisar(avisoErrorDesdeMotor(error));
    }
  },

  eliminarActivo: (idActivo) => {
    const { estudio } = get();
    if (!estudio) return;
    const referenciado = get().instancias.find(
      (instancia) =>
        instancia.tipo === 'fuente-audio' &&
        (instancia.parametros as Record<string, unknown>).archivo === idActivo,
    );
    if (referenciado) {
      get().avisar({
        titulo: 'No se puede eliminar: el archivo está en uso.',
        detalle: 'Un nodo «Fuente de audio» lo referencia. Elimina o reconfigura ese nodo primero.',
        categoria: 'validacion',
      });
      return;
    }
    estudio.activos.eliminar(idActivo);
    set({ activos: estudio.activos.listar() });
  },

  descargarActivo: (idActivo) => {
    const { estudio } = get();
    if (!estudio) return;
    void (async () => {
      try {
        const blob = await estudio.activos.obtenerBytes(idActivo);
        const meta = estudio.activos.obtenerMeta(idActivo);
        descargarBlob(blob, meta?.nombre ?? `${idActivo}.wav`);
      } catch (error) {
        get().avisar(avisoErrorDesdeMotor(error));
      }
    })();
  },

  exportarActivoMp3: async (idActivo) => {
    const { estudio } = get();
    if (!estudio || get().ocupadoMp3) {
      if (get().ocupadoMp3) {
        get().avisar({
          titulo: 'Ya hay una conversión MP3 en curso.',
          detalle: 'Espera a que termine antes de lanzar otra.',
          categoria: 'validacion',
        });
      }
      return;
    }
    set({ ocupadoMp3: true });
    try {
      const blob = await estudio.activos.obtenerBytes(idActivo);
      const bytesWav = new Uint8Array(await blob.arrayBuffer());
      get().avisar({ titulo: 'Convirtiendo a MP3 con ffmpeg.wasm (primera carga tarda unos segundos)…', categoria: 'exito' });
      const mp3 = await estudio.exportadorMp3.convertirWavAMP3(bytesWav);
      const meta = estudio.activos.obtenerMeta(idActivo);
      descargarBlob(mp3, `${(meta?.nombre ?? 'audio').replace(/\.[a-z0-9]+$/i, '')}.mp3`);
    } catch (error) {
      get().avisar(avisoErrorDesdeMotor(error));
    } finally {
      set({ ocupadoMp3: false });
    }
  },

  // ---------------------------------------------------------------- datos

  revisarDato: (idDato, contenido) => {
    const { estudio } = get();
    if (!estudio || !grafoActual) return;
    try {
      estudio.datos.revisar(idDato, contenido);
    } catch (error) {
      get().avisar(avisoErrorDesdeMotor(error));
      return;
    }
    // Invalidar SOLO los consumidores del dato (quien tiene aristas desde el
    // nodo que lo emitió): el nodo origen sigue cacheado (no se re-transcribe).
    const nodoOrigen = grafoActual
      .listarNodos()
      .find((nodo) =>
        Object.values(estudio.motor.salidaDe(nodo.id)?.salidas ?? {}).some(
          (valor) => valor.tipo === 'dato' && valor.idDato === idDato,
        ),
      );
    let invalidados = 0;
    if (nodoOrigen) {
      for (const arista of get().aristas) {
        if (arista.origen.nodo === nodoOrigen.id) {
          estudio.motor.invalidar(arista.destino.nodo);
          invalidados += 1;
        }
      }
    }
    set((estado) => ({ versionDatos: estado.versionDatos + 1 }));
    get().avisar({
      titulo: 'Revisión aplicada al dato.',
      detalle: invalidados > 0
        ? `${invalidados} nodo(s) consumidor(es) invalidado(s): vuelve a ejecutar el grafo para ver el cambio.`
        : 'Ningún nodo consume este dato todavía.',
      categoria: 'exito',
    });
  },

  importarMusicaEjemplo: async () => {
    const { estudio } = get();
    if (!estudio) return;
    const catalogo = estudio.config.catalogos.musica;
    if (catalogo.length === 0) return;
    for (const pista of catalogo) {
      try {
        const respuesta = await fetch(pista.ruta);
        if (!respuesta.ok) continue;
        const bytes = new Uint8Array(await respuesta.arrayBuffer());
        // Ya está (direccionado por contenido) → no duplicar.
        const duplicado = estudio.activos
          .listar()
          .find((meta) => meta.nombre === `Música ejemplo — ${pista.nombre}.wav`);
        if (duplicado) continue;
        const buffer = await estudio.decodificador.decodificarBytes(
          bytes.slice(0).buffer.slice(0) as ArrayBuffer,
        );
        const meta = await estudio.activos.poner(
          new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' }),
          {
            nombre: `Música ejemplo — ${pista.nombre}.wav`,
            mime: 'audio/wav',
            duracionMs: Math.round(buffer.duration * 1000),
            tasaMuestreo: buffer.sampleRate,
            canales: buffer.numberOfChannels,
            bytes: bytes.byteLength,
            origen: 'subida',
          },
        );
        estudio.decodificador.registrarEnCache(meta.id, buffer);
        set({ activos: estudio.activos.listar() });
      } catch {
        // Las pistas de ejemplo son opcionales: si falta el archivo, la
        // biblioteca sigue sin ellas (el usuario puede importar la suya).
      }
    }
  },

  // ------------------------------------------------------ línea de tiempo

  enviarALineaTiempo: (idNodo) => {
    const { estudio } = get();
    if (!estudio) return;
    const resultado = estudio.motor.salidaDe(idNodo);
    const salidaAudio = Object.values(resultado?.salidas ?? {}).find((valor) => valor.tipo === 'audio');
    if (!salidaAudio || salidaAudio.tipo !== 'audio') {
      get().avisar({
        titulo: 'Ese nodo todavía no tiene salida de audio.',
        detalle: 'Ejecútalo primero y vuelve a intentarlo.',
        categoria: 'validacion',
      });
      return;
    }
    void (async () => {
      try {
        const buffer = await estudio.decodificador.decodificar(salidaAudio.idActivo);
        const meta = estudio.activos.obtenerMeta(salidaAudio.idActivo);
        const pista = crearPistaDesdeBuffer(meta?.nombre ?? 'Audio', 'voz', buffer);
        confirmarPendiente();
        historial?.apilar(get().pistas);
        set((estado) => ({
          pistas: [...estado.pistas, pista],
          puedeDeshacer: true,
          puedeRehacer: false,
          pestañaPrincipal: 'linea-tiempo',
        }));
        get().avisar({ titulo: `«${pista.name}» añadida a la línea de tiempo.`, categoria: 'exito' });
      } catch (error) {
        get().avisar(avisoErrorDesdeMotor(error));
      }
    })();
  },

  pistasEditadasDesdeMotor: (pistas) => {
    // Durante un rebounce (corte destructivo/mezcla) las ediciones del motor
    // se descartan: el resultado del render es el estado coherente.
    if (get().ocupadoLineaTiempo) {
      get().avisar({
        titulo: 'Edición ignorada mientras se procesa la línea de tiempo.',
        detalle: 'Espera a que termine la operación en curso.',
        categoria: 'validacion',
      });
      return;
    }
    // El motor edita (drag/trim/split): el estado previo se apila cuando la
    // ráfaga de cambios termina (el trim avisa fotograma a fotograma).
    if (temporizadorConfirmacion === null) {
      pendienteApilar = get().pistas;
    } else {
      clearTimeout(temporizadorConfirmacion);
    }
    const espera = get().config?.lineaTiempo.confirmacionHistorialMs ?? 400;
    temporizadorConfirmacion = setTimeout(() => {
      confirmarPendiente();
    }, espera);
    set({ pistas });
  },

  eliminarPistaDeTiempo: (pistaId) => {
    confirmarPendiente();
    historial?.apilar(get().pistas);
    const pistas = eliminarPista(get().pistas, pistaId);
    set({
      pistas,
      puedeDeshacer: historial?.puedeDeshacer() ?? false,
      puedeRehacer: historial?.puedeRehacer() ?? false,
    });
  },

  deshacerLineaTiempo: () => {
    confirmarPendiente();
    const actual = get().pistas;
    const anterior = historial?.deshacer(actual);
    if (anterior) {
      set({
        pistas: anterior,
        puedeDeshacer: historial?.puedeDeshacer() ?? false,
        puedeRehacer: historial?.puedeRehacer() ?? false,
      });
    }
  },

  rehacerLineaTiempo: () => {
    confirmarPendiente();
    const actual = get().pistas;
    const siguiente = historial?.rehacer(actual);
    if (siguiente) {
      set({
        pistas: siguiente,
        puedeDeshacer: historial?.puedeDeshacer() ?? false,
        puedeRehacer: historial?.puedeRehacer() ?? false,
      });
    }
  },

  eliminarRegion: async (pistaId, desdeMuestra, hastaMuestra) => {
    const { estudio } = get();
    if (!estudio) return;
    set({ ocupadoLineaTiempo: true, errorLineaTiempo: null });
    try {
      confirmarPendiente();
      const previas = get().pistas;
      const recorte = eliminarRangoDePista(previas, pistaId, desdeMuestra, hastaMuestra);
      const plan = planificarMezclaPistas([recorte.pistaModificada], {
        tasaMuestreo: estudio.config.audio.tasaMuestreo,
      });
      const buffer = await estudio.render.mezclar(plan);
      const canales: Float32Array[] = [];
      for (let canal = 0; canal < buffer.numberOfChannels; canal += 1) {
        canales.push(buffer.getChannelData(canal));
      }
      const bytes = codificarWav(canales, buffer.sampleRate);
      const meta = await estudio.activos.poner(new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' }), {
        nombre: `${recorte.pistaModificada.name.replace(/\.[a-z0-9]+$/i, '')} (corte aplicado).wav`,
        mime: 'audio/wav',
        duracionMs: Math.round(buffer.duration * 1000),
        tasaMuestreo: buffer.sampleRate,
        canales: buffer.numberOfChannels,
        bytes: bytes.byteLength,
        origen: 'linea-tiempo',
      });
      estudio.decodificador.registrarEnCache(meta.id, buffer);
      const pistaPersistida = crearPistaDesdeBuffer(
        recorte.pistaModificada.name,
        recorte.pistaModificada.tipoPista,
        buffer,
      );
      historial?.apilar(previas);
      set({
        pistas: sustituirPista(recorte.pistas, pistaPersistida),
        activos: estudio.activos.listar(),
        puedeDeshacer: true,
        puedeRehacer: false,
        ocupadoLineaTiempo: false,
      });
      get().avisar({
        titulo: 'Región eliminada y audio persistido.',
        detalle: `Se eliminaron ${(recorte.muestrasEliminadas / estudio.config.audio.tasaMuestreo).toFixed(2)} s; el audio resultante quedó guardado en la biblioteca.`,
        categoria: 'exito',
      });
    } catch (error) {
      set({ ocupadoLineaTiempo: false, errorLineaTiempo: error instanceof Error ? error.message : String(error) });
      get().avisar(avisoErrorDesdeMotor(error));
    }
  },

  mezclarYExportar: async () => {
    const { estudio } = get();
    if (!estudio) return;
    set({ ocupadoLineaTiempo: true, errorLineaTiempo: null });
    try {
      const plan = planificarMezclaPistas(get().pistas, {
        tasaMuestreo: estudio.config.audio.tasaMuestreo,
      });
      const buffer = await estudio.render.mezclar(plan);
      const canales: Float32Array[] = [];
      for (let canal = 0; canal < buffer.numberOfChannels; canal += 1) {
        canales.push(buffer.getChannelData(canal));
      }
      const bytes = codificarWav(canales, buffer.sampleRate);
      const meta = await estudio.activos.poner(new Blob([bytes as unknown as BlobPart], { type: 'audio/wav' }), {
        nombre: `Mezcla de línea de tiempo (${get().pistas.length} pistas).wav`,
        mime: 'audio/wav',
        duracionMs: Math.round(buffer.duration * 1000),
        tasaMuestreo: buffer.sampleRate,
        canales: buffer.numberOfChannels,
        bytes: bytes.byteLength,
        origen: 'linea-tiempo',
      });
      set({ activos: estudio.activos.listar(), ocupadoLineaTiempo: false });
      const blob = await estudio.activos.obtenerBytes(meta.id);
      descargarBlob(blob, meta.nombre);
      get().avisar({
        titulo: 'Mezcla exportada.',
        detalle: `«${meta.nombre}» guardada en la biblioteca y descargada.`,
        categoria: 'exito',
      });
    } catch (error) {
      set({ ocupadoLineaTiempo: false, errorLineaTiempo: error instanceof Error ? error.message : String(error) });
      get().avisar(avisoErrorDesdeMotor(error));
    }
  },

  // -------------------------------------------------------------- backend

  verificarBackend: async () => {
    const { estudio } = get();
    if (!estudio) return;
    estudio.clienteBackend.olvidarVerificacion();
    const respuesta = await estudio.clienteBackend.verificar();
    set({
      estadoBackend: {
        verificadoEn: Date.now(),
        disponible: respuesta.disponible,
        version: respuesta.version,
        capacidades: respuesta.capacidades ?? [],
        detalle: respuesta.detalle,
      },
    });
  },

  fijarPestañaIzquierda: (pestaña) => set({ pestañaIzquierda: pestaña }),
  fijarPestañaPrincipal: (pestaña) => set({ pestañaPrincipal: pestaña }),

  cerrarAviso: (id) => set((estado) => ({ avisos: estado.avisos.filter((a) => a.id !== id) })),

  // -------------------------------------------------------------- helper

  avisar: (aviso) => {
    const id = crypto.randomUUID();
    set((estado) => ({ avisos: [...estado.avisos.slice(-7), { ...aviso, id }] }));
    if (aviso.categoria === 'exito') {
      setTimeout(() => {
        set((estado) => ({ avisos: estado.avisos.filter((a) => a.id !== id) }));
      }, 6000);
    }
  },
}));

export type { EstadoAlmacen };
