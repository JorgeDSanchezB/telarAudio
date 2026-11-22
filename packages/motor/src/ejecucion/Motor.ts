/**
 * Motor de ejecución del DAG.
 *
 * Garantías que implementa (todas cubiertas por pruebas en Motor.test.ts):
 *
 *  1. SOLO-NECESARIOS: `ejecutar` computa únicamente los nodos del cierre
 *     transitivo de los objetivos. Las ramas ajenas no se tocan.
 *  2. DESACTIVACIÓN: un nodo desactivado no se computa y bloquea a sus
 *     dependientes con motivo `entrada-desactivada`.
 *  3. CACHÉ SELECTIVA: la clave de un nodo encadena las claves de sus
 *     entradas; cambiar un parámetro de una rama invalida esa rama y sus
 *     dependientes, pero las ramas hermanas siguen cacheadas.
 *  4. PARALELISMO: los nodos cuyas entradas están resueltas arrancan en
 *     paralelo hasta `maxConcurrencia`.
 *  5. TOLERANCIA: un nodo que falla NO tumba el grafo: queda en estado
 *     `error` con su fallo tipado y sus dependientes en `bloqueado`;
 *     `reintentarNodo` re-ejecuta solo lo necesario.
 *  6. CANCELACIÓN: `cancelar` aborta los procesadores en curso vía
 *     AbortSignal y marca los pendientes como `cancelado`.
 */

import { ErrorConfiguracion, ErrorTemporal, ErrorValidacion, clasificarError } from '../errores';
import type { DetalleFallo } from '../errores';
import type { DefinicionNodo, ContextoProcesador, EntradaEjecucion, SalidaEjecucion } from '../contratos/nodos';
import { validarValoresParametros } from '../contratos/params';
import type { ValorPuerto } from '../contratos/puertos';
import type { ConfigMotor } from '../contratos/config';
import { validarConfigMotor } from '../contratos/config';
import type { ServiciosMotor } from '../contratos/servicios';
import type { IdNodo, InstanciaNodo } from '../contratos/grafo';
import type { GrafoDag } from '../grafo/GrafoDag';
import type { RegistroNodos } from '../registro/RegistroNodos';
import { CacheResultados } from './cache';
import type { ResultadoNodo } from './cache';
import { jsonCanonico } from './canonico';

export type EstadoNodo =
  | 'inactivo'
  | 'bloqueado'
  | 'en-cola'
  | 'ejecutando'
  | 'listo'
  | 'cacheado'
  | 'error'
  | 'cancelado'
  | 'desactivado';

export type MotivoBloqueo = 'entrada-desactivada' | 'entrada-error' | 'entrada-pendiente';

export interface EstadoNodoDetalle {
  estado: EstadoNodo;
  motivoBloqueo?: MotivoBloqueo;
  error?: DetalleFallo;
  /** Progreso 0..1 mientras el nodo se ejecuta. */
  progreso?: number;
  mensajeProgreso?: string;
  iniciadoEn?: number;
  finalizadoEn?: number;
  duracionMs?: number;
  salidas?: Record<string, ValorPuerto>;
}

export type EventoMotor =
  | { tipo: 'ejecucion:inicio'; objetivos: IdNodo[] }
  | { tipo: 'nodo:estado'; nodoId: IdNodo; detalle: EstadoNodoDetalle }
  | { tipo: 'ejecucion:fin'; informe: InformeEjecucion };

export interface ResumenNodoEjecucion {
  nodoId: IdNodo;
  tipo: string;
  estado: EstadoNodo;
  motivoBloqueo?: MotivoBloqueo;
  error?: DetalleFallo;
  duracionMs?: number;
}

export interface InformeEjecucion {
  iniciadoEn: number;
  finalizadoEn: number;
  duracionTotalMs: number;
  objetivos: IdNodo[];
  nodos: ResumenNodoEjecucion[];
  resumen: {
    ejecutados: number;
    cacheados: number;
    omitidos: number;
    bloqueados: number;
    errores: number;
    cancelados: number;
  };
}

export interface OpcionesEjecucion {
  /** Nodos cuyo resultado se quiere. Por defecto: nodos hoja activos. */
  objetivos?: IdNodo[];
}

export interface OpcionesMotor {
  registro: RegistroNodos;
  servicios: ServiciosMotor;
  config?: Partial<ConfigMotor>;
}

