/**
 * Especificación declarativa de parámetros de nodo (POD serializable).
 *
 * Decisión de arquitectura (ADR-008): los parámetros se describen con datos,
 * no con esquemas de código (zod/pydantic). Esto permite:
 *  - serializar proyectos completos a JSON y volver a cargarlos;
 *  - renderizar formularios dinámicos en la UI a partir de la especificación;
 *  - enviar el contrato de un nodo al backend sin duplicar definiciones.
 * La alternativa (zod embebido en cada definición) se descartó porque los
 * esquemas de zod no son serializables y obligaban a mantener dos fuentes de
 * verdad (esquema + formulario).
 *
 * Reglas de tolerancia a fallos aplicadas aquí:
 *  - clave ausente  -> se aplica el valor por defecto (caso legítimo);
 *  - valor `null`   -> error PARAM_NULO (nunca se degrada en silencio);
 *  - valor inválido -> error con código y clave concretos;
 *  - clave desconocida -> error PARAM_CLAVE_DESCONOCIDA (estricto: detecta
 *    erratas en proyectos guardados y en llamadas programáticas).
 */

export type ValorParametro = number | boolean | string;

interface BaseParametro {
  /** Identificador del parámetro. Debe cumplir `^[a-z][a-zA-Z0-9]*$`. */
  clave: string;
  /** Etiqueta visible en la UI. */
  etiqueta: string;
  descripcion?: string;
}

export interface ParametroNumero extends BaseParametro {
  tipo: 'numero';
  defecto: number;
  min?: number;
  max?: number;
  paso?: number;
  unidad?: string;
}

export interface ParametroBooleano extends BaseParametro {
  tipo: 'booleano';
  defecto: boolean;
}

export interface ParametroOpcion extends BaseParametro {
  tipo: 'opcion';
  defecto: string;
  opciones: { valor: string; etiqueta: string }[];
}

/** Selector de un activo de la biblioteca de audio de la sesión. */
export interface ParametroActivo extends BaseParametro {
  tipo: 'activo';
  /** Formato esperado del activo; hoy solo audio. */
  formato: 'audio';
  /** Cadena vacía = sin archivo elegido todavía. */
  defecto: string;
}

export type EspecificacionParametro =
  | ParametroNumero
  | ParametroBooleano
  | ParametroOpcion
  | ParametroActivo;

/** Límites que gobiernan la validación de especificaciones y de valores. */
export interface LimitesParametros {
  maxParametrosPorNodo: number;
  longitudMaxClave: number;
  longitudMaxEtiqueta: number;
  longitudMaxDescripcion: number;
  maxOpciones: number;
  longitudMaxValorOpcion: number;
}

export const LIMITES_DEFECTO_PARAMETROS: LimitesParametros = {
  maxParametrosPorNodo: 32,
  longitudMaxClave: 48,
  longitudMaxEtiqueta: 96,
  longitudMaxDescripcion: 400,
  maxOpciones: 64,
  longitudMaxValorOpcion: 64,
};

export interface FalloValidacionParametro {
  clave: string;
  codigo: string;
  mensaje: string;
}

export type ResultadoValidacionParametros =
  | { ok: true; valores: Record<string, ValorParametro> }
  | { ok: false; errores: FalloValidacionParametro[] };

const REGEX_CLAVE = /^[a-z][a-zA-Z0-9]*$/;

function esTexto(valor: unknown): valor is string {
  return typeof valor === 'string';
}

/**
 * Valida que la especificación de parámetros esté bien construida.
 * Se invoca al registrar un nodo: un contrato mal definido no llega al motor.
 */
