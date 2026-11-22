/**
 * Historial de undo/redo por instantáneas.
 *
 * Decisión (ADR-011): instantáneas por REFERENCIA en lugar de clonación
 * profunda o patrón Comando. Todo el documento de la línea de tiempo se
 * maneja de forma inmutable (cada operación devuelve arreglos nuevos y
 * objetos nuevos), así que guardar "el estado anterior" es apuntar a la
 * referencia anterior: O(1) y sin copiar los AudioBuffer.
 *
 * Coste: la pila mantiene hasta `limite` referencias vivas (el recolector
 * no libera esos arreglos). Con metadatos de clips el documento es pequeño
 * (unos cientos de bytes por clip), así que 100 instantáneas es trivial.
 * Alternativa descartada: patrón Comando con apply/revert por operación
 * (más complejo y frágil ante operaciones compuestas como el corte
 * destructivo, que combina eliminación de rango + rebounce).
 */
export class Historial<T> {
  private readonly limite: number;
  private readonly pilaDeshacer: T[] = [];
  private readonly pilaRehacer: T[] = [];

  constructor(limite: number) {
    if (!Number.isInteger(limite) || limite < 1) {
      throw new Error(`El límite del historial debe ser un entero >= 1 (recibido ${limite})`);
    }
    this.limite = limite;
  }

  /**
   * Registra el estado actual ANTES de una mutación. La persona que llama
   * debe hacer: `historial.apilar(estadoActual); setEstado(nuevoEstado);`
   */
  apilar(actual: T): void {
    this.pilaDeshacer.push(actual);
    if (this.pilaDeshacer.length > this.limite) {
      this.pilaDeshacer.shift();
    }
    this.pilaRehacer.length = 0;
  }

  /** Devuelve el estado anterior (o undefined) y guarda `actual` para rehacer. */
  deshacer(actual: T): T | undefined {
    const anterior = this.pilaDeshacer.pop();
    if (anterior === undefined) {
      return undefined;
    }
    this.pilaRehacer.push(actual);
    return anterior;
  }

  /** Devuelve el estado reheviable (o undefined) y restaura la pila de deshacer. */
  rehacer(actual: T): T | undefined {
    const siguiente = this.pilaRehacer.pop();
    if (siguiente === undefined) {
      return undefined;
    }
    this.pilaDeshacer.push(actual);
    if (this.pilaDeshacer.length > this.limite) {
      this.pilaDeshacer.shift();
    }
    return siguiente;
  }

  puedeDeshacer(): boolean {
    return this.pilaDeshacer.length > 0;
  }

  puedeRehacer(): boolean {
    return this.pilaRehacer.length > 0;
  }

  reiniciar(): void {
    this.pilaDeshacer.length = 0;
    this.pilaRehacer.length = 0;
  }

  tamanoDeshacer(): number {
    return this.pilaDeshacer.length;
  }

  tamanoRehacer(): number {
    return this.pilaRehacer.length;
  }
}
