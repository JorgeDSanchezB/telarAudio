/**
 * @telar/nodos — catálogo de nodos incluidos.
 *
 * Extensibilidad: para añadir un nodo nuevo (p. ej. "normalización de
 * loudness"), crea su DefinicionNodo en un archivo nuevo y regístralo en
 * `registrarNodosIncluidos` (o desde fuera, con tu propio registro). No hay
 * que tocar @telar/motor ni @telar/ui: la paleta y el inspector se generan
 * a partir del registro.
 */

import type { RegistroNodos } from '@telar/motor';
import { crearDefinicionFuente } from './nodos/fuente-audio';
import { crearDefinicionFusion } from './nodos/fusion-audios';
import { crearDefinicionGanancia } from './nodos/ganancia';
import { crearDefinicionLimpiezaRuido } from './nodos/limpieza-ruido';
import { crearDefinicionTranscripcion } from './nodos/transcripcion-whisper';
import { crearDefinicionMuletillas } from './nodos/eliminacion-muletillas';
import { crearDefinicionTension } from './nodos/analisis-tension';
import { crearDefinicionSfx } from './nodos/colocacion-sfx';
import { crearDefinicionMusica } from './nodos/asignacion-musica';

export { calcularPicoDbfs } from './nucleo/picos';
export { calcularTamañoRiff, codificarWav } from './nucleo/codificarWav';
export { planificarFusion } from './nucleo/planificarFusion';
export type {
  ElementoPlanFusion,
  EntradaFusion,
  ParametrosFusion,
  PlanFusion,
} from './nucleo/planificarFusion';
export { LIMITE_GANANCIA_DB } from './nodos/ganancia';
export { CAPACIDAD_LIMPIEZA_RUIDO } from './nodos/limpieza-ruido';
export { CAPACIDAD_TRANSCRIPCION } from './nodos/transcripcion-whisper';
export {
  TIPO_DATO_TRANSCRIPCION,
  aplanarPalabras,
  comoTranscripcion,
  normalizarPalabra,
} from './nucleo/transcripcion';
export type {
  PalabraTranscrita,
  RevisionTranscripcion,
  SegmentoTranscrito,
  TranscripcionV1,
} from './nucleo/transcripcion';
export {
  detectarMuletillas,
  planSinMuletillas,
} from './nucleo/muletillas';
export type {
  DeteccionMuletilla,
  ParametrosMuletillas,
  PlanSinMuletillas,
  TramoConservado,
} from './nucleo/muletillas';
export { MULETILLAS_DEFECTO } from './nodos/eliminacion-muletillas';
export { TIPO_DATO_TENSION, calcularCurvaTension, comoTension } from './nucleo/tension';
export type { PuntoTension, TensionV1 } from './nucleo/tension';
export { planSfx } from './nucleo/sfx';
export type { ColocacionSfx, EfectoCatalogo, ParametrosSfx, PlanSfx } from './nucleo/sfx';
export { SFX_DEFECTO, TIPO_DATO_COLOCACIONES } from './nodos/colocacion-sfx';
export { planMusica, ventanasConVoz } from './nucleo/musica';
export type { ParametrosMusica, TramoMusica } from './nucleo/musica';

export interface OpcionesNodosIncluidos {
  /** Modelo Whisper por defecto (de la configuración de la app). */
  modeloTranscripcionDefecto?: string;
}

/** Registra en el catálogo los nodos incluidos con el proyecto. */
export function registrarNodosIncluidos(
  registro: RegistroNodos,
  opciones: OpcionesNodosIncluidos = {},
): void {
  registro.registrar(crearDefinicionFuente());
  registro.registrar(crearDefinicionFusion());
  registro.registrar(crearDefinicionGanancia());
  registro.registrar(crearDefinicionLimpiezaRuido());
  registro.registrar(
    crearDefinicionTranscripcion({
      modeloDefecto: opciones.modeloTranscripcionDefecto ?? 'small',
    }),
  );
  registro.registrar(crearDefinicionMuletillas());
  registro.registrar(crearDefinicionTension());
  registro.registrar(crearDefinicionSfx());
  registro.registrar(crearDefinicionMusica());
}