export function validarEspecificacionParametros(
  especificaciones: EspecificacionParametro[],
  limites: LimitesParametros = LIMITES_DEFECTO_PARAMETROS,
): ResultadoValidacionParametros {
  const errores: FalloValidacionParametro[] = [];
  const claves = new Set<string>();

  if (!Array.isArray(especificaciones)) {
    return {
      ok: false,
      errores: [{ clave: '(raíz)', codigo: 'PARAM_SPEC_INVALIDA', mensaje: 'La especificación debe ser un arreglo.' }],
    };
  }
  if (especificaciones.length > limites.maxParametrosPorNodo) {
    return {
      ok: false,
      errores: [
        {
          clave: '(raíz)',
          codigo: 'PARAM_SPEC_DEMASIADOS',
          mensaje: `Un nodo declara como máximo ${limites.maxParametrosPorNodo} parámetros y se declararon ${especificaciones.length}.`,
        },
      ],
    };
  }

  for (const spec of especificaciones) {
    if (!spec || typeof spec !== 'object' || !('tipo' in spec) || !('clave' in spec)) {
      errores.push({ clave: '(desconocida)', codigo: 'PARAM_SPEC_INVALIDA', mensaje: 'Especificación incompleta.' });
      continue;
    }
    const { clave } = spec;
    const donde = `parametro "${clave}"`;
    if (!esTexto(clave) || !REGEX_CLAVE.test(clave) || clave.length > limites.longitudMaxClave) {
      errores.push({ clave: String(clave), codigo: 'PARAM_CLAVE_INVALIDA', mensaje: `La clave de ${donde} no cumple ^[a-z][a-zA-Z0-9]*$ o excede ${limites.longitudMaxClave} caracteres.` });
      continue;
    }
    if (claves.has(clave)) {
      errores.push({ clave, codigo: 'PARAM_CLAVE_DUPLICADA', mensaje: `La clave "${clave}" está repetida.` });
      continue;
    }
    claves.add(clave);
    if (!esTexto(spec.etiqueta) || spec.etiqueta.length === 0 || spec.etiqueta.length > limites.longitudMaxEtiqueta) {
      errores.push({ clave, codigo: 'PARAM_ETIQUETA_INVALIDA', mensaje: `La etiqueta de ${donde} falta o excede ${limites.longitudMaxEtiqueta} caracteres.` });
    }
    if (spec.descripcion !== undefined && (!esTexto(spec.descripcion) || spec.descripcion.length > limites.longitudMaxDescripcion)) {
      errores.push({ clave, codigo: 'PARAM_DESCRIPCION_INVALIDA', mensaje: `La descripción de ${donde} excede ${limites.longitudMaxDescripcion} caracteres.` });
    }
    switch (spec.tipo) {
      case 'numero': {
        if (typeof spec.defecto !== 'number' || !Number.isFinite(spec.defecto)) {
          errores.push({ clave, codigo: 'PARAM_DEFECTO_INVALIDO', mensaje: `El valor por defecto de ${donde} debe ser un número finito.` });
          break;
        }
        if (spec.min !== undefined && (typeof spec.min !== 'number' || !Number.isFinite(spec.min))) {
          errores.push({ clave, codigo: 'PARAM_MIN_INVALIDO', mensaje: `El mínimo de ${donde} debe ser un número finito.` });
        }
        if (spec.max !== undefined && (typeof spec.max !== 'number' || !Number.isFinite(spec.max))) {
          errores.push({ clave, codigo: 'PARAM_MAX_INVALIDO', mensaje: `El máximo de ${donde} debe ser un número finito.` });
        }
        if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
          errores.push({ clave, codigo: 'PARAM_RANGO_INVALIDO', mensaje: `En ${donde}, min (${spec.min}) es mayor que max (${spec.max}).` });
        }
        if (spec.paso !== undefined && (typeof spec.paso !== 'number' || spec.paso <= 0)) {
          errores.push({ clave, codigo: 'PARAM_PASO_INVALIDO', mensaje: `El paso de ${donde} debe ser un número positivo.` });
        }
        if (
          spec.min !== undefined &&
          spec.max !== undefined &&
          typeof spec.defecto === 'number' &&
          Number.isFinite(spec.defecto) &&
          (spec.defecto < spec.min || spec.defecto > spec.max)
        ) {
          errores.push({ clave, codigo: 'PARAM_DEFECTO_FUERA_DE_RANGO', mensaje: `El valor por defecto de ${donde} está fuera de [${spec.min}, ${spec.max}].` });
        }
        break;
      }
      case 'booleano': {
        if (typeof spec.defecto !== 'boolean') {
          errores.push({ clave, codigo: 'PARAM_DEFECTO_INVALIDO', mensaje: `El valor por defecto de ${donde} debe ser booleano.` });
        }
        break;
      }
      case 'opcion': {
        if (!Array.isArray(spec.opciones) || spec.opciones.length === 0) {
          errores.push({ clave, codigo: 'PARAM_OPCIONES_INVALIDAS', mensaje: `${donde} debe declarar al menos una opción.` });
          break;
        }
        if (spec.opciones.length > limites.maxOpciones) {
          errores.push({ clave, codigo: 'PARAM_OPCIONES_DEMASIADAS', mensaje: `${donde} excede el máximo de ${limites.maxOpciones} opciones.` });
        }
        const valores = new Set<string>();
        for (const opcion of spec.opciones) {
          if (!opcion || !esTexto(opcion.valor) || opcion.valor.length === 0 || opcion.valor.length > limites.longitudMaxValorOpcion) {
            errores.push({ clave, codigo: 'PARAM_OPCION_INVALIDA', mensaje: `Una opción de ${donde} tiene valor vacío o demasiado largo.` });
            continue;
          }
          if (valores.has(opcion.valor)) {
            errores.push({ clave, codigo: 'PARAM_OPCION_DUPLICADA', mensaje: `La opción "${opcion.valor}" de ${donde} está repetida.` });
          }
          valores.add(opcion.valor);
          if (!esTexto(opcion.etiqueta) || opcion.etiqueta.length === 0 || opcion.etiqueta.length > limites.longitudMaxEtiqueta) {
            errores.push({ clave, codigo: 'PARAM_OPCION_ETIQUETA_INVALIDA', mensaje: `La etiqueta de la opción "${opcion.valor}" de ${donde} falta o es demasiado larga.` });
          }
        }
        if (!esTexto(spec.defecto) || !valores.has(spec.defecto)) {
          errores.push({ clave, codigo: 'PARAM_DEFECTO_INVALIDO', mensaje: `El valor por defecto de ${donde} debe ser una de las opciones declaradas.` });
        }
        break;
      }
      case 'activo': {
        if (spec.formato !== 'audio') {
          errores.push({ clave, codigo: 'PARAM_FORMATO_INVALIDO', mensaje: `${donde} solo admite formato "audio".` });
        }
        if (typeof spec.defecto !== 'string') {
          errores.push({ clave, codigo: 'PARAM_DEFECTO_INVALIDO', mensaje: `El valor por defecto de ${donde} debe ser una cadena (vacía si no hay elección inicial).` });
        }
        break;
      }
      default:
        errores.push({ clave, codigo: 'PARAM_TIPO_DESCONOCIDO', mensaje: `El tipo de ${donde} no es uno de numero|booleano|opcion|activo.` });
    }
  }
  return errores.length > 0 ? { ok: false, errores } : { ok: true, valores: {} };
}

