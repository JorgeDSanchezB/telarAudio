/**
 * Lógica pura de colocación de efectos de sonido por palabras clave
 * (migración de la Fase 2.5 de bardoStudio): el diccionario vive en la
 * configuración (catálogo auditable), cada coincidencia coloca el efecto en
 * el segundo exacto del fin de la palabra.
 */

import { aplanarPalabras, normalizarPalabra } from './transcripcion';
import type { TranscripcionV1 } from './transcripcion';

/** Un efecto del catálogo: archivo servido por la app + términos disparadores. */
export interface EfectoCatalogo {
  id: string;
  nombre: string;
  /** Ruta pública del WAV (p. ej. "/sfx/campana.wav") o id de activo ("activo:<id>"). */
  ruta: string;
  /** Términos (con sinónimos/plurales) que lo disparan. */
  terminos: string[];
  /** Ganancia propia del efecto (dB), opcional. */
  gananciaDb?: number;
}

export interface ParametrosSfx {
  gananciaSfxDb: number;
  /** Desplazamiento respecto al fin de la palabra (negativo = antes). */
  desplazamientoMs: number;
}

export interface ColocacionSfx {
  /** Índice de la palabra disparadora (en el aplanado). */
  indicePalabra: number;
  palabra: string;
  /** Efecto del catálogo que suena. */
  efecto: EfectoCatalogo;
  /** ms exacto de la mezcla donde entra el efecto. */
  enMs: number;
  /** false si la revisión del dato la desactivó (índice estable). */
  activa: boolean;
}

export interface PlanSfx {
  /** TODAS las coincidencias (activas y desactivadas), en orden estable. */
  colocaciones: ColocacionSfx[];
  /** Solo las activas (las que entran en la mezcla). */
  activas: ColocacionSfx[];
  /** Efectos del catálogo referenciados sin ruta utilizable (aviso). */
  efectosSinArchivo: EfectoCatalogo[];
}

/**
 * Aplica el diccionario sobre las palabras de la transcripción. Coincidencia:
 * igualdad exacta del término normalizado, con tolerancia de plural
 * (término + "s" / "es"). Las colocaciones desactivadas en la revisión del
 * dato (revision.desactivarSfx, por índice de colocación) se omiten.
 */
export function planSfx(
  transcripcion: TranscripcionV1,
  catalogo: EfectoCatalogo[],
  parametros: ParametrosSfx,
): PlanSfx {
  const mapa = new Map<string, EfectoCatalogo>();
  for (const efecto of catalogo) {
    for (const termino of efecto.terminos) {
      const normalizado = normalizarPalabra(termino);
      if (!normalizado) continue;
      mapa.set(normalizado, efecto);
      mapa.set(`${normalizado}s`, efecto);
      mapa.set(`${normalizado}es`, efecto);
    }
  }

  const desactivadas = new Set(transcripcion.revision?.desactivarSfx ?? []);
  const palabras = aplanarPalabras(transcripcion);
  const colocaciones: ColocacionSfx[] = [];

  palabras.forEach((palabra, indice) => {
    const normalizada = normalizarPalabra(palabra.palabra);
    const efecto = normalizada ? mapa.get(normalizada) : undefined;
    if (!efecto) return;
    const enMs = Math.max(0, palabra.finMs + parametros.desplazamientoMs);
    colocaciones.push({
      indicePalabra: indice,
      palabra: palabra.palabra,
      efecto,
      enMs,
      activa: !desactivadas.has(indice),
    });
  });

  const activas = colocaciones.filter((c) => c.activa);
  const referenciados = new Set(activas.map((c) => c.efecto.id));
  const efectosSinArchivo = catalogo.filter(
    (efecto) => referenciados.has(efecto.id) && !efecto.ruta.startsWith('activo:'),
  );
  return { colocaciones, activas, efectosSinArchivo };
}
