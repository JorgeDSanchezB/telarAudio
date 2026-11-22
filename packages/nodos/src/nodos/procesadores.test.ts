/**
 * Pruebas de los procesadores de nodo (contrato AudioProcessor) usando
 * servicios falsos inyectados: sin navegador y sin backend real.
 */

import { describe, expect, it } from 'vitest';
import { calcularPicoDbfs } from '../nucleo/picos';
import { CAPACIDAD_LIMPIEZA_RUIDO, crearDefinicionLimpiezaRuido } from './limpieza-ruido';
import { crearDefinicionFusion } from './fusion-audios';
import { ErrorMotor, ErrorTemporal } from '@telar/motor';
import type {
  ClienteBackend,
  ContextoProcesador,
  EntradaEjecucion,
  MetadatosActivo,
  RespuestaCapacidad,
  ServiciosMotor,
  ValorPuerto,
} from '@telar/motor';

// ---------------------------------------------------------- utilidades

interface ActivoFalso {
  meta: MetadatosActivo;
  bytes: Uint8Array;
}

function bufferFalso(canales: Float32Array[], tasa = 48_000): AudioBuffer {
  const longitud = canales[0]!.length;
  return {
    sampleRate: tasa,
    length: longitud,
    duration: longitud / tasa,
    numberOfChannels: canales.length,
    getChannelData: (indice: number) => canales[indice]!,
  } as AudioBuffer;
}

async function hashFalso(datos: ArrayBuffer | Uint8Array | string): Promise<string> {
  const texto =
    typeof datos === 'string' ? datos : Array.from(datos instanceof Uint8Array ? datos : new Uint8Array(datos)).join(',');
  let acumulador = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    acumulador ^= texto.charCodeAt(i);
    acumulador = Math.imul(acumulador, 0x01000193) >>> 0;
  }
  return `h${acumulador.toString(16)}-${texto.length}`;
}

function crearServiciosFalsos(backend?: ClienteBackend) {
  const activos = new Map<string, ActivoFalso>();
  const decodificados: string[] = [];
  const mezclas: Array<{ duracionTotalMs: number; elementos: number }> = [];
  const servicios: ServiciosMotor = {
    activos: {
      obtenerMeta: (id) => activos.get(id)?.meta,
      poner: async (blob: Blob, metaSinId) => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const id = await hashFalso(bytes);
        const meta: MetadatosActivo = { ...metaSinId, id, creadoEn: Date.now() };
        activos.set(id, { meta, bytes });
        return meta;
      },
      obtenerBytes: async (id) => {
        const activo = activos.get(id);
        if (!activo) throw new Error(`activo ${id} inexistente`);
        return new Blob([activo.bytes as unknown as BlobPart]);
      },
      existe: (id) => activos.has(id),
      eliminar: (id) => activos.delete(id),
      listar: () => [...activos.values()].map((a) => a.meta),
    },
    audio: {
      decodificar: async (id) => {
        decodificados.push(id);
        const activo = activos.get(id);
        const duracionMs = activo?.meta.duracionMs ?? 1000;
        const tasa = activo?.meta.tasaMuestreo ?? 48_000;
        const muestras = Math.round((duracionMs / 1000) * tasa);
        return bufferFalso([new Float32Array(muestras)], tasa);
      },
    },
    render: {
      mezclar: async (plan) => {
        mezclas.push({ duracionTotalMs: plan.duracionTotalMs, elementos: plan.elementos.length });
        const muestras = Math.round((plan.duracionTotalMs / 1000) * 48_000);
        return bufferFalso([new Float32Array(muestras)], 48_000);
      },
    },
    backend,
    hash: { sha256: hashFalso },
    registrar: () => undefined,
    ahora: () => Date.now(),
  };
  return { servicios, activos, decodificados, mezclas };
}

