/**
 * @telar/motor — núcleo del motor de procesamiento no lineal basado en DAG.
 *
 * Paquete sin dependencias externas y agnóstico de nodos concretos: no importa
 * nada de @telar/nodos ni de la UI (verificable con `rg "@telar/nodos" packages/motor`).
 */

export type {
  CategoriaError,
  DetalleFallo,
} from './errores';
export {
  ErrorAutorizacion,
  ErrorCancelacion,
  ErrorConfiguracion,
  ErrorCritico,
  ErrorMotor,
  ErrorTemporal,
  ErrorValidacion,
  clasificarError,
} from './errores';

export type {
  DefinicionPuerto,
  ReferenciaPuerto,
  TipoPuerto,
  ValorPuerto,
} from './contratos/puertos';
export { esValorAudio, esValorDato } from './contratos/puertos';

export type {
  EspecificacionParametro,
  FalloValidacionParametro,
  LimitesParametros,
  ParametroActivo,
  ParametroBooleano,
  ParametroNumero,
  ParametroOpcion,
  ResultadoValidacionParametros,
  ValorParametro,
} from './contratos/params';
export {
  LIMITES_DEFECTO_PARAMETROS,
  validarEspecificacionParametros,
  validarValoresParametros,
} from './contratos/params';

export type {
  AudioProcessor,
  CategoriaNodo,
  ContextoProcesador,
  DefinicionNodo,
  EntradaEjecucion,
  ModoFallo,
  RuntimeNodo,
  SalidaEjecucion,
} from './contratos/nodos';
export { modoFallo } from './contratos/nodos';

export type {
  Arista,
  DocumentoGrafo,
  IdArista,
  IdNodo,
  InstanciaNodo,
} from './contratos/grafo';

export type {
  ClienteBackend,
  DatoRegistrado,
  ElementoMezcla,
  MetadatosActivo,
  PlanMezcla,
  RespuestaCapacidad,
  ServicioAudio,
  ServicioConfiguracion,
  ServicioHash,
  ServicioRegistroActivos,
  ServicioRegistroDatos,
  ServicioRenderizado,
  ServiciosMotor,
} from './contratos/servicios';

export type { ConfigMotor } from './contratos/config';
export { CONFIG_DEFECTO_MOTOR, validarConfigMotor } from './contratos/config';

export { GrafoDag } from './grafo/GrafoDag';
export type { DatosNuevaArista, ResolvedorDefiniciones } from './grafo/GrafoDag';

export { RegistroNodos } from './registro/RegistroNodos';

export type {
  EstadoNodo,
  EstadoNodoDetalle,
  EventoMotor,
  InformeEjecucion,
  MotivoBloqueo,
  OpcionesEjecucion,
  OpcionesMotor,
  ResumenNodoEjecucion,
} from './ejecucion/Motor';
export { Motor } from './ejecucion/Motor';

export { CacheResultados } from './ejecucion/cache';
export type { ResultadoNodo } from './ejecucion/cache';

export { jsonCanonico } from './ejecucion/canonico';
