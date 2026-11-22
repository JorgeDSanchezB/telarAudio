/**
 * Pruebas de los procesadores de los nodos de análisis (transcripción,
 * muletillas, tensión, SFX, música) con servicios falsos: sin navegador, sin
 * backend real y sin fetch real (los SFX se sirven de un mapa de rutas).
 */

import { describe, expect, it } from 'vitest';
import { ErrorConfiguracion, GrafoDag, RegistroNodos } from '@telar/motor';
import type {
  ClienteBackend,
  ContextoProcesador,
  DatoRegistrado,
  EntradaEjecucion,
  MetadatosActivo,
  RespuestaCapacidad,
  ServicioRegistroDatos,
  ServiciosMotor,
  ValorParametro,
} from '@telar/motor';
import { crearDefinicionTranscripcion, CAPACIDAD_TRANSCRIPCION } from './transcripcion-whisper';
import { crearDefinicionMuletillas } from './eliminacion-muletillas';
import { crearDefinicionTension } from './analisis-tension';
import { crearDefinicionSfx } from './colocacion-sfx';
import { crearDefinicionMusica } from './asignacion-musica';
import { registrarNodosIncluidos } from '../index';
import type { TranscripcionV1 } from '../nucleo/transcripcion';

// ---------------------------------------------------------- utilidades

function bufferFalso(duracionMs: number, tasa = 48_000): AudioBuffer {
  const muestras = Math.round((duracionMs / 1000) * tasa);
  const canal = new Float32Array(muestras);
  return {
    sampleRate: tasa,
    length: muestras,
    duration: muestras / tasa,
    numberOfChannels: 1,
    getChannelData: () => canal,
  } as unknown as AudioBuffer;
}

async function hashFalso(datos: ArrayBuffer | Uint8Array | string): Promise<string> {
  const texto = typeof datos === 'string' ? datos : String(datos.byteLength);
  return `h-${texto}-${Math.round(Math.random() * 1e9).toString(36)}`;
}

interface Entorno {
  servicios: ServiciosMotor;
  datos: ServicioRegistroDatos & { registros: DatoRegistrado[] };
  config: Map<string, unknown>;
  fetchRutas: Map<string, Uint8Array>;
  mezclas: Array<{ elementos: number; duracionTotalMs: number }>;
}

function crearEntorno(backend?: ClienteBackend, muletillas?: string[]): Entorno {
  const activos = new Map<string, { meta: MetadatosActivo; bytes: Uint8Array }>();
  const config = new Map<string, unknown>();
  config.set('catalogos.muletillas', muletillas ?? ['eh', 'mmm', 'o sea']);
  const fetchRutas = new Map<string, Uint8Array>();
  const mezclas: Array<{ elementos: number; duracionTotalMs: number }> = [];

  const datos: ServicioRegistroDatos & { registros: DatoRegistrado[] } = {
    registros: [],
    registrar: async (tipoDato, contenido) => {
      const dato: DatoRegistrado = {
        idDato: `dato-${datos.registros.length + 1}`,
        tipoDato,
        contenido,
        revision: 1,
        creadoEn: Date.now(),
      };
      datos.registros.push(dato);
      return dato;
    },
    obtener: (idDato) => datos.registros.find((d) => d.idDato === idDato),
    revisar: (idDato, contenido) => {
      const indice = datos.registros.findIndex((d) => d.idDato === idDato);
      if (indice < 0) throw new Error(`dato ${idDato} inexistente`);
      const revisado = { ...datos.registros[indice]!, contenido, revision: datos.registros[indice]!.revision + 1 };
      datos.registros[indice] = revisado;
      return revisado;
    },
    listar: () => [...datos.registros],
  };

  const servicios: ServiciosMotor = {
    activos: {
      obtenerMeta: (id) => activos.get(id)?.meta,
      poner: async (blob, metaSinId) => {
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
        const meta = activos.get(id)?.meta;
        return bufferFalso(meta?.duracionMs ?? 1000);
      },
    },
    render: {
      mezclar: async (plan) => {
        mezclas.push({ elementos: plan.elementos.length, duracionTotalMs: plan.duracionTotalMs });
        return bufferFalso(plan.duracionTotalMs);
      },
    },
    backend,
    datos,
    configuracion: { leer: <T,>(ruta: string): T | undefined => config.get(ruta) as T | undefined },
    hash: { sha256: hashFalso },
    registrar: () => undefined,
    ahora: () => Date.now(),
  };
  return { servicios, datos, config, fetchRutas, mezclas };
}