async function añadirActivo(
  servicios: ServiciosMotor,
  nombre: string,
  duracionMs: number,
): Promise<string> {
  // Cada activo debe tener contenido DISTINTO: el almacén está direccionado
  // por contenido, así que bytes iguales colapsarían en el mismo id.
  let semilla = 0;
  for (const caracter of nombre) {
    semilla = (semilla * 31 + caracter.charCodeAt(0)) % 251;
  }
  const bytes = new Uint8Array(8 + (semilla % 8));
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = (semilla + i) % 256;
  }
  const meta = await servicios.activos.poner(new Blob([bytes as unknown as BlobPart]), {
    nombre,
    mime: 'audio/wav',
    duracionMs,
    tasaMuestreo: 48_000,
    canales: 1,
    bytes: bytes.byteLength,
    origen: 'subida',
  });
  return meta.id;
}

/** Espera un ErrorMotor con el código dado y opcionalmente un patrón en el mensaje para el usuario. */
async function esperarErrorMotor(accion: () => Promise<unknown>, codigo: string, patronUsuario?: RegExp): Promise<void> {
  let capturado: unknown;
  try {
    await accion();
  } catch (error) {
    capturado = error;
  }
  expect(capturado).toBeInstanceOf(ErrorMotor);
  const error = capturado as ErrorMotor;
  expect(error.codigo).toBe(codigo);
  if (patronUsuario) {
    expect(error.detalle.mensajeUsuario).toMatch(patronUsuario);
  }
}

function contextoFalso(servicios: ServiciosMotor): { contexto: ContextoProcesador; progreso: Array<{ fraccion: number; mensaje?: string }> } {
  const progreso: Array<{ fraccion: number; mensaje?: string }> = [];
  return {
    contexto: {
      servicios,
      senal: new AbortController().signal,
      reportarProgreso: (fraccion, mensaje) => {
        progreso.push({ fraccion, mensaje });
      },
      registrar: () => undefined,
    },
    progreso,
  };
}

function entradaDe(parametros: Record<string, unknown>, entradas: Record<string, ValorPuerto[]>): EntradaEjecucion {
  return {
    nodo: {
      id: 'nodo-prueba',
      tipo: 'prueba',
      parametros,
      posicion: { x: 0, y: 0 },
      desactivado: false,
      creadoEn: 0,
    },
    parametros: parametros as EntradaEjecucion['parametros'],
    entradas,
  };
}

// ------------------------------------------------------------ picos

describe('calcularPicoDbfs', () => {
  it('convierte el máximo absoluto a dBFS', () => {
    expect(calcularPicoDbfs([new Float32Array([0.5, -0.25])])).toBeCloseTo(-6.0206, 3);
    expect(calcularPicoDbfs([new Float32Array([1, -1])])).toBeCloseTo(0, 6);
    expect(calcularPicoDbfs([new Float32Array([0.001])])).toBeCloseTo(-60, 1);
  });

  it('devuelve -Infinity para silencio y usa el máximo entre canales', () => {
    expect(calcularPicoDbfs([new Float32Array([0, 0])])).toBe(-Infinity);
    expect(calcularPicoDbfs([new Float32Array([0.1]), new Float32Array([0.4])])).toBeCloseTo(-7.9588, 3);
  });

  it('rechaza entradas sin canales', () => {
    expect(() => calcularPicoDbfs([])).toThrowError(/PICOS_SIN_CANALES/);
  });
});

// ------------------------------------------------------------ fusión