interface PlanNodo {
  instancia: InstanciaNodo;
  definicion: DefinicionNodo;
  parametros: Record<string, number | boolean | string>;
  clave: string;
}

/** Razón de aborto interno (timeout frente a cancelación de usuario). */
type RazonAborto = { tipo: 'timeout' } | { tipo: 'cancelado' };

export class Motor {
  private readonly registro: RegistroNodos;
  private readonly servicios: ServiciosMotor;
  private readonly config: ConfigMotor;
  private readonly cache: CacheResultados;
  private readonly ultimoResultado = new Map<IdNodo, ResultadoNodo>();
  private readonly estadosNodo = new Map<IdNodo, EstadoNodoDetalle>();
  private readonly oyentes = new Set<(evento: EventoMotor) => void>();

  private grafo: GrafoDag | undefined;
  private controlador: AbortController | undefined;
  private ejecutando = false;

  constructor(opciones: OpcionesMotor) {
    this.registro = opciones.registro;
    this.servicios = opciones.servicios;
    this.config = validarConfigMotor(opciones.config);
    this.cache = new CacheResultados(this.config.maxResultadosCache);
  }

  /** Sustituye el grafo por completo: limpia caché, resultados y estados. */
  fijarGrafo(grafo: GrafoDag): void {
    this.exigirParado('fijarGrafo');
    this.grafo = grafo;
    this.cache.vaciar();
    this.ultimoResultado.clear();
    this.estadosNodo.clear();
  }

  /**
   * Ejecuta el grafo hasta producir las salidas de los objetivos pedidos.
   * Solo computa los nodos necesarios para ello.
   */
  async ejecutar(opciones: OpcionesEjecucion = {}): Promise<InformeEjecucion> {
    this.exigirParado('ejecutar');
    const grafo = this.grafo;
    if (!grafo) {
      throw new ErrorConfiguracion({
        codigo: 'MOTOR_SIN_GRAFO',
        mensaje: 'No hay grafo fijado en el motor.',
        mensajeUsuario: 'No hay ningún proyecto cargado en el motor.',
        reintentable: false,
      });
    }
    const iniciadoEn = this.servicios.ahora();
    this.ejecutando = true;
    this.controlador = new AbortController();
    try {
      return await this.ejecutarPlan(grafo, opciones, iniciadoEn);
    } finally {
      this.ejecutando = false;
      this.controlador = undefined;
    }
  }

  /**
   * Re-ejecuta un nodo tras un fallo y completa su rama: los objetivos son el
   * nodo y sus dependientes transitivos. Las entradas ya válidas salen de
   * caché, así que reintentar NO reprocesa el grafo completo.
   */
  async reintentarNodo(nodoId: IdNodo): Promise<InformeEjecucion> {
    const grafo = this.grafo;
    if (!grafo || !grafo.obtenerNodo(nodoId)) {
      throw new ErrorValidacion({
        codigo: 'MOTOR_OBJETIVO_INEXISTENTE',
        mensaje: `No existe el nodo ${nodoId} que se quiere reintentar.`,
        mensajeUsuario: 'Ese nodo ya no existe en el grafo.',
        reintentable: false,
      });
    }
    const objetivos = [nodoId, ...grafo.dependientesTransitivos(nodoId)];
    return this.ejecutar({ objetivos });
  }

  /** Cancela la ejecución en curso (si la hay). */
  cancelar(): void {
    this.controlador?.abort({ tipo: 'cancelado' } satisfies RazonAborto);
  }

  /**
   * Invalida la caché de un nodo y de sus dependientes transitivos y
   * restablece sus estados, para forzar su recomputación.
   */
  invalidar(nodoId: IdNodo): void {
    const grafo = this.grafo;
    if (!grafo) return;
    const afectados = new Set<IdNodo>([nodoId, ...grafo.dependientesTransitivos(nodoId)]);
    const claves: string[] = [];
    for (const id of afectados) {
      claves.push(...this.cache.clavesDeNodo(id));
      this.ultimoResultado.delete(id);
    }
    this.cache.eliminarClaves(claves);
    this.restablecerEstados(nodoId);
  }

  /**
   * Restablece a `inactivo` los estados de un nodo y sus dependientes
   * (se usa al editar parámetros para que la UI no muestre estados caducos).
   */
  restablecerEstados(nodoId: IdNodo): void {
    const grafo = this.grafo;
    if (!grafo) return;
    const afectados = new Set<IdNodo>([nodoId, ...grafo.dependientesTransitivos(nodoId)]);
    for (const id of afectados) {
      const instancia = grafo.obtenerNodo(id);
      if (!instancia) continue;
      this.fijarEstado(id, { estado: instancia.desactivado ? 'desactivado' : 'inactivo' });
    }
  }