function contextoFalso(servicios: ServiciosMotor): ContextoProcesador {
  return {
    servicios,
    senal: new AbortController().signal,
    reportarProgreso: () => undefined,
    registrar: () => undefined,
  };
}

async function añadirActivo(entorno: Entorno, nombre: string, duracionMs: number): Promise<string> {
  const meta = await entorno.servicios.activos.poner(new Blob([new Uint8Array([1, 2, 3])]), {
    nombre,
    mime: 'audio/wav',
    duracionMs,
    tasaMuestreo: 48_000,
    canales: 1,
    bytes: 3,
    origen: 'subida',
  });
  return meta.id;
}

function transcripcionEjemplo(): TranscripcionV1 {
  return {
    tipoDato: 'transcripcion/v1',
    idioma: 'es',
    modelo: 'tiny',
    duracionMs: 6000,
    segmentos: [
      {
        inicioMs: 0,
        finMs: 6000,
        texto: 'Eh la noche caía y mmm el pueblo dormía.',
        palabras: [
          { palabra: 'Eh', inicioMs: 0, finMs: 300 },
          { palabra: 'la', inicioMs: 800, finMs: 1000 },
          { palabra: 'noche', inicioMs: 1000, finMs: 1500 },
          { palabra: 'caía', inicioMs: 1500, finMs: 2000 },
          { palabra: 'y', inicioMs: 2000, finMs: 2100 },
          { palabra: 'mmm,', inicioMs: 2800, finMs: 3100 },
          { palabra: 'el', inicioMs: 3400, finMs: 3600 },
          { palabra: 'pueblo', inicioMs: 3600, finMs: 4100 },
          { palabra: 'dormía.', inicioMs: 4100, finMs: 4600 },
        ],
      },
    ],
  };
}

async function registrarTranscripcion(entorno: Entorno): Promise<string> {
  const dato = await entorno.datos.registrar('transcripcion/v1', transcripcionEjemplo());
  return dato.idDato;
}

function entrada(
  parametros: Record<string, ValorParametro>,
  puertos: Record<string, unknown>,
): EntradaEjecucion {
  return {
    nodo: { id: 'n1', tipo: 'prueba', parametros: {}, posicion: { x: 0, y: 0 }, desactivado: false, creadoEn: 0 },
    parametros,
    entradas: puertos as Record<string, EntradaEjecucion['entradas'][string]>,
  };
}

// ------------------------------------------------------------ transcripción

describe('nodo transcripcion-whisper', () => {
  it('sin backend falla con BACKEND_NO_CONFIGURADO', async () => {
    const entorno = crearEntorno();
    const definicion = crearDefinicionTranscripcion({ modeloDefecto: 'tiny' });
    const id = await añadirActivo(entorno, 'relato.wav', 6000);
    await expect(
      definicion.crearProcesador().ejecutar(
        entrada({ modelo: 'tiny', idioma: 'es' }, { entrada: [{ tipo: 'audio', idActivo: id }] }),
        contextoFalso(entorno.servicios),
      ),
    ).rejects.toMatchObject({ codigo: 'BACKEND_NO_CONFIGURADO' });
  });

  it('delega en el backend, registra el dato y devuelve su referencia', async () => {
    let llamada: unknown = null;
    const backend: ClienteBackend = {
      verificar: async (): Promise<RespuestaCapacidad> => ({
        disponible: true,
        version: '0.1.0',
        capacidades: [CAPACIDAD_TRANSCRIPCION],
      }),
      ejecutarNodo: async () => {
        throw new Error('no debe usarse');
      },
      ejecutarNodoDato: async (params) => {
        llamada = params;
        return transcripcionEjemplo();
      },
    };
    const entorno = crearEntorno(backend);
    const definicion = crearDefinicionTranscripcion({ modeloDefecto: 'small' });
    const id = await añadirActivo(entorno, 'relato.wav', 6000);
    const salida = await definicion.crearProcesador().ejecutar(
      entrada({ modelo: 'small', idioma: 'es' }, { entrada: [{ tipo: 'audio', idActivo: id }] }),
      contextoFalso(entorno.servicios),
    );
    expect(llamada).toMatchObject({
      capacidad: CAPACIDAD_TRANSCRIPCION,
      idActivoEntrada: id,
      parametrosNodo: { modelo: 'small', idioma: 'es' },
    });
    const valor = salida.salidas['transcripcion'];
    expect(valor).toMatchObject({ tipo: 'dato', tipoDato: 'transcripcion/v1' });
    const registrado = entorno.datos.obtener((valor as { idDato: string }).idDato);
    expect(registrado?.contenido).toMatchObject({ tipoDato: 'transcripcion/v1' });
  });

  it('con backend sin capacidad falla con CAPACIDAD_NO_DISPONIBLE', async () => {
    const backend: ClienteBackend = {
      verificar: async () => ({ disponible: true, capacidades: [] }),
      ejecutarNodo: async () => {
        throw new Error('no debe usarse');
      },
      ejecutarNodoDato: async () => {
        throw new Error('no debe usarse');
      },
    };
    const entorno = crearEntorno(backend);
    const definicion = crearDefinicionTranscripcion({ modeloDefecto: 'tiny' });
    const id = await añadirActivo(entorno, 'relato.wav', 6000);
    await expect(
      definicion.crearProcesador().ejecutar(
        entrada({ modelo: 'tiny', idioma: 'es' }, { entrada: [{ tipo: 'audio', idActivo: id }] }),
        contextoFalso(entorno.servicios),
      ),
    ).rejects.toMatchObject({ codigo: 'CAPACIDAD_NO_DISPONIBLE' });
  });
});