describe('nodo fusión-audios (procesador)', () => {
  it('fusiona en orden, registra el resultado y reporta progreso', async () => {
    const { servicios, mezclas } = crearServiciosFalsos();
    const idA = await añadirActivo(servicios, 'a.wav', 1000);
    const idB = await añadirActivo(servicios, 'b.wav', 2000);
    const definicion = crearDefinicionFusion();
    const { contexto, progreso } = contextoFalso(servicios);
    const salida = await definicion.crearProcesador().ejecutar(
      // El motor entrega parámetros ya validados y con defectos aplicados;
      // una llamada directa al procesador debe hacer lo mismo.
      entradaDe(
        { separacionMs: 0, fundidoMs: 0 },
        { entradas: [{ tipo: 'audio', idActivo: idA }, { tipo: 'audio', idActivo: idB }] },
      ),
      contexto,
    );
    const valorSalida = salida.salidas['salida'];
    expect(valorSalida).toBeDefined();
    if (!valorSalida || valorSalida.tipo !== 'audio') {
      throw new Error('La salida del nodo de fusión debía ser de tipo audio');
    }
    {
      const meta = servicios.activos.obtenerMeta(valorSalida.idActivo);
      expect(meta?.mime).toBe('audio/wav');
      expect(meta?.duracionMs).toBe(3000);
      expect(meta?.origen).toBe('nodo');
    }
    expect(mezclas).toHaveLength(1);
    expect(mezclas[0]!.duracionTotalMs).toBe(3000);
    expect(mezclas[0]!.elementos).toBe(2);
    // El progreso es monótono no decreciente y termina cerca de 1.
    for (let i = 1; i < progreso.length; i += 1) {
      expect(progreso[i]!.fraccion).toBeGreaterThanOrEqual(progreso[i - 1]!.fraccion);
    }
    const ultimo = progreso[progreso.length - 1];
    expect(ultimo!.fraccion).toBeGreaterThan(0.85);
    expect(ultimo!.fraccion).toBeLessThanOrEqual(1);
  });

  it('aplica separación y respeta el orden de las aristas', async () => {
    const { servicios, mezclas } = crearServiciosFalsos();
    const idA = await añadirActivo(servicios, 'a.wav', 1000);
    const idB = await añadirActivo(servicios, 'b.wav', 500);
    const definicion = crearDefinicionFusion();
    await definicion.crearProcesador().ejecutar(
      entradaDe(
        { separacionMs: 250, fundidoMs: 10 },
        { entradas: [{ tipo: 'audio', idActivo: idB }, { tipo: 'audio', idActivo: idA }] },
      ),
      contextoFalso(servicios).contexto,
    );
    // El orden del plan es B (500) y luego A (1000+250).
    expect(mezclas[0]!.duracionTotalMs).toBe(1750);
  });

  it('falla con error tipado si no hay entradas', async () => {
    const { servicios } = crearServiciosFalsos();
    const definicion = crearDefinicionFusion();
    await esperarErrorMotor(
      () =>
        definicion.crearProcesador().ejecutar(
          entradaDe({ separacionMs: 0, fundidoMs: 0 }, { entradas: [] }),
          contextoFalso(servicios).contexto,
        ),
      'FUSION_SIN_ENTRADAS',
    );
  });

  it('falla con error de configuración si un activo desapareció', async () => {
    const { servicios } = crearServiciosFalsos();
    const definicion = crearDefinicionFusion();
    await esperarErrorMotor(
      () =>
        definicion.crearProcesador().ejecutar(
          entradaDe({ separacionMs: 0, fundidoMs: 0 }, { entradas: [{ tipo: 'audio', idActivo: 'inexistente' }] }),
          contextoFalso(servicios).contexto,
        ),
      'ACTIVO_NO_ENCONTRADO',
    );
  });
});

// ---------------------------------------------------- limpieza de ruido

