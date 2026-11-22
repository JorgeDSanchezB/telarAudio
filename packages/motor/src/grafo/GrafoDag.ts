/**
 * Grafo acíclico dirigido que respalda el pipeline no lineal.
 *
 * Decisión (ADR-006): implementación propia (~200 líneas, sin dependencias)
 * en lugar de `graphology`. El motor necesita un subconjunto mínimo
 * (adición/eliminación, chequeo de ciclos, orden topológico, cierres
 * transitivos) y mantener el paquete más crítico sin dependencias facilita
 * auditario y probarlo en cualquier entorno. La API de esta clase es lo
 * bastante estrecha como que sustituirla por graphology detrás de la misma
 * interfaz sería un cambio local.
 *
 * Invariantes que esta clase garantiza por construcción:
 *  - el grafo nunca contiene ciclos (toda arista se valida antes de añadirse);
 *  - una arista conecta un puerto de salida con un puerto de entrada del mismo
 *    tipo, ambos existentes en los contratos registrados;
 *  - un puerto de entrada no `multiple` admite como máximo una arista;
 *  - no hay aristas duplicadas (mismo origen y destino);
 *  - los puertos `ordenado` exponen sus aristas ordenadas de forma estable.
 */

import { ErrorValidacion } from '../errores';
import type { DefinicionNodo } from '../contratos/nodos';
import type { Arista, DocumentoGrafo, IdArista, IdNodo, InstanciaNodo } from '../contratos/grafo';
import type { ReferenciaPuerto } from '../contratos/puertos';

/** Resolvedor de definiciones de nodo (en la práctica, el registro). */
export type ResolvedorDefiniciones = (tipo: string) => DefinicionNodo | undefined;

export interface DatosNuevaArista {
  origen: ReferenciaPuerto;
  destino: ReferenciaPuerto;
  orden?: number;
}

export class GrafoDag {
  private readonly nodos = new Map<IdNodo, InstanciaNodo>();
  private readonly aristas = new Map<IdArista, Arista>();
  private readonly salidasDeNodo = new Map<IdNodo, Set<IdArista>>();
  private readonly entradasDeNodo = new Map<IdNodo, Set<IdArista>>();
  private readonly resuelveDefinicion: ResolvedorDefiniciones;

  constructor(resuelveDefinicion: ResolvedorDefiniciones) {
    this.resuelveDefinicion = resuelveDefinicion;
  }

