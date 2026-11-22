/**
 * @telar/ui — componentes de presentación del estudio.
 *
 * Nada de estado global ni de lógica de negocio: todo entra por props y toda
 * interacción sale por callbacks. La composición y el cableado con el motor
 * viven en @telar/app.
 */

export { InsigniaEstado } from './comunes/Insignia';
export { FronteraError } from './comunes/FronteraError';
export { Icono } from './comunes/Icono';
export type { NombreIcono, PropsIcono } from './comunes/Icono';
export { Marca } from './comunes/Marca';
export type { PropsMarca } from './comunes/Marca';

export { LienzoNodos } from './lienzo/LienzoNodos';
export type { PropsLienzoNodos } from './lienzo/LienzoNodos';
export { PaletaNodos } from './lienzo/PaletaNodos';
export type { PropsPaletaNodos } from './lienzo/PaletaNodos';

export { Inspector } from './inspector/Inspector';
export type { ConexionEntrante, PropsInspector } from './inspector/Inspector';

export { EditorLineaTiempo } from './linea-tiempo/EditorLineaTiempo';
export type { PropsEditorLineaTiempo } from './linea-tiempo/EditorLineaTiempo';

export type { AccionNodo, DatosTarjetaNodo, NodoFlujo } from './tipos';
export { ETIQUETAS_CATEGORIA } from './tipos';
