/**
 * Registro de activos en memoria, direccionado por contenido (sha256 de los
 * bytes): el mismo archivo subido dos veces ocupa un solo activo y las claves
 * de caché del motor quedan ligadas al contenido de forma natural.
 *
 * La persistencia entre sesiones (IndexedDB/OPFS) está planificada en
 * docs/pending/persistencia-opfs.md; esta implementación cubre la sesión viva.
 */

import type { MetadatosActivo, ServicioRegistroActivos } from '@telar/motor';
import type { ServicioHash } from '@telar/motor';

interface EntradaActivo {
  meta: MetadatosActivo;
  blob: Blob;
}

export class RegistroActivosMemoria implements ServicioRegistroActivos {
  private readonly entradas = new Map<string, EntradaActivo>();
  private readonly hash: ServicioHash;

  constructor(hash: ServicioHash) {
    this.hash = hash;
  }

  obtenerMeta(id: string): MetadatosActivo | undefined {
    return this.entradas.get(id)?.meta;
  }

  async poner(datos: Blob, meta: Omit<MetadatosActivo, 'id' | 'creadoEn'>): Promise<MetadatosActivo> {
    const bytes = new Uint8Array(await datos.arrayBuffer());
    const id = `sha256-${await this.hash.sha256(bytes)}`;
    const existente = this.entradas.get(id);
    if (existente) {
      // Mismo contenido: se conserva el metadato original (deduplicación).
      return existente.meta;
    }
    const completa: MetadatosActivo = { ...meta, id, creadoEn: Date.now() };
    this.entradas.set(id, { meta: completa, blob: datos });
    return completa;
  }

  async obtenerBytes(id: string): Promise<Blob> {
    const entrada = this.entradas.get(id);
    if (!entrada) {
      throw new Error(`Activo inexistente: ${id}`);
    }
    return entrada.blob;
  }

  existe(id: string): boolean {
    return this.entradas.has(id);
  }

  eliminar(id: string): boolean {
    return this.entradas.delete(id);
  }

  listar(): MetadatosActivo[] {
    return [...this.entradas.values()]
      .map((entrada) => entrada.meta)
      .sort((a, b) => b.creadoEn - a.creadoEn);
  }
}