  /** Construye el grafo desde un documento serializado, validando todo. */
  static desdeDocumento(documento: DocumentoGrafo, resuelveDefinicion: ResolvedorDefiniciones): GrafoDag {
    const grafo = new GrafoDag(resuelveDefinicion);
    if (!documento || documento.version !== 1) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_VERSION_NO_SOPORTADA',
        mensaje: `Versión de documento de grafo no soportada: ${String(documento?.version)}`,
        mensajeUsuario: 'El proyecto fue guardado con una versión incompatible de Telar.',
        reintentable: false,
      });
    }
    for (const nodo of documento.nodos) {
      grafo.agregarNodo(nodo);
    }
    for (const arista of documento.aristas) {
      grafo.conectar({ origen: arista.origen, destino: arista.destino, orden: arista.orden });
    }
    return grafo;
  }

  aDocumento(): DocumentoGrafo {
    return {
      version: 1,
      nodos: [...this.nodos.values()],
      aristas: [...this.aristas.values()],
    };
  }

  // ------------------------------------------------------------- nodos

  agregarNodo(instancia: InstanciaNodo): void {
    if (!instancia || typeof instancia.id !== 'string' || instancia.id.length === 0) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_NODO_INVALIDO',
        mensaje: 'La instancia de nodo debe tener un id no vacío.',
        mensajeUsuario: 'No se pudo añadir el nodo: identificador inválido.',
        reintentable: false,
      });
    }
    if (this.nodos.has(instancia.id)) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_NODO_DUPLICADO',
        mensaje: `Ya existe un nodo con id ${instancia.id}.`,
        mensajeUsuario: 'El nodo que se intenta añadir ya existe en el grafo.',
        reintentable: false,
      });
    }
    if (!this.resuelveDefinicion(instancia.tipo)) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_TIPO_NO_REGISTRADO',
        mensaje: `El tipo de nodo "${instancia.tipo}" no está registrado.`,
        mensajeUsuario: `El tipo de nodo "${instancia.tipo}" no existe en el catálogo. ¿Cargaste un proyecto creado con más nodos instalados?`,
        reintentable: false,
      });
    }
    this.nodos.set(instancia.id, instancia);
    this.salidasDeNodo.set(instancia.id, new Set());
    this.entradasDeNodo.set(instancia.id, new Set());
  }

  eliminarNodo(id: IdNodo): Arista[] {
    const nodo = this.nodos.get(id);
    if (!nodo) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_NODO_INEXISTENTE',
        mensaje: `No existe el nodo ${id}.`,
        mensajeUsuario: 'El nodo que se intenta eliminar ya no está en el grafo.',
        reintentable: false,
      });
    }
    const aristasEliminadas: Arista[] = [];
    for (const idArista of [...(this.salidasDeNodo.get(id) ?? []), ...(this.entradasDeNodo.get(id) ?? [])]) {
      const arista = this.aristas.get(idArista);
      if (arista) {
        aristasEliminadas.push(arista);
        this.quitarAristaInterna(idArista);
      }
    }
    this.nodos.delete(id);
    this.salidasDeNodo.delete(id);
    this.entradasDeNodo.delete(id);
    return aristasEliminadas;
  }

  actualizarNodo(instancia: InstanciaNodo): void {
    if (!this.nodos.has(instancia.id)) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_NODO_INEXISTENTE',
        mensaje: `No existe el nodo ${instancia.id} al actualizar.`,
        mensajeUsuario: 'El nodo que se intenta actualizar ya no está en el grafo.',
        reintentable: false,
      });
    }
    const previa = this.nodos.get(instancia.id);
    if (previa && previa.tipo !== instancia.tipo) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_TIPO_INMUTABLE',
        mensaje: `No se puede cambiar el tipo del nodo ${instancia.id} (${previa.tipo} -> ${instancia.tipo}).`,
        mensajeUsuario: 'Para cambiar un nodo de tipo, elimínalo y añade uno nuevo.',
        reintentable: false,
      });
    }
    this.nodos.set(instancia.id, instancia);
  }

  obtenerNodo(id: IdNodo): InstanciaNodo | undefined {
    return this.nodos.get(id);
  }

  listarNodos(): InstanciaNodo[] {
    return [...this.nodos.values()];
  }

  // ------------------------------------------------------------ aristas

  conectar(datos: DatosNuevaArista): Arista {
    const { origen, destino } = datos;
    const definicionOrigen = this.definicionDeNodo(origen.nodo, 'origen');
    const definicionDestino = this.definicionDeNodo(destino.nodo, 'destino');
    const puertoSalida = definicionOrigen.salidas.find((p) => p.clave === origen.puerto);
    const puertoEntrada = definicionDestino.entradas.find((p) => p.clave === destino.puerto);
    if (!puertoSalida) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_PUERTO_INEXISTENTE',
        mensaje: `El nodo "${definicionOrigen.etiqueta}" no tiene el puerto de salida "${origen.puerto}".`,
        mensajeUsuario: `El puerto de salida "${origen.puerto}" no existe en ese nodo.`,
        reintentable: false,
      });
    }
    if (!puertoEntrada) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_PUERTO_INEXISTENTE',
        mensaje: `El nodo "${definicionDestino.etiqueta}" no tiene el puerto de entrada "${destino.puerto}".`,
        mensajeUsuario: `El puerto de entrada "${destino.puerto}" no existe en ese nodo.`,
        reintentable: false,
      });
    }
    if (puertoSalida.tipo !== puertoEntrada.tipo) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_TIPO_PUERTO_INCOMPATIBLE',
        mensaje: `Un puerto ${puertoSalida.tipo} no puede conectarse a un puerto ${puertoEntrada.tipo}.`,
        mensajeUsuario: 'Esos dos puertos manejan tipos de dato distintos y no se pueden conectar.',
        reintentable: false,
      });
    }
    // Contrato v1.1: si ambos extremos declaran subtipo de dato, deben coincidir.
    if (
      puertoSalida.tipoDato !== undefined &&
      puertoEntrada.tipoDato !== undefined &&
      puertoSalida.tipoDato !== puertoEntrada.tipoDato
    ) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_SUBTIPO_DATO_INCOMPATIBLE',
        mensaje: `La salida emite "${puertoSalida.tipoDato}" pero la entrada espera "${puertoEntrada.tipoDato}".`,
        mensajeUsuario:
          `Esa conexión mezcla datos incompatibles: la salida emite "${puertoSalida.tipoDato}" ` +
          `y la entrada espera "${puertoEntrada.tipoDato}".`,
        reintentable: false,
      });
    }
    if (origen.nodo === destino.nodo) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_CICLO',
        mensaje: 'Un nodo no puede conectarse a sí mismo.',
        mensajeUsuario: 'Un nodo no puede conectarse a sí mismo: crearía un ciclo.',
        reintentable: false,
      });
    }
    const existentes = this.aristasHacia(destino.nodo, destino.puerto);
    if (!puertoEntrada.multiple && existentes.length > 0) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_PUERTO_OCUPADO',
        mensaje: `El puerto de entrada "${destino.puerto}" ya tiene una conexión y no admite varias.`,
        mensajeUsuario: `El puerto "${destino.puerto}" solo admite una conexión. Desconecta la actual antes.`,
        reintentable: false,
      });
    }
    if (existentes.some((a) => a.origen.nodo === origen.nodo && a.origen.puerto === origen.puerto)) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_ARISTA_DUPLICADA',
        mensaje: `Ya existe una conexión de ${origen.nodo}:${origen.puerto} a ${destino.nodo}:${destino.puerto}.`,
        mensajeUsuario: 'Esa conexión ya existe.',
        reintentable: false,
      });
    }
    if (datos.orden !== undefined && (typeof datos.orden !== 'number' || !Number.isFinite(datos.orden))) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_ORDEN_INVALIDO',
        mensaje: `El orden de arista debe ser un número finito (recibido: ${String(datos.orden)}).`,
        mensajeUsuario: 'El orden de la conexión no es válido.',
        reintentable: false,
      });
    }
    if (this.creariaCiclo(origen.nodo, destino.nodo)) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_CICLO',
        mensaje: `Conectar ${origen.nodo} -> ${destino.nodo} crearía un ciclo.`,
        mensajeUsuario: 'No se puede crear esa conexión: cerraría un ciclo en el grafo. El motor DAG exige un grafo acíclico.',
        reintentable: false,
      });
    }
    const arista: Arista = {
      id: crypto.randomUUID(),
      origen: { ...origen },
      destino: { ...destino },
      creadoEn: Date.now(),
    };
    if (datos.orden !== undefined) {
      arista.orden = datos.orden;
    }
    this.aristas.set(arista.id, arista);
    this.salidasDeNodo.get(origen.nodo)?.add(arista.id);
    this.entradasDeNodo.get(destino.nodo)?.add(arista.id);
    return arista;
  }

  desconectar(idArista: IdArista): Arista {
    const arista = this.aristas.get(idArista);
    if (!arista) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_ARISTA_INEXISTENTE',
        mensaje: `No existe la arista ${idArista}.`,
        mensajeUsuario: 'Esa conexión ya no existe.',
        reintentable: false,
      });
    }
    this.quitarAristaInterna(idArista);
    return arista;
  }

  obtenerAristas(): Arista[] {
    return [...this.aristas.values()];
  }

  actualizarOrdenArista(idArista: IdArista, orden: number): void {
    const arista = this.aristas.get(idArista);
    if (!arista) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_ARISTA_INEXISTENTE',
        mensaje: `No existe la arista ${idArista} al cambiar su orden.`,
        mensajeUsuario: 'Esa conexión ya no existe.',
        reintentable: false,
      });
    }
    if (typeof orden !== 'number' || !Number.isFinite(orden)) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_ORDEN_INVALIDO',
        mensaje: `El orden de arista debe ser un número finito (recibido: ${String(orden)}).`,
        mensajeUsuario: 'El orden indicado no es válido.',
        reintentable: false,
      });
    }
    arista.orden = orden;
  }

  /**
   * Aristas que entran en un puerto concreto, ordenadas de forma estable:
   * por `orden` si el puerto lo declara, si no, por orden de creación.
   */
  aristasHacia(nodo: IdNodo, puerto: string): Arista[] {
    const definicion = this.nodos.get(nodo) ? this.resuelveDefinicion(this.nodos.get(nodo)!.tipo) : undefined;
    const puertoDef = definicion?.entradas.find((p) => p.clave === puerto);
    const resultado: Arista[] = [];
    for (const idArista of this.entradasDeNodo.get(nodo) ?? []) {
      const arista = this.aristas.get(idArista);
      if (arista && arista.destino.puerto === puerto) {
        resultado.push(arista);
      }
    }
    if (puertoDef?.ordenado) {
      return resultado.sort((a, b) => (a.orden ?? Number.MAX_SAFE_INTEGER) - (b.orden ?? Number.MAX_SAFE_INTEGER));
    }
    return resultado;
  }

  // ------------------------------------------------------- recorridos

  /**
   * Todas las aristas que entran en un nodo (cualquier puerto).
   * Los recorridos del motor la usan para no iterar todas las aristas.
   */
  aristasEntrantes(nodo: IdNodo): Arista[] {
    const resultado: Arista[] = [];
    for (const idArista of this.entradasDeNodo.get(nodo) ?? []) {
      const arista = this.aristas.get(idArista);
      if (arista) {
        resultado.push(arista);
      }
    }
    return resultado;
  }

  /** Cierre transitivo de dependencias (nodos de los que dependen los objetivos). */
  dependenciasTransitivas(objetivos: IdNodo[]): Set<IdNodo> {
    const cierre = new Set<IdNodo>();
    const pila = [...objetivos];
    while (pila.length > 0) {
      const id = pila.pop()!;
      for (const idArista of this.entradasDeNodo.get(id) ?? []) {
        const arista = this.aristas.get(idArista);
        if (arista && !cierre.has(arista.origen.nodo)) {
          cierre.add(arista.origen.nodo);
          pila.push(arista.origen.nodo);
        }
      }
    }
    return cierre;
  }

  /** Cierre transitivo de dependientes (nodos que dependen del nodo dado). */
  dependientesTransitivos(nodo: IdNodo): Set<IdNodo> {
    const cierre = new Set<IdNodo>();
    const pila = [nodo];
    while (pila.length > 0) {
      const id = pila.pop()!;
      for (const idArista of this.salidasDeNodo.get(id) ?? []) {
        const arista = this.aristas.get(idArista);
        if (arista && !cierre.has(arista.destino.nodo)) {
          cierre.add(arista.destino.nodo);
          pila.push(arista.destino.nodo);
        }
      }
    }
    return cierre;
  }

  /** Orden topológico (Kahn). El grafo es acíclico por construcción. */
  ordenTopologico(): IdNodo[] {
    const gradoEntrada = new Map<IdNodo, number>();
    for (const id of this.nodos.keys()) {
      gradoEntrada.set(id, this.entradasDeNodo.get(id)?.size ?? 0);
    }
    const cola: IdNodo[] = [...this.nodos.keys()].filter((id) => (gradoEntrada.get(id) ?? 0) === 0);
    const orden: IdNodo[] = [];
    while (cola.length > 0) {
      const id = cola.shift()!;
      orden.push(id);
      for (const idArista of this.salidasDeNodo.get(id) ?? []) {
        const arista = this.aristas.get(idArista);
        if (!arista) continue;
        const restante = (gradoEntrada.get(arista.destino.nodo) ?? 0) - 1;
        gradoEntrada.set(arista.destino.nodo, restante);
        if (restante === 0) {
          cola.push(arista.destino.nodo);
        }
      }
    }
    if (orden.length !== this.nodos.size) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_CICLO',
        mensaje: 'El grafo contiene un ciclo: no existe orden topológico.',
        mensajeUsuario: 'El grafo tiene un ciclo y no se puede ejecutar.',
        reintentable: false,
      });
    }
    return orden;
  }

  /** Nodos sin dependientes (candidatos a objetivo por defecto). */
  nodosHoja(): IdNodo[] {
    return [...this.nodos.keys()].filter((id) => (this.salidasDeNodo.get(id)?.size ?? 0) === 0);
  }

  /** ¿Conectar origenNodo -> destinoNodo crearía un ciclo? */
  creariaCiclo(origenNodo: IdNodo, destinoNodo: IdNodo): boolean {
    if (origenNodo === destinoNodo) return true;
    // Búsqueda en profundidad desde destinoNodo siguiendo las salidas:
    // si alcanzamos origenNodo, la nueva arista cerraría un ciclo.
    const visitados = new Set<IdNodo>();
    const pila: IdNodo[] = [destinoNodo];
    while (pila.length > 0) {
      const actual = pila.pop()!;
      if (actual === origenNodo) return true;
      if (visitados.has(actual)) continue;
      visitados.add(actual);
      for (const idArista of this.salidasDeNodo.get(actual) ?? []) {
        const arista = this.aristas.get(idArista);
        if (arista) {
          pila.push(arista.destino.nodo);
        }
      }
    }
    return false;
  }

  /** Chequeo de integridad completo (defensivo, para tests y depuración). */
  validarIntegridad(): void {
    for (const arista of this.aristas.values()) {
      this.definicionDeNodo(arista.origen.nodo, 'origen');
      this.definicionDeNodo(arista.destino.nodo, 'destino');
    }
    this.ordenTopologico();
  }

  // ------------------------------------------------------------ privados

  private definicionDeNodo(id: IdNodo, papel: 'origen' | 'destino'): DefinicionNodo {
    const instancia = this.nodos.get(id);
    if (!instancia) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_NODO_INEXISTENTE',
        mensaje: `El nodo ${id} (${papel}) no existe en el grafo.`,
        mensajeUsuario: 'La conexión involucra un nodo que no existe.',
        reintentable: false,
      });
    }
    const definicion = this.resuelveDefinicion(instancia.tipo);
    if (!definicion) {
      throw new ErrorValidacion({
        codigo: 'GRAFO_TIPO_NO_REGISTRADO',
        mensaje: `El tipo "${instancia.tipo}" del nodo ${id} no está registrado.`,
        mensajeUsuario: `El tipo de nodo "${instancia.tipo}" no está disponible en el catálogo.`,
        reintentable: false,
      });
    }
    return definicion;
  }

  private quitarAristaInterna(idArista: IdArista): void {
    const arista = this.aristas.get(idArista);
    if (!arista) return;
    this.aristas.delete(idArista);
    this.salidasDeNodo.get(arista.origen.nodo)?.delete(idArista);
    this.entradasDeNodo.get(arista.destino.nodo)?.delete(idArista);
  }
}