  estadoDe(nodoId: IdNodo): EstadoNodoDetalle | undefined {
    const guardado = this.estadosNodo.get(nodoId);
    if (guardado) return guardado;
    const instancia = this.grafo?.obtenerNodo(nodoId);
    if (!instancia) return undefined;
    const detalle: EstadoNodoDetalle = { estado: instancia.desactivado ? 'desactivado' : 'inactivo' };
    this.estadosNodo.set(nodoId, detalle);
    return detalle;
  }

  estados(): Map<IdNodo, EstadoNodoDetalle> {
    const copia = new Map<IdNodo, EstadoNodoDetalle>();
    for (const nodo of this.grafo?.listarNodos() ?? []) {
      const detalle = this.estadoDe(nodo.id);
      if (detalle) {
        copia.set(nodo.id, { ...detalle });
      }
    }
    return copia;
  }

  /** Última salida disponible de un nodo (de esta ejecución o de una previa). */
  salidaDe(nodoId: IdNodo): ResultadoNodo | undefined {
    return this.ultimoResultado.get(nodoId);
  }

  estaEjecutando(): boolean {
    return this.ejecutando;
  }

  suscribir(oyente: (evento: EventoMotor) => void): () => void {
    this.oyentes.add(oyente);
    return () => {
      this.oyentes.delete(oyente);
    };
  }

  // ------------------------------------------------------------ internals

  private exigirParado(operacion: string): void {
    if (this.ejecutando) {
      throw new ErrorValidacion({
        codigo: 'MOTOR_OCUPADO',
        mensaje: `No se puede ${operacion} mientras hay una ejecución en curso.`,
        mensajeUsuario: 'Hay una ejecución en curso. Cancélala o espera a que termine.',
        reintentable: false,
      });
    }
  }

  private emitir(evento: EventoMotor): void {
    for (const oyente of this.oyentes) {
      try {
        oyente(evento);
      } catch (error) {
        this.servicios.registrar(`Oyente del motor falló: ${String(error)}`);
      }
    }
  }

  private fijarEstado(nodoId: IdNodo, detalle: EstadoNodoDetalle): void {
    this.estadosNodo.set(nodoId, detalle);
    this.emitir({ tipo: 'nodo:estado', nodoId, detalle: { ...detalle } });
  }

