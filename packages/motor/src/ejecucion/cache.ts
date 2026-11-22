/**
 * Caché LRU de resultados de nodos, indexada por clave de caché.
 *
 * La clave de un nodo es un hash de (tipo, versión del contrato, parámetros
 * validados, claves de caché de las entradas). Como las claves se encadenan
 * con las de los nodos aguas arriba, cambiar un parámetro de una rama cambia
 * la clave de esa rama y de sus dependientes, pero no la de las ramas
 * hermanas: es la invalidación selectiva que exige el proyecto.
 */

import type { ValorPuerto } from '../contratos/puertos';
import type { IdNodo } from '../contratos/grafo';

export interface ResultadoNodo {
  clave: string;
  nodoId: IdNodo;
  salidas: Record<string, ValorPuerto>;
  creadoEn: number;
}

export class CacheResultados {
  private readonly limite: number;
  /** Map conserva el orden de inserción: lo usamos como cola LRU. */
  private readonly entradas = new Map<string, ResultadoNodo>();

  constructor(limite: number) {
    if (!Number.isInteger(limite) || limite < 1) {
      throw new Error(`El límite de caché debe ser un entero >= 1 (recibido ${limite})`);
    }
    this.limite = limite;
  }

  obtener(clave: string): ResultadoNodo | undefined {
    const entrada = this.entradas.get(clave);
    if (entrada) {
      // Refrescar posición LRU.
      this.entradas.delete(clave);
      this.entradas.set(clave, entrada);
    }
    return entrada;
  }

  poner(resultado: ResultadoNodo): void {
    if (this.entradas.has(resultado.clave)) {
      this.entradas.delete(resultado.clave);
    }
    this.entradas.set(resultado.clave, resultado);
    while (this.entradas.size > this.limite) {
      const masAntigua = this.entradas.keys().next();
      if (masAntigua.done) break;
      this.entradas.delete(masAntigua.value);
    }
  }

  clavesDeNodo(nodoId: string): string[] {
    return [...this.entradas.values()].filter((r) => r.nodoId === nodoId).map((r) => r.clave);
  }

  eliminarClaves(claves: string[]): void {
    for (const clave of claves) {
      this.entradas.delete(clave);
    }
  }

  vaciar(): void {
    this.entradas.clear();
  }

  tamano(): number {
    return this.entradas.size;
  }
}
