/**
 * Taxonomía de errores del motor.
 *
 * Distingue explícitamente las siete situaciones de la regla de tolerancia a
 * fallos del proyecto:
 *
 *  1. Campo opcional ausente  -> no es error: `validarValoresParametros` aplica
 *     el valor por defecto declarado en la especificación del parámetro.
 *  2. Valor nulo              -> `validacion` (codigo PARAM_NULO). Nunca se
 *     convierte en silencio a un valor por defecto.
 *  3. Dato inválido           -> `validacion` (fuera de rango, tipo incorrecto,
 *     opción desconocida, clave desconocida, ciclo en el grafo, puerto mal
 *     conectado...).
 *  4. Error temporal          -> `temporal` (red caída, 429/503 del backend,
 *     timeout de nodo). Reintentable.
 *  5. Error de autorización   -> `autorizacion` (401/403 del backend).
 *  6. Error de configuración  -> `configuracion` (backend no arrancado, activo
 *     referenciado que ya no existe, ffmpeg.wasm no preparado).
 *  7. Fallo crítico           -> `critico` (excepción no clasificada dentro de
 *     un procesador). Se registra con su traza y no se oculta.
 */

export type CategoriaError = 'validacion' | 'configuracion' | 'temporal' | 'autorizacion' | 'critico';

/** Descripción estructurada y serializable de un fallo. */
export interface DetalleFallo {
  /** Código estable, p. ej. `GRAFO_CICLO`. Utilizado por la UI y los tests. */
  codigo: string;
  categoria: CategoriaError;
  /** Mensaje técnico orientado a logs. */
  mensaje: string;
  /** Mensaje accionable orientado a la persona que usa la aplicación. */
  mensajeUsuario: string;
  /** Si `true`, reintentar la misma operación puede tener sentido. */
  reintentable: boolean;
}

/** Error base del motor. Todos los fallos tipados heredan de aquí. */
export class ErrorMotor extends Error {
  readonly detalle: DetalleFallo;

  constructor(detalle: DetalleFallo, causa?: unknown) {
    super(`${detalle.codigo}: ${detalle.mensaje}`);
    this.name = 'ErrorMotor';
    this.detalle = detalle;
    if (causa !== undefined) {
      (this as { causa?: unknown }).causa = causa;
    }
  }

  get codigo(): string {
    return this.detalle.codigo;
  }

  get categoria(): CategoriaError {
    return this.detalle.categoria;
  }

  get reintentable(): boolean {
    return this.detalle.reintentable;
  }
}

export class ErrorValidacion extends ErrorMotor {
  constructor(detalle: Omit<DetalleFallo, 'categoria'>, causa?: unknown) {
    super({ ...detalle, categoria: 'validacion' }, causa);
    this.name = 'ErrorValidacion';
  }
}

export class ErrorConfiguracion extends ErrorMotor {
  constructor(detalle: Omit<DetalleFallo, 'categoria'>, causa?: unknown) {
    super({ ...detalle, categoria: 'configuracion' }, causa);
    this.name = 'ErrorConfiguracion';
  }
}

export class ErrorTemporal extends ErrorMotor {
  constructor(detalle: Omit<DetalleFallo, 'categoria'>, causa?: unknown) {
    super({ ...detalle, categoria: 'temporal' }, causa);
    this.name = 'ErrorTemporal';
  }
}

export class ErrorAutorizacion extends ErrorMotor {
  constructor(detalle: Omit<DetalleFallo, 'categoria'>, causa?: unknown) {
    super({ ...detalle, categoria: 'autorizacion' }, causa);
    this.name = 'ErrorAutorizacion';
  }
}

export class ErrorCritico extends ErrorMotor {
  constructor(detalle: Omit<DetalleFallo, 'categoria'>, causa?: unknown) {
    super({ ...detalle, categoria: 'critico' }, causa);
    this.name = 'ErrorCritico';
  }
}

/**
 * Cancelación de una ejecución. No es un fallo: el motor la detecta y marca el
 * nodo como `cancelado` en lugar de `error`.
 */
export class ErrorCancelacion extends Error {
  constructor(mensaje = 'Ejecución cancelada') {
    super(mensaje);
    this.name = 'ErrorCancelacion';
  }
}

/**
 * Convierte cualquier valor lanzado en un `ErrorMotor` clasificado.
 * Se usa en el borde del motor: nunca se deja escapar una excepción sin
 * clasificar (regla: fallo crítico registrado, no oculto).
 */
export function clasificarError(lanzada: unknown): ErrorMotor {
  if (lanzada instanceof ErrorMotor) {
    return lanzada;
  }
  if (lanzada instanceof ErrorCancelacion) {
    // La cancelación se representa como error temporal no reintentable con
    // código propio; el motor la traduce a estado `cancelado`.
    return new ErrorTemporal({
      codigo: 'EJECUCION_CANCELADA',
      mensaje: lanzada.message,
      mensajeUsuario: 'La ejecución fue cancelada.',
      reintentable: false,
    });
  }
  const mensaje = lanzada instanceof Error ? lanzada.message : String(lanzada);
  return new ErrorCritico(
    {
      codigo: 'FALLO_INESPERADO',
      mensaje,
      mensajeUsuario: 'Ocurrió un fallo inesperado. Revisa el registro para más detalle.',
      reintentable: false,
    },
    lanzada,
  );
}
