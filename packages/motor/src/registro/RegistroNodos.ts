/**
 * Registro de definiciones de nodo (catálogo).
 *
 * Punto de extensión del sistema: registrar una `DefinicionNodo` aquí hace que
 * el nodo aparezca en el motor, en la paleta de la UI y en el inspector SIN
 * modificar ningún archivo del núcleo. El registro valida el contrato completo
 * antes de aceptarlo (regla: contrato inválido no entra al motor).
 */

import { ErrorValidacion } from '../errores';
import type { DefinicionNodo } from '../contratos/nodos';
import { validarEspecificacionParametros } from '../contratos/params';

const REGEX_TIPO = /^[a-z][a-z0-9-]*$/;
const REGEX_SEMVER = /^\d+\.\d+\.\d+$/;
const REGEX_CLAVE_PUERTO = /^[a-z][a-zA-Z0-9]*$/;
const MAX_LONGITUD_ETIQUETA = 96;
const MAX_LONGITUD_DESCRIPCION = 800;
const MAX_PUERTOS = 16;
const MAX_MODOS_FALLO = 32;

export class RegistroNodos {
  private readonly definiciones = new Map<string, DefinicionNodo>();

  /** Registra una definición validando su contrato por completo. */
  registrar(definicion: DefinicionNodo): void {
    this.validar(definicion);
    this.definiciones.set(definicion.tipo, definicion);
  }

  obtener(tipo: string): DefinicionNodo | undefined {
    return this.definiciones.get(tipo);
  }

  tiene(tipo: string): boolean {
    return this.definiciones.has(tipo);
  }

  /** Listado ordenado por categoría y etiqueta, para la paleta de la UI. */
  listar(): DefinicionNodo[] {
    return [...this.definiciones.values()].sort((a, b) => {
      if (a.categoria !== b.categoria) return a.categoria.localeCompare(b.categoria, 'es');
      return a.etiqueta.localeCompare(b.etiqueta, 'es');
    });
  }

  tamano(): number {
    return this.definiciones.size;
  }