  private async ejecutarPlan(
    grafo: GrafoDag,
    opciones: OpcionesEjecucion,
    iniciadoEn: number,
  ): Promise<InformeEjecucion> {
    // 1) Resolver objetivos: explícitos o nodos hoja activos.
    let objetivos = opciones.objetivos;
    if (objetivos === undefined) {
      objetivos = grafo
        .nodosHoja()
        .filter((id) => grafo.obtenerNodo(id)?.desactivado !== true);
    }
    for (const objetivo of objetivos) {
      if (!grafo.obtenerNodo(objetivo)) {
        throw new ErrorValidacion({
          codigo: 'MOTOR_OBJETIVO_INEXISTENTE',
          mensaje: `El objetivo ${objetivo} no existe en el grafo.`,
          mensajeUsuario: 'Uno de los nodos objetivo ya no existe.',
          reintentable: false,
        });
      }
    }
    this.emitir({ tipo: 'ejecucion:inicio', objetivos });

    // 2) Nodos necesarios = objetivos + cierre transitivo de dependencias,
    //    PODADO: no se atraviesan nodos desactivados, porque sus entradas no
    //    van a usarse. Así, desactivar una rama evita el cómputo de TODO lo
    //    que solo alimentaba a esa rama (verificación del LISTÓN).
    const necesarios = new Set<IdNodo>(objetivos);
    const pilaDependencias = [...objetivos];
    while (pilaDependencias.length > 0) {
      const id = pilaDependencias.pop()!;
      const instanciaDestino = grafo.obtenerNodo(id);
      if (!instanciaDestino || instanciaDestino.desactivado) {
        continue;
      }
      for (const arista of grafo.aristasEntrantes(id)) {
        if (!necesarios.has(arista.origen.nodo)) {
          necesarios.add(arista.origen.nodo);
          pilaDependencias.push(arista.origen.nodo);
        }
      }
    }
    const orden = grafo.ordenTopologico().filter((id) => necesarios.has(id));

    // 3) Fase estática: estados iniciales, bloqueos por desactivación,
    //    validación de contratos (parámetros, entradas) y claves de caché.
    //    Se restablecen primero los estados de los participantes para que
    //    restos de ejecuciones anteriores no contaminen el plan.
    for (const id of orden) {
      const instancia = grafo.obtenerNodo(id);
      this.fijarEstado(id, { estado: instancia?.desactivado ? 'desactivado' : 'inactivo' });
    }
    const planes = new Map<IdNodo, PlanNodo>();
    for (const id of orden) {
      const instancia = grafo.obtenerNodo(id);
      const definicion = instancia ? this.registro.obtener(instancia.tipo) : undefined;
      if (!instancia || !definicion) {
        this.fijarEstado(id, {
          estado: 'error',
          error: {
            codigo: 'GRAFO_TIPO_NO_REGISTRADO',
            categoria: 'configuracion',
            mensaje: `El tipo del nodo ${id} no está registrado.`,
            mensajeUsuario: 'El tipo de este nodo no está disponible en el catálogo.',
            reintentable: false,
          },
        });
        continue;
      }
      if (instancia.desactivado) {
        this.fijarEstado(id, { estado: 'desactivado' });
        continue;
      }
      // Bloqueo estático: alguna entrada viene de un nodo desactivado/bloqueado.
      let bloqueado: MotivoBloqueo | undefined;
      for (const puerto of definicion.entradas) {
        for (const arista of grafo.aristasHacia(id, puerto.clave)) {
          const detalleOrigen = this.estadosNodo.get(arista.origen.nodo);
          if (detalleOrigen?.estado === 'desactivado') {
            bloqueado = 'entrada-desactivada';
            break;
          }
          if (
            detalleOrigen?.estado === 'bloqueado' &&
            detalleOrigen.motivoBloqueo === 'entrada-desactivada'
          ) {
            bloqueado = 'entrada-desactivada';
            break;
          }
        }
        if (bloqueado) break;
      }
      if (bloqueado) {
        this.fijarEstado(id, { estado: 'bloqueado', motivoBloqueo: bloqueado });
        continue;
      }
      // Validación de parámetros antes de ejecutar nada.
      const validacion = validarValoresParametros(definicion.parametros, instancia.parametros);
      if (!validacion.ok) {
        this.fijarEstado(id, {
          estado: 'error',
          error: {
            codigo: 'PARAM_INVALIDOS',
            categoria: 'validacion',
            mensaje: validacion.errores.map((e) => `${e.clave}: ${e.mensaje}`).join(' | '),
            mensajeUsuario: `Parámetros inválidos: ${validacion.errores[0]?.mensaje ?? ''}`,
            reintentable: false,
          },
        });
        continue;
      }
      // Puertos de entrada requeridos deben estar conectados.
      const sinEntrada = definicion.entradas.find((puerto) => {
        const requerida = puerto.requerida !== false;
        return requerida && grafo.aristasHacia(id, puerto.clave).length === 0;
      });
      if (sinEntrada) {
        this.fijarEstado(id, {
          estado: 'error',
          error: {
            codigo: 'NODO_SIN_ENTRADA',
            categoria: 'validacion',
            mensaje: `El puerto de entrada "${sinEntrada.clave}" de ${id} está desconectado.`,
            mensajeUsuario: `Conecta la entrada "${sinEntrada.etiqueta}" de "${definicion.etiqueta}" antes de ejecutar.`,
            reintentable: false,
          },
        });
        continue;
      }
      // Clave de caché: encadena las claves de los nodos de entrada.
      // El orden topológico garantiza que las entradas ya tienen clave; que
      // aún estén pendientes de ejecutar no impide derivar la clave propia.
      const entradasClave: Record<string, string[]> = {};
      let entradaRota: MotivoBloqueo | undefined;
      for (const puerto of definicion.entradas) {
        const clavesPuerto: string[] = [];
        for (const arista of grafo.aristasHacia(id, puerto.clave)) {
          const detalleOrigen = this.estadosNodo.get(arista.origen.nodo);
          if (detalleOrigen?.estado === 'error') {
            entradaRota = 'entrada-error';
            break;
          }
          if (detalleOrigen?.estado === 'bloqueado') {
            entradaRota = detalleOrigen.motivoBloqueo ?? 'entrada-pendiente';
            break;
          }
          const planOrigen = planes.get(arista.origen.nodo);
          if (!planOrigen) {
            entradaRota = 'entrada-pendiente';
            break;
          }
          clavesPuerto.push(planOrigen.clave);
        }
        if (entradaRota) break;
        entradasClave[puerto.clave] = clavesPuerto;
      }
      if (entradaRota) {
        this.fijarEstado(id, { estado: 'bloqueado', motivoBloqueo: entradaRota });
        continue;
      }
      const clave = await this.servicios.hash.sha256(
        jsonCanonico({
          tipo: definicion.tipo,
          version: definicion.version,
          parametros: validacion.valores,
          entradas: entradasClave,
        }),
      );
      const detalle: EstadoNodoDetalle = { estado: 'inactivo' };
      const enCache = this.config.cacheResultados ? this.cache.obtener(clave) : undefined;
      if (enCache) {
        detalle.estado = 'cacheado';
        detalle.salidas = enCache.salidas;
        this.ultimoResultado.set(id, enCache);
      }
      this.fijarEstado(id, detalle);
      planes.set(id, { instancia, definicion, parametros: validacion.valores, clave });
    }

    // 4) Fase dinámica: ejecutar en paralelo lo no cacheado.
    const pendientes: IdNodo[] = orden.filter(
      (id) => this.estadosNodo.get(id)?.estado === 'inactivo' && planes.has(id),
    );
    const enVuelo = new Map<IdNodo, Promise<void>>();

    const entradasResueltas = (id: IdNodo): boolean => {
      const plan = planes.get(id);
      if (!plan) return false;
      for (const puerto of plan.definicion.entradas) {
        for (const arista of grafo.aristasHacia(id, puerto.clave)) {
          const estado = this.estadosNodo.get(arista.origen.nodo)?.estado;
          if (estado !== 'listo' && estado !== 'cacheado') {
            return false;
          }
        }
      }
      return true;
    };

    while (pendientes.length > 0 || enVuelo.size > 0) {
      const senal = this.controlador?.signal;
      if (senal?.aborted) {
        for (const id of pendientes) {
          this.fijarEstado(id, { estado: 'cancelado' });
        }
        pendientes.length = 0;
        break;
      }
      // Depurar pendientes ya resueltos por otras vías (p. ej. bloqueados
      // porque su entrada falló): conservan su motivo específico.
      for (let i = pendientes.length - 1; i >= 0; i -= 1) {
        const estado = this.estadosNodo.get(pendientes[i]!)?.estado;
        if (estado !== 'inactivo' && estado !== 'en-cola') {
          pendientes.splice(i, 1);
        }
      }
      if (pendientes.length === 0 && enVuelo.size === 0) {
        break;
      }
      // Marcar en cola y lanzar hasta el límite de concurrencia.
      for (let i = 0; i < pendientes.length; ) {
        const id = pendientes[i]!;
        if (!entradasResueltas(id)) {
          i += 1;
          continue;
        }
        const detalle = this.estadosNodo.get(id);
        if (detalle && detalle.estado === 'inactivo') {
          this.fijarEstado(id, { ...detalle, estado: 'en-cola' });
        }
        if (enVuelo.size >= this.config.maxConcurrencia) {
          i += 1;
          continue;
        }
        pendientes.splice(i, 1);
        const plan = planes.get(id)!;
        const promesa = this.ejecutarNodo(grafo, plan).finally(() => {
          enVuelo.delete(id);
        });
        enVuelo.set(id, promesa);
      }
      if (enVuelo.size === 0) {
        // Nadie lanzable: los pendientes dependen de nodos que terminaron en
        // error o cancelación y ya fueron marcados como bloqueados/cancelados
        // por `bloquearDependientes`; lo que quede se marca por defecto.
        for (const id of pendientes) {
          this.fijarEstado(id, { estado: 'bloqueado', motivoBloqueo: 'entrada-pendiente' });
        }
        pendientes.length = 0;
        break;
      }
      await Promise.race(enVuelo.values());
    }

    // 5) Informe.
    const finalizadoEn = this.servicios.ahora();
    const nodos: ResumenNodoEjecucion[] = orden.map((id) => {
      const instancia = grafo.obtenerNodo(id);
      const detalle = this.estadosNodo.get(id);
      return {
        nodoId: id,
        tipo: instancia?.tipo ?? '?',
        estado: detalle?.estado ?? 'inactivo',
        motivoBloqueo: detalle?.motivoBloqueo,
        error: detalle?.error,
        duracionMs: detalle?.duracionMs,
      };
    });
    const resumen = {
      ejecutados: nodos.filter((n) => n.estado === 'listo').length,
      cacheados: nodos.filter((n) => n.estado === 'cacheado').length,
      omitidos: nodos.filter((n) => n.estado === 'desactivado').length,
      bloqueados: nodos.filter((n) => n.estado === 'bloqueado').length,
      errores: nodos.filter((n) => n.estado === 'error').length,
      cancelados: nodos.filter((n) => n.estado === 'cancelado').length,
    };
    const informe: InformeEjecucion = {
      iniciadoEn,
      finalizadoEn,
      duracionTotalMs: finalizadoEn - iniciadoEn,
      objetivos,
      nodos,
      resumen,
    };
    this.emitir({ tipo: 'ejecucion:fin', informe });
    return informe;
  }

