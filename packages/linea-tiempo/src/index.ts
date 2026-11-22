/**
 * @telar/linea-tiempo — dominio del editor: tipos, operaciones puras
 * validadas e historial de undo/redo. Sin dependencias de ejecución (solo
 * tipos de @waveform-playlist/browser).
 */

export type { PistaTelar, TipoPista } from './tipos';
export type { AudioClip, ClipTrack } from '@waveform-playlist/browser';
export { dbALineal, linealADb, msAMuestras, muestrasAMs } from './tipos';

export {
  crearPistaDesdeBuffer,
  eliminarPista,
  eliminarRangoDePista,
  planificarMezclaPistas,
  sustituirPista,
  validarDocumento,
} from './operaciones';
export type { FalloValidacionDocumento, OpcionesMezcla, ResultadoEliminarRango } from './operaciones';

export { Historial } from './historial';