  private validar(definicion: DefinicionNodo): void {
    const fallar = (codigo: string, mensaje: string): never => {
      throw new ErrorValidacion({
        codigo,
        mensaje,
        mensajeUsuario: `El contrato del nodo "${String(definicion?.tipo)}" es inválido: ${mensaje}`,
        reintentable: false,
      });
    };

    if (!definicion || typeof definicion !== 'object') {
      fallar('REGISTRO_DEFINICION_INVALIDA', 'la definición no es un objeto.');
    }
    if (typeof definicion.tipo !== 'string' || !REGEX_TIPO.test(definicion.tipo)) {
      fallar('REGISTRO_TIPO_INVALIDO', `el tipo "${String(definicion.tipo)}" debe cumplir ^[a-z][a-z0-9-]*$.`);
    }
    if (this.definiciones.has(definicion.tipo)) {
      fallar('REGISTRO_TIPO_DUPLICADO', `el tipo "${definicion.tipo}" ya está registrado.`);
    }
    if (typeof definicion.version !== 'string' || !REGEX_SEMVER.test(definicion.version)) {
      fallar('REGISTRO_VERSION_INVALIDA', `la versión "${String(definicion.version)}" debe ser semver X.Y.Z.`);
    }
    if (typeof definicion.etiqueta !== 'string' || definicion.etiqueta.length === 0 || definicion.etiqueta.length > MAX_LONGITUD_ETIQUETA) {
      fallar('REGISTRO_ETIQUETA_INVALIDA', 'la etiqueta falta o excede la longitud máxima.');
    }
    if (typeof definicion.descripcion !== 'string' || definicion.descripcion.length === 0 || definicion.descripcion.length > MAX_LONGITUD_DESCRIPCION) {
      fallar('REGISTRO_DESCRIPCION_INVALIDA', 'la descripción falta o excede la longitud máxima.');
    }
    if (!['fuente', 'limpieza', 'edicion', 'enriquecimiento', 'salida'].includes(definicion.categoria)) {
      fallar('REGISTRO_CATEGORIA_INVALIDA', `la categoría "${String(definicion.categoria)}" no es válida.`);
    }
    if (!['cliente', 'backend'].includes(definicion.runtime)) {
      fallar('REGISTRO_RUNTIME_INVALIDO', `el runtime "${String(definicion.runtime)}" no es válido.`);
    }
    if (definicion.runtime === 'backend' && (typeof definicion.capacidadBackend !== 'string' || definicion.capacidadBackend.length === 0)) {
      fallar('REGISTRO_CAPACIDAD_FALTANTE', 'un nodo con runtime "backend" debe declarar capacidadBackend.');
    }
    if (typeof definicion.crearProcesador !== 'function') {
      fallar('REGISTRO_FABRICA_INVALIDA', 'crearProcesador debe ser una función.');
    }
    if (!Array.isArray(definicion.entradas) || definicion.entradas.length > MAX_PUERTOS) {
      fallar('REGISTRO_PUERTOS_INVALIDOS', `entradas debe ser un arreglo de hasta ${MAX_PUERTOS} puertos.`);
    }
    if (!Array.isArray(definicion.salidas) || definicion.salidas.length === 0 || definicion.salidas.length > MAX_PUERTOS) {
      fallar('REGISTRO_PUERTOS_INVALIDOS', `salidas debe ser un arreglo de entre 1 y ${MAX_PUERTOS} puertos.`);
    }
    if (definicion.entradas.some((p) => p.multiple !== true && p.ordenado === true)) {
      fallar('REGISTRO_PUERTOS_INVALIDOS', 'un puerto solo puede declarar "ordenado" si también declara "multiple".');
    }
    const validarPuertos = (puertos: DefinicionNodo['entradas'], direccion: 'entrada' | 'salida'): void => {
      const claves = new Set<string>();
      for (const puerto of puertos) {
        if (!puerto || typeof puerto.clave !== 'string' || !REGEX_CLAVE_PUERTO.test(puerto.clave)) {
          fallar('REGISTRO_PUERTO_INVALIDO', `la clave del puerto de ${direccion} debe cumplir ^[a-z][a-zA-Z0-9]*$.`);
        }
        if (claves.has(puerto.clave)) {
          fallar('REGISTRO_PUERTO_INVALIDO', `la clave de puerto "${puerto.clave}" está repetida en ${direccion}.`);
        }
        claves.add(puerto.clave);
        if (typeof puerto.etiqueta !== 'string' || puerto.etiqueta.length === 0 || puerto.etiqueta.length > MAX_LONGITUD_ETIQUETA) {
          fallar('REGISTRO_PUERTO_INVALIDO', `la etiqueta del puerto "${puerto.clave}" falta o es demasiado larga.`);
        }
        if (puerto.tipo !== 'audio' && puerto.tipo !== 'dato') {
          fallar('REGISTRO_PUERTO_INVALIDO', `el tipo del puerto "${puerto.clave}" debe ser audio|dato.`);
        }
        if (puerto.descripcion !== undefined && puerto.descripcion.length > MAX_LONGITUD_DESCRIPCION) {
          fallar('REGISTRO_PUERTO_INVALIDO', `la descripción del puerto "${puerto.clave}" excede la longitud máxima.`);
        }
      }
    };
    validarPuertos(definicion.entradas, 'entrada');
    validarPuertos(definicion.salidas, 'salida');
    for (const salida of definicion.salidas) {
      if (definicion.entradas.some((e) => e.clave === salida.clave)) {
        fallar('REGISTRO_PUERTO_INVALIDO', `la clave de puerto "${salida.clave}" se usa a la vez como entrada y salida.`);
      }
    }
    const resultadoParams = validarEspecificacionParametros(definicion.parametros ?? []);
    if (!resultadoParams.ok) {
      fallar('REGISTRO_PARAMETROS_INVALIDOS', resultadoParams.errores.map((e) => e.mensaje).join(' | '));
    }
    if (!Array.isArray(definicion.modosDeFallo) || definicion.modosDeFallo.length > MAX_MODOS_FALLO) {
      fallar('REGISTRO_MODOS_FALLO_INVALIDOS', `modosDeFallo debe ser un arreglo de hasta ${MAX_MODOS_FALLO} elementos.`);
    }
    for (const modo of definicion.modosDeFallo) {
      if (!modo || typeof modo.codigo !== 'string' || modo.codigo.length === 0) {
        fallar('REGISTRO_MODO_FALLO_INVALIDO', 'cada modo de fallo necesita un código no vacío.');
      }
      if (!['validacion', 'configuracion', 'temporal', 'autorizacion', 'critico'].includes(modo.categoria)) {
        fallar('REGISTRO_MODO_FALLO_INVALIDO', `la categoría del modo de fallo "${modo.codigo}" no es válida.`);
      }
      if (typeof modo.reintentable !== 'boolean') {
        fallar('REGISTRO_MODO_FALLO_INVALIDO', `el modo de fallo "${modo.codigo}" debe declarar reintentable booleano.`);
      }
      if (typeof modo.descripcion !== 'string' || modo.descripcion.length === 0 || modo.descripcion.length > MAX_LONGITUD_DESCRIPCION) {
        fallar('REGISTRO_MODO_FALLO_INVALIDO', `la descripción del modo de fallo "${modo.codigo}" falta o es demasiado larga.`);
      }
    }
  }
}
