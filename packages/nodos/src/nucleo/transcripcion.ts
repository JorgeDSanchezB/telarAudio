/**
 * Tipos del dato transcripcion/v1 (contrato de docs/pending/transcripcion-whisper.md)
 * y guardas de validación compartidas por los nodos que lo consumen.
 */

/** Una palabra transcrita con su ventana temporal exacta. */
export interface PalabraTranscrita {
  palabra: string;
  inicioMs: number;
  finMs: number;
}

/** Un segmento de voz con sus palabras. */
export interface SegmentoTranscrito {
  inicioMs: number;
  finMs: number;
  texto: string;
  palabras: PalabraTranscrita[];
}

/**
 * Revisión editable en el inspector (mismo idDato, nueva revisión):
 * índices globales de palabras que el usuario EXCLUYÓ del tratamiento
 * (aprobar/rechazar del original, sin puertas: edita el dato y re-ejecuta).
 */
export interface RevisionTranscripcion {
  /** Índices (posición en el aplanado de todas las palabras) a NO tocar. */
  excluirMuletillas: number[];
  /** Índices de PALABRA cuyas colocaciones de SFX quedan desactivadas. */
  desactivarSfx?: number[];
}

/** Contenido del dato transcripcion/v1. */
export interface TranscripcionV1 {
  tipoDato: 'transcripcion/v1';
  idioma: string;
  modelo: string;
  duracionMs: number;
  segmentos: SegmentoTranscrito[];
  estadisticas?: { segmentos: number; palabras: number; segundosProceso?: number };
  /** Presente solo si el usuario revisó el dato en el inspector. */
  revision?: RevisionTranscripcion;
}

export const TIPO_DATO_TRANSCRIPCION = 'transcripcion/v1';

/** Aplana todos los segmentos en una lista única de palabras. */
export function aplanarPalabras(transcripcion: TranscripcionV1): PalabraTranscrita[] {
  return transcripcion.segmentos.flatMap((segmento) => segmento.palabras);
}

/** Índice global de cada palabra dentro del aplanado (paralelo a aplanarPalabras). */
export function indicesAplanados(transcripcion: TranscripcionV1): number[][] {
  const salida: number[][] = [];
  for (const segmento of transcripcion.segmentos) {
    salida.push(segmento.palabras.map((_, i) => i));
  }
  return salida;
}

/** Normaliza una palabra para comparar con catálogos: minúsculas sin puntuación. */
export function normalizarPalabra(palabra: string): string {
  return palabra
    .toLocaleLowerCase('es')
    .replace(/[¡!¿?.,;:"'«»()\[\]—–-]/g, '')
    .trim();
}

/**
 * Valida que un contenido desconocido tiene la forma de transcripcion/v1.
 * Devuelve el contenido tipado o null (los nodos lo convierten en DATO_INCOMPATIBLE).
 */
export function comoTranscripcion(contenido: unknown): TranscripcionV1 | null {
  if (typeof contenido !== 'object' || contenido === null) return null;
  const candidato = contenido as Partial<TranscripcionV1>;
  if (candidato.tipoDato !== TIPO_DATO_TRANSCRIPCION) return null;
  if (!Array.isArray(candidato.segmentos)) return null;
  for (const segmento of candidato.segmentos) {
    if (typeof segmento?.inicioMs !== 'number' || typeof segmento?.finMs !== 'number') return null;
    if (typeof segmento?.texto !== 'string' || !Array.isArray(segmento.palabras)) return null;
    for (const palabra of segmento.palabras) {
      if (
        typeof palabra?.palabra !== 'string' ||
        typeof palabra?.inicioMs !== 'number' ||
        typeof palabra?.finMs !== 'number'
      ) {
        return null;
      }
    }
  }
  return contenido as TranscripcionV1;
}