  private async ejecutarNodo(grafo: GrafoDag, plan: PlanNodo): Promise<void> {
    const { instancia, definicion, clave } = plan;
    const iniciadoEn = this.servicios.ahora();
    this.fijarEstado(instancia.id, { estado: 'ejecutando', iniciadoEn });

    // Señal del nodo: encadena la cancelación global con el timeout propio.
    const controlNodo = new AbortController();
    const controlGlobal = this.controlador;
    const reenviarAborto = () => {
      const razon = (controlGlobal?.signal.reason as RazonAborto | undefined) ?? { tipo: 'cancelado' };
      controlNodo.abort(razon);
    };
    if (controlGlobal?.signal.aborted) {
      reenviarAborto();
    } else {
      controlGlobal?.signal.addEventListener('abort', reenviarAborto, { once: true });
    }
    const temporizador = setTimeout(() => {
      controlNodo.abort({ tipo: 'timeout' } satisfies RazonAborto);
    }, this.config.timeoutNodoMs);

    const contexto: ContextoProcesador = {
      servicios: this.servicios,
      senal: controlNodo.signal,
      reportarProgreso: (fraccion, mensaje) => {
        const detalle = this.estadosNodo.get(instancia.id);
        if (detalle && detalle.estado === 'ejecutando') {
          this.fijarEstado(instancia.id, { ...detalle, progreso: fraccion, mensajeProgreso: mensaje });
        }
      },
      registrar: (mensaje) => {
        this.servicios.registrar(`[nodo ${definicion.tipo} ${instancia.id.slice(0, 8)}] ${mensaje}`);
      },
    };

    try {
      // Entradas por puerto con los valores de las salidas aguas arriba.
      const entradas: Record<string, ValorPuerto[]> = {};
      for (const puerto of definicion.entradas) {
        const valores: ValorPuerto[] = [];
        for (const arista of grafo.aristasHacia(instancia.id, puerto.clave)) {
          const resultado = this.ultimoResultado.get(arista.origen.nodo);
          const valor = resultado?.salidas[arista.origen.puerto];
          if (!valor) {
            throw new ErrorConfiguracion({
              codigo: 'MOTOR_SALIDA_AUSENTE',
              mensaje: `Falta la salida ${arista.origen.puerto} del nodo ${arista.origen.nodo}.`,
              mensajeUsuario: 'Una conexión entrante no tiene salida disponible. Vuelve a ejecutar el grafo completo.',
              reintentable: true,
            });
          }
          valores.push(valor);
        }
        entradas[puerto.clave] = valores;
      }

      const entradaEjecucion: EntradaEjecucion = {
        nodo: instancia,
        parametros: plan.parametros,
        entradas,
      };
      const salida: SalidaEjecucion = await definicion.crearProcesador().ejecutar(entradaEjecucion, contexto);

      // Validación del contrato de salida: todo puerto declarado, presente y bien tipado.
      const fallo = this.validarSalidas(definicion, salida);
      if (fallo) {
        throw fallo;
      }

      const resultado: ResultadoNodo = {
        clave,
        nodoId: instancia.id,
        salidas: salida.salidas,
        creadoEn: this.servicios.ahora(),
      };
      this.cache.poner(resultado);
      this.ultimoResultado.set(instancia.id, resultado);
      const finalizadoEn = this.servicios.ahora();
      this.fijarEstado(instancia.id, {
        estado: 'listo',
        iniciadoEn,
        finalizadoEn,
        duracionMs: finalizadoEn - iniciadoEn,
        salidas: salida.salidas,
      });
    } catch (lanzada) {
      const razon = controlNodo.signal.reason as RazonAborto | undefined;
      const cancelado = this.controlador?.signal.aborted === true && razon?.tipo !== 'timeout';
      const finalizadoEn = this.servicios.ahora();
      if (cancelado) {
        this.fijarEstado(instancia.id, {
          estado: 'cancelado',
          iniciadoEn,
          finalizadoEn,
          duracionMs: finalizadoEn - iniciadoEn,
        });
      } else if (razon?.tipo === 'timeout') {
        const error = new ErrorTemporal({
          codigo: 'NODO_TIMEOUT',
          mensaje: `El nodo ${definicion.tipo} excedió ${this.config.timeoutNodoMs} ms.`,
          mensajeUsuario: `"${definicion.etiqueta}" superó el tiempo máximo de ejecución. Puedes reintentarlo o ampliar el límite en la configuración.`,
          reintentable: true,
        });
        this.fijarEstado(instancia.id, {
          estado: 'error',
          error: error.detalle,
          iniciadoEn,
          finalizadoEn,
          duracionMs: finalizadoEn - iniciadoEn,
        });
        this.bloquearDependientes(grafo, instancia.id, 'entrada-error');
      } else {
        const error = clasificarError(lanzada);
        this.servicios.registrar(`Nodo ${definicion.tipo} (${instancia.id}) falló: ${error.codigo} — ${error.detalle.mensaje}`);
        this.fijarEstado(instancia.id, {
          estado: 'error',
          error: error.detalle,
          iniciadoEn,
          finalizadoEn,
          duracionMs: finalizadoEn - iniciadoEn,
        });
        this.bloquearDependientes(grafo, instancia.id, 'entrada-error');
      }
    } finally {
      clearTimeout(temporizador);
      controlGlobal?.signal.removeEventListener('abort', reenviarAborto);
    }
  }