describe('nodo limpieza-ruido (procesador, delegación backend)', () => {
  const entradaBase = (idActivo: string) => entradaDe({}, { entrada: [{ tipo: 'audio', idActivo }] });

  it('sin cliente de backend falla con error de configuración y mensaje accionable', async () => {
    const { servicios } = crearServiciosFalsos(undefined);
    const definicion = crearDefinicionLimpiezaRuido();
    const id = await añadirActivo(servicios, 'ruidoso.wav', 1000);
    await esperarErrorMotor(
      () => definicion.crearProcesador().ejecutar(entradaBase(id), contextoFalso(servicios).contexto),
      'BACKEND_NO_CONFIGURADO',
      /uvicorn app\.main:app/,
    );
  });

  it('con backend caído falla con BACKEND_NO_DISPONIBLE', async () => {
    const backendFalso: ClienteBackend = {
      verificar: async () => ({ disponible: false, detalle: 'conexion rechazada' }),
      ejecutarNodo: async () => {
        throw new Error('no debería llegar aquí');
      },
      ejecutarNodoDato: async () => {
        throw new Error('no implementado en el falso');
      },
    };
    const { servicios } = crearServiciosFalsos(backendFalso);
    const definicion = crearDefinicionLimpiezaRuido();
    const id = await añadirActivo(servicios, 'ruidoso.wav', 1000);
    await esperarErrorMotor(
      () => definicion.crearProcesador().ejecutar(entradaBase(id), contextoFalso(servicios).contexto),
      'BACKEND_NO_DISPONIBLE',
      /uvicorn/,
    );
  });

  it('con backend sin la capacidad falla con CAPACIDAD_NO_DISPONIBLE', async () => {
    const backendFalso: ClienteBackend = {
      verificar: async (): Promise<RespuestaCapacidad> => ({ disponible: true, capacidades: ['otra-cosa'] }),
      ejecutarNodo: async () => {
        throw new Error('no debería llegar aquí');
      },
      ejecutarNodoDato: async () => {
        throw new Error('no implementado en el falso');
      },
    };
    const { servicios } = crearServiciosFalsos(backendFalso);
    const definicion = crearDefinicionLimpiezaRuido();
    const id = await añadirActivo(servicios, 'ruidoso.wav', 1000);
    await esperarErrorMotor(
      () => definicion.crearProcesador().ejecutar(entradaBase(id), contextoFalso(servicios).contexto),
      'CAPACIDAD_NO_DISPONIBLE',
      /no ofrece limpieza/i,
    );
  });

  it('delega en el backend con capacidad y parámetros correctos y devuelve su salida', async () => {
    const llamadas: unknown[] = [];
    const backendFalso: ClienteBackend = {
      verificar: async () => ({ disponible: true, version: '0.1.0', capacidades: [CAPACIDAD_LIMPIEZA_RUIDO] }),
      ejecutarNodo: async (params) => {
        llamadas.push(params);
        return { idActivoSalida: 'activo-limpio-1' };
      },
      ejecutarNodoDato: async () => {
        throw new Error('no implementado en el falso');
      },
    };
    const { servicios } = crearServiciosFalsos(backendFalso);
    const definicion = crearDefinicionLimpiezaRuido();
    const id = await añadirActivo(servicios, 'ruidoso.wav', 1000);
    const { contexto } = contextoFalso(servicios);
    const salida = await definicion
      .crearProcesador()
      .ejecutar(entradaDe({ intensidad: 'fuerte', filtro: 'arnndn' }, { entrada: [{ tipo: 'audio', idActivo: id }] }), contexto);
    expect(salida.salidas['salida']).toEqual({ tipo: 'audio', idActivo: 'activo-limpio-1' });
    expect(llamadas).toHaveLength(1);
    const llamada = llamadas[0] as { capacidad: string; idActivoEntrada: string; parametrosNodo: Record<string, unknown> };
    expect(llamada.capacidad).toBe(CAPACIDAD_LIMPIEZA_RUIDO);
    expect(llamada.idActivoEntrada).toBe(id);
    expect(llamada.parametrosNodo).toEqual({ intensidad: 'fuerte', filtro: 'arnndn' });
  });

  it('propaga los errores temporales del backend sin tragárselos', async () => {
    const backendFalso: ClienteBackend = {
      verificar: async () => ({ disponible: true, capacidades: [CAPACIDAD_LIMPIEZA_RUIDO] }),
      ejecutarNodo: async () => {
        throw new ErrorTemporal({
          codigo: 'ERROR_TEMPORAL_BACKEND',
          mensaje: '503',
          mensajeUsuario: 'El backend está saturado.',
          reintentable: true,
        });
      },
      ejecutarNodoDato: async () => {
        throw new Error('no implementado en el falso');
      },
    };
    const { servicios } = crearServiciosFalsos(backendFalso);
    const definicion = crearDefinicionLimpiezaRuido();
    const id = await añadirActivo(servicios, 'ruidoso.wav', 1000);
    await expect(
      definicion.crearProcesador().ejecutar(entradaBase(id), contextoFalso(servicios).contexto),
    ).rejects.toThrowError(ErrorTemporal);
  });
});