// -------------------------------------------------------------- muletillas

describe('nodo eliminacion-muletillas', () => {
  it('corta las muletillas con pausas y devuelve audio más corto', async () => {
    const entorno = crearEntorno();
    const idAudio = await añadirActivo(entorno, 'relato.wav', 6000);
    const idDato = await registrarTranscripcion(entorno);
    const definicion = crearDefinicionMuletillas();
    const salida = await definicion.crearProcesador().ejecutar(
      entrada(
        { pausaMinimaMs: 250, fundidoMs: 25, modo: 'solo_pausas' },
        {
          audio: [{ tipo: 'audio', idActivo: idAudio }],
          transcripcion: [{ tipo: 'dato', idDato, tipoDato: 'transcripcion/v1' }],
        },
      ),
      contextoFalso(entorno.servicios),
    );
    // "Eh" (300 ms) y "mmm," (300 ms) fuera → 6000 - 600 = 5400 ms.
    expect(entorno.mezclas[0]!.duracionTotalMs).toBe(5400);
    // Tramos conservados: [300,2800) y [3100,6000).
    expect(entorno.mezclas[0]!.elementos).toBe(2);
    expect(salida.salidas['salida']).toMatchObject({ tipo: 'audio' });
  });

  it('sin transcripción conectada falla con DATO_INCOMPATIBLE', async () => {
    const entorno = crearEntorno();
    const idAudio = await añadirActivo(entorno, 'relato.wav', 6000);
    const definicion = crearDefinicionMuletillas();
    await expect(
      definicion.crearProcesador().ejecutar(
        entrada({ pausaMinimaMs: 250, fundidoMs: 25, modo: 'solo_pausas' }, { audio: [{ tipo: 'audio', idActivo: idAudio }] }),
        contextoFalso(entorno.servicios),
      ),
    ).rejects.toMatchObject({ codigo: 'DATO_INCOMPATIBLE' });
  });

  it('la revisión del dato (excluir) respeta las palabras aprobadas', async () => {
    const entorno = crearEntorno();
    const idAudio = await añadirActivo(entorno, 'relato.wav', 6000);
    const idDato = await registrarTranscripcion(entorno);
    // El usuario excluye "mmm," (índice 5) en el inspector.
    const contenido = entorno.datos.obtener(idDato)!.contenido as TranscripcionV1;
    entorno.datos.revisar(idDato, { ...contenido, revision: { excluirMuletillas: [5] } });

    const definicion = crearDefinicionMuletillas();
    await definicion.crearProcesador().ejecutar(
      entrada(
        { pausaMinimaMs: 250, fundidoMs: 25, modo: 'solo_pausas' },
        {
          audio: [{ tipo: 'audio', idActivo: idAudio }],
          transcripcion: [{ tipo: 'dato', idDato, tipoDato: 'transcripcion/v1' }],
        },
      ),
      contextoFalso(entorno.servicios),
    );
    // Solo "Eh" se corta ahora → 6000 - 300 = 5700 ms.
    expect(entorno.mezclas[0]!.duracionTotalMs).toBe(5700);
  });
});

// ----------------------------------------------------------------- tensión