  private validarSalidas(definicion: DefinicionNodo, salida: SalidaEjecucion): ErrorValidacion | undefined {
    for (const puerto of definicion.salidas) {
      const valor = salida?.salidas?.[puerto.clave];
      if (!valor || typeof valor !== 'object' || !('tipo' in valor)) {
        return new ErrorValidacion({
          codigo: 'CONTRATO_SALIDA_INVALIDA',
          mensaje: `El nodo "${definicion.tipo}" no produjo el puerto de salida "${puerto.clave}".`,
          mensajeUsuario: `El nodo "${definicion.etiqueta}" tiene un contrato roto: falta su salida "${puerto.etiqueta}". Notifícalo como error del nodo.`,
          reintentable: false,
        });
      }
      if (puerto.tipo === 'audio' && valor.tipo !== 'audio') {
        return new ErrorValidacion({
          codigo: 'CONTRATO_SALIDA_INVALIDA',
          mensaje: `El puerto "${puerto.clave}" de "${definicion.tipo}" debía ser audio y llegó ${String(valor.tipo)}.`,
          mensajeUsuario: `El nodo "${definicion.etiqueta}" emitió un tipo de salida inesperado.`,
          reintentable: false,
        });
      }
      if (puerto.tipo === 'dato' && valor.tipo !== 'dato') {
        return new ErrorValidacion({
          codigo: 'CONTRATO_SALIDA_INVALIDA',
          mensaje: `El puerto "${puerto.clave}" de "${definicion.tipo}" debía ser dato y llegó ${String(valor.tipo)}.`,
          mensajeUsuario: `El nodo "${definicion.etiqueta}" emitió un tipo de salida inesperado.`,
          reintentable: false,
        });
      }
    }
    return undefined;
  }

  private bloquearDependientes(grafo: GrafoDag, nodoId: IdNodo, motivo: MotivoBloqueo): void {
    for (const dependiente of grafo.dependientesTransitivos(nodoId)) {
      const detalle = this.estadosNodo.get(dependiente);
      if (detalle && (detalle.estado === 'ejecutando' || detalle.estado === 'listo' || detalle.estado === 'cacheado')) {
        continue;
      }
      this.fijarEstado(dependiente, { estado: 'bloqueado', motivoBloqueo: motivo });
    }
  }
}