/**
 * Valida y normaliza los valores de parámetros de una instancia de nodo.
 * Devuelve solo las claves conocidas con sus valores ya resueltos
 * (aplicando defectos cuando la clave está ausente).
 */
export function validarValoresParametros(
  especificaciones: EspecificacionParametro[],
  valores: unknown,
  limites: LimitesParametros = LIMITES_DEFECTO_PARAMETROS,
): ResultadoValidacionParametros {
  const errores: FalloValidacionParametro[] = [];

  if (valores === null || typeof valores !== 'object' || Array.isArray(valores)) {
    return {
      ok: false,
      errores: [
        {
          clave: '(raíz)',
          codigo: 'PARAM_ENTRADA_INVALIDA',
          mensaje: 'Los parámetros del nodo deben ser un objeto con las claves declaradas en el contrato.',
        },
      ],
    };
  }

  const entrada = valores as Record<string, unknown>;
  const conocidas = new Set(especificaciones.map((spec) => spec.clave));
  for (const clave of Object.keys(entrada)) {
    if (!conocidas.has(clave)) {
      errores.push({
        clave,
        codigo: 'PARAM_CLAVE_DESCONOCIDA',
        mensaje: `El parámetro "${clave}" no existe en el contrato de este nodo. Revisa que el proyecto no provenga de una versión incompatible.`,
      });
    }
  }

  const resueltos: Record<string, ValorParametro> = {};
  for (const spec of especificaciones) {
    const bruto: unknown = entrada[spec.clave];
    if (bruto === undefined) {
      resueltos[spec.clave] = spec.defecto;
      continue;
    }
    if (bruto === null) {
      errores.push({ clave: spec.clave, codigo: 'PARAM_NULO', mensaje: `El parámetro "${spec.clave}" no admite null. Elimínalo para usar el valor por defecto.` });
      continue;
    }
    switch (spec.tipo) {
      case 'numero': {
        if (typeof bruto !== 'number' || !Number.isFinite(bruto)) {
          errores.push({ clave: spec.clave, codigo: 'PARAM_TIPO_INVALIDO', mensaje: `El parámetro "${spec.clave}" debe ser un número.` });
        } else if (
          (spec.min !== undefined && bruto < spec.min) ||
          (spec.max !== undefined && bruto > spec.max)
        ) {
          errores.push({
            clave: spec.clave,
            codigo: 'PARAM_FUERA_DE_RANGO',
            mensaje: `El parámetro "${spec.clave}" debe estar entre ${spec.min ?? '-inf'} y ${spec.max ?? '+inf'} (recibido: ${bruto}).`,
          });
        } else {
          resueltos[spec.clave] = bruto;
        }
        break;
      }
      case 'booleano': {
        if (typeof bruto !== 'boolean') {
          errores.push({ clave: spec.clave, codigo: 'PARAM_TIPO_INVALIDO', mensaje: `El parámetro "${spec.clave}" debe ser booleano.` });
        } else {
          resueltos[spec.clave] = bruto;
        }
        break;
      }
      case 'opcion': {
        if (typeof bruto !== 'string' || !spec.opciones.some((opcion) => opcion.valor === bruto)) {
          const permitidas = spec.opciones.map((opcion) => opcion.valor).join(', ');
          errores.push({
            clave: spec.clave,
            codigo: 'PARAM_OPCION_INVALIDA',
            mensaje: `El parámetro "${spec.clave}" debe ser una de: ${permitidas}.`,
          });
        } else {
          resueltos[spec.clave] = bruto;
        }
        break;
      }
      case 'activo': {
        if (typeof bruto !== 'string' || bruto.length === 0 || bruto.length > 128) {
          errores.push({ clave: spec.clave, codigo: 'PARAM_ACTIVO_INVALIDO', mensaje: `El parámetro "${spec.clave}" debe ser el identificador de un activo de la biblioteca.` });
        } else {
          resueltos[spec.clave] = bruto;
        }
        break;
      }
    }
  }

  void limites;
  return errores.length > 0 ? { ok: false, errores } : { ok: true, valores: resueltos };
}