describe('nodo analisis-tension', () => {
  it('emite una curva tension/v1 corregible', async () => {
    const entorno = crearEntorno();
    const idDato = await registrarTranscripcion(entorno);
    const definicion = crearDefinicionTension();
    const salida = await definicion.crearProcesador().ejecutar(
      entrada({ granularidadS: 30, motor: 'heuristica' }, { transcripcion: [{ tipo: 'dato', idDato, tipoDato: 'transcripcion/v1' }] }),
      contextoFalso(entorno.servicios),
    );
    const valor = salida.salidas['curva'];
    expect(valor).toMatchObject({ tipo: 'dato', tipoDato: 'tension/v1' });
    const curva = entorno.datos.obtener((valor as { idDato: string }).idDato)?.contenido as {
      puntos: Array<{ tension: number }>;
      corregible: boolean;
    };
    expect(curva.corregible).toBe(true);
    expect(curva.puntos.length).toBeGreaterThan(0);
  });

  it('el motor LLM (pendiente) falla honestamente con MOTOR_NO_DISPONIBLE', async () => {
    const entorno = crearEntorno();
    const idDato = await registrarTranscripcion(entorno);
    const definicion = crearDefinicionTension();
    await expect(
      definicion.crearProcesador().ejecutar(
        entrada({ granularidadS: 30, motor: 'llm-backend' }, { transcripcion: [{ tipo: 'dato', idDato, tipoDato: 'transcripcion/v1' }] }),
        contextoFalso(entorno.servicios),
      ),
    ).rejects.toMatchObject({ codigo: 'MOTOR_NO_DISPONIBLE' });
  });
});

// -------------------------------------------------------------------- SFX

describe('nodo colocacion-sfx', () => {
  const FETCH_GLOBAL = globalThis.fetch;

  it('mezcla un efecto por palabra clave y emite el dato de colocaciones', async () => {
    const entorno = crearEntorno(undefined, undefined);
    entorno.config.set('catalogos.sfx', [
      { id: 'trueno', nombre: 'Trueno', ruta: '/sfx/trueno.wav', terminos: ['trueno'] },
      { id: 'campana', nombre: 'Campana', ruta: '/sfx/campana.wav', terminos: ['campana'] },
    ]);
    // Transcripción con "trueno" y "campana".
    const transcripcion = transcripcionEjemplo();
    transcripcion.segmentos[0]!.palabras.push(
      { palabra: 'trueno', inicioMs: 4700, finMs: 5200 },
      { palabra: 'campana', inicioMs: 5300, finMs: 5800 },
    );
    const dato = await entorno.datos.registrar('transcripcion/v1', transcripcion);

    const idVoz = await añadirActivo(entorno, 'relato.wav', 6000);
    // fetch falso: sirve un WAV inventado por ruta.
    (globalThis as { fetch: unknown }).fetch = async (ruta: string) =>
      new Response(new Blob([new Uint8Array([9, 9, 9])]), { status: 200 });

    try {
      const definicion = crearDefinicionSfx();
      const salida = await definicion.crearProcesador().ejecutar(
        entrada(
          { gananciaSfxDb: -12, desplazamientoMs: 0 },
          {
            voz: [{ tipo: 'audio', idActivo: idVoz }],
            transcripcion: [{ tipo: 'dato', idDato: dato.idDato, tipoDato: 'transcripcion/v1' }],
          },
        ),
        contextoFalso(entorno.servicios),
      );
      // 1 voz + 2 efectos = 3 elementos en la mezcla.
      expect(entorno.mezclas[0]!.elementos).toBe(3);
      const valor = salida.salidas['colocaciones'];
      expect(valor).toMatchObject({ tipo: 'dato', tipoDato: 'colocaciones-sfx/v1' });
      const contenido = entorno.datos.obtener((valor as { idDato: string }).idDato)?.contenido as {
        colocaciones: Array<{ nombre: string }>;
      };
      expect(contenido.colocaciones.map((c) => c.nombre)).toEqual(['Trueno', 'Campana']);
    } finally {
      (globalThis as { fetch: unknown }).fetch = FETCH_GLOBAL;
    }
  });

  it('sin voz conectada falla con SFX_SIN_VOZ', async () => {
    const entorno = crearEntorno();
    const dato = await entorno.datos.registrar('transcripcion/v1', transcripcionEjemplo());
    const definicion = crearDefinicionSfx();
    await expect(
      definicion.crearProcesador().ejecutar(
        entrada({ gananciaSfxDb: -12, desplazamientoMs: 0 }, { transcripcion: [{ tipo: 'dato', idDato: dato.idDato, tipoDato: 'transcripcion/v1' }] }),
        contextoFalso(entorno.servicios),
      ),
    ).rejects.toMatchObject({ codigo: 'SFX_SIN_VOZ' });
  });
});

// ------------------------------------------------------------------ música

