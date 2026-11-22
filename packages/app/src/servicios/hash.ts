/**
 * Hash sha256 con WebCrypto (disponible en Chrome de escritorio; en localhost
 * no requiere contexto seguro adicional).
 */

import type { ServicioHash } from '@telar/motor';

export class HashWebCrypto implements ServicioHash {
  async sha256(datos: ArrayBuffer | Uint8Array | string): Promise<string> {
    const bytes =
      typeof datos === 'string'
        ? new TextEncoder().encode(datos)
        : datos instanceof Uint8Array
          ? datos
          : new Uint8Array(datos);
    const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