describe('nodo asignacion-musica', () => {
  it('sin pista elegida falla con SIN_PISTA', async () => {
    const entorno = crearEntorno();
    const idVoz = await añadirActivo(entorno, 'relato.wav', 6000);
    const curva = await entorno.datos.registrar('tension/v1', {
      tipoDato: 'tension/v1',
      puntos: [{ inicioMs: 0, tension: 50 }],
      corregible: true,
      motor: 'heuristica',
    });
    const definicion = crearDefinicionMusica() as unknown as {
      crearProcesador(): { ejecutar(entrada: EntradaEjecucion, contexto: ContextoProcesador): Promise<unknown> };
    };
    await expect(
      definicion.crearProcesador().ejecutar(
        entrada(
          { pista: '', gananciaMusicaDb: -18, ducking: true, gananciaDuckingDb: -8 },
          {
            voz: [{ tipo: 'audio', idActivo: idVoz }],
            curva: [{ tipo: 'dato', idDato: curva.idDato, tipoDato: 'tension/v1' }],
          },
        ),
        contextoFalso(entorno.servicios),
      ),
    ).rejects.toMatchObject({ codigo: 'SIN_PISTA' });
  });

  it('con pista y curva mezcla voz + tramos de música', async () => {
    const entorno = crearEntorno();
    const idVoz = await añadirActivo(entorno, 'relato.wav', 10_000);
    const idPista = await añadirActivo(entorno, 'pista.wav', 4000);
    const curva = await entorno.datos.registrar('tension/v1', {
      tipoDato: 'tension/v1',
      puntos: [
        { inicioMs: 0, tension: 20 },
        { inicioMs: 5000, tension: 90 },
      ],
      corregible: true,
      motor: 'heuristica',
    });
    const definicion = crearDefinicionMusica();
    const salida = await definicion.crearProcesador().ejecutar(
      entrada(
        { pista: idPista, gananciaMusicaDb: -18, ducking: false, gananciaDuckingDb: -8 },
        {
          voz: [{ tipo: 'audio', idActivo: idVoz }],
          curva: [{ tipo: 'dato', idDato: curva.idDato, tipoDato: 'tension/v1' }],
        },
      ),
      contextoFalso(entorno.servicios),
    );
    expect(salida.salidas['mezcla']).toMatchObject({ tipo: 'audio' });
    // voz + música por bloques: al menos 1 + 3 tramos (bloque 5k, loops 4k y 8k).
    expect(entorno.mezclas[0]!.elementos).toBeGreaterThanOrEqual(4);
    expect(entorno.mezclas[0]!.duracionTotalMs).toBe(10_000);
  });
});

// ------------------------------------------------------- contrato de puertos

describe('contrato v1.1 de puertos (tipoDato)', () => {
  it('el grafo rechaza conectar datos de subtipos incompatibles', () => {
    const registro = new RegistroNodos();
    registrarNodosIncluidos(registro, { modeloTranscripcionDefecto: 'tiny' });
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    const fuente = grafo.agregarNodo({
      id: 'n-fuente',
      tipo: 'transcripcion-whisper',
      parametros: {},
      posicion: { x: 0, y: 0 },
      desactivado: false,
      creadoEn: 0,
    });
    void fuente;
    const musica = grafo.agregarNodo({
      id: 'n-musica',
      tipo: 'asignacion-musica',
      parametros: {},
      posicion: { x: 0, y: 0 },
      desactivado: false,
      creadoEn: 0,
    });
    void musica;
    // transcripcion/v1 → entrada que espera tension/v1: incompatible.
    expect(() =>
      grafo.conectar({
        origen: { nodo: 'n-fuente', puerto: 'transcripcion' },
        destino: { nodo: 'n-musica', puerto: 'curva' },
      }),
    ).toThrowError(/transcripcion\/v1.*tension\/v1|tension\/v1.*transcripcion\/v1/);
  });

  it('conecta sin fricción los subtipos compatibles', () => {
    const registro = new RegistroNodos();
    registrarNodosIncluidos(registro, { modeloTranscripcionDefecto: 'tiny' });
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo({ id: 'n-trans', tipo: 'transcripcion-whisper', parametros: {}, posicion: { x: 0, y: 0 }, desactivado: false, creadoEn: 0 });
    grafo.agregarNodo({ id: 'n-tension', tipo: 'analisis-tension', parametros: {}, posicion: { x: 0, y: 0 }, desactivado: false, creadoEn: 0 });
    const arista = grafo.conectar({
      origen: { nodo: 'n-trans', puerto: 'transcripcion' },
      destino: { nodo: 'n-tension', puerto: 'transcripcion' },
    });
    expect(arista.origen.puerto).toBe('transcripcion');
  });
});
