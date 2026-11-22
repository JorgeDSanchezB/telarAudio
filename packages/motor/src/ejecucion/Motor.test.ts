/**
 * Pruebas del motor de ejecución. Cada garantía del encabezado de Motor.ts
 * tiene aquí su caso reproducible:
 *
 *  - solo-necesarios: una rama ajena al objetivo no se computa;
 *  - desactivación: desactivar un nodo evita SU cómputo y el de lo que solo
 *    lo alimentaba, y bloquea a sus dependientes con motivo tipado;
 *  - caché selectiva: cambiar un parámetro re-ejecuta esa rama y deja las
 *    hermanas cacheadas;
 *  - paralelismo con límite de concurrencia;
 *  - tolerancia: un nodo que falla no tumba el grafo y se puede reintentar
 *    solo ese nodo;
 *  - extensibilidad: un nodo nuevo registrado en tiempo de ejecución se
 *    ejecuta sin tocar el núcleo;
 *  - cancelación y progreso.
 */

import { describe, expect, it } from 'vitest';
import {
  ErrorTemporal,
  GrafoDag,
  Motor,
  RegistroNodos,
  validarValoresParametros,
} from '@telar/motor';
import type {
  AudioProcessor,
  ConfigMotor,
  ContextoProcesador,
  DefinicionNodo,
  DefinicionPuerto,
  EntradaEjecucion,
  EspecificacionParametro,
  InstanciaNodo,
  SalidaEjecucion,
  ServiciosMotor,
} from '@telar/motor';

// ------------------------------------------------------------ utilidades

interface ContadorNodo {
  ejecuciones: number;
  eventos: Array<{ tipo: 'inicio' | 'fin'; en: number }>;
  fallarPrimeras: number;
  demoraMs: number;
}

interface EstadoPrueba {
  contadores: Map<string, ContadorNodo>;
  logs: string[];
}

function crearContador(estado: EstadoPrueba, tipo: string, demoraMs = 0): ContadorNodo {
  const contador: ContadorNodo = { ejecuciones: 0, eventos: [], fallarPrimeras: 0, demoraMs };
  estado.contadores.set(tipo, contador);
  return contador;
}

function esperar(ms: number, senal?: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => {
      senal?.removeEventListener('abort', alAbortar);
      resolver();
    }, ms);
    const alAbortar = () => {
      clearTimeout(temporizador);
      rechazar(new Error('cancelado'));
    };
    if (senal?.aborted) {
      alAbortar();
      return;
    }
    senal?.addEventListener('abort', alAbortar, { once: true });
  });
}

function definicionPrueba(
  estado: EstadoPrueba,
  tipo: string,
  opciones: {
    entradas?: DefinicionPuerto[];
    parametros?: EspecificacionParametro[];
    demoraMs?: number;
  } = {},
): DefinicionNodo {
  const contador = crearContador(estado, tipo, opciones.demoraMs ?? 0);
  const procesador: AudioProcessor = {
    async ejecutar(entrada: EntradaEjecucion, contexto: ContextoProcesador): Promise<SalidaEjecucion> {
      contador.ejecuciones += 1;
      contador.eventos.push({ tipo: 'inicio', en: Date.now() });
      contexto.reportarProgreso(0.5, `${tipo} trabajando`);
      try {
        if (contador.demoraMs > 0) {
          await esperar(contador.demoraMs, contexto.senal);
        }
        if (contador.fallarPrimeras > 0) {
          contador.fallarPrimeras -= 1;
          throw new ErrorTemporal({
            codigo: 'FALLO_PROGRAMADO',
            mensaje: 'fallo programado para la prueba',
            mensajeUsuario: 'Fallo simulado.',
            reintentable: true,
          });
        }
        const idActivo = `activo-${tipo}-${contador.ejecuciones}`;
        return { salidas: { salida: { tipo: 'audio', idActivo } } };
      } finally {
        contador.eventos.push({ tipo: 'fin', en: Date.now() });
      }
    },
  };
  return {
    tipo,
    version: '1.0.0',
    etiqueta: tipo,
    descripcion: `Nodo de prueba ${tipo}`,
    categoria: 'edicion',
    runtime: 'cliente',
    entradas: opciones.entradas ?? [],
    salidas: [{ clave: 'salida', etiqueta: 'Salida', tipo: 'audio' }],
    parametros: opciones.parametros ?? [],
    modosDeFallo: [],
    crearProcesador: () => procesador,
  };
}

function instancia(tipo: string, id: string, parametros: Record<string, unknown> = {}, desactivado = false): InstanciaNodo {
  return { id, tipo, parametros, posicion: { x: 0, y: 0 }, desactivado, creadoEn: 0 };
}

/** Puerto de entrada de audio estándar para los nodos con dependencias. */
function entradaAudio(): DefinicionPuerto {
  return { clave: 'entrada', etiqueta: 'Entrada', tipo: 'audio' };
}

function crearEntorno(configMotor: Partial<ConfigMotor> = {}) {
  const estado: EstadoPrueba = { contadores: new Map(), logs: [] };
  const registro = new RegistroNodos();
  const servicios: ServiciosMotor = {
    activos: {
      obtenerMeta: () => undefined,
      poner: async () => {
        throw new Error('no aplica en estas pruebas');
      },
      obtenerBytes: async () => {
        throw new Error('no aplica');
      },
      existe: () => false,
      eliminar: () => false,
      listar: () => [],
    },
    audio: {
      decodificar: async () => {
        throw new Error('no aplica en estas pruebas');
      },
    },
    render: {
      mezclar: async () => {
        throw new Error('no aplica en estas pruebas');
      },
    },
    hash: {
      sha256: async (datos) => {
        let acumulador = 0x811c9dc5;
        const texto = typeof datos === 'string' ? datos : String(datos.byteLength);
        for (let i = 0; i < texto.length; i += 1) {
          acumulador ^= texto.charCodeAt(i);
          acumulador = Math.imul(acumulador, 0x01000193) >>> 0;
        }
        return `hash-${acumulador.toString(16)}`;
      },
    },
    registrar: (mensaje) => {
      estado.logs.push(mensaje);
    },
    ahora: () => Date.now(),
  };
  const motor = new Motor({
    registro,
    servicios,
    config: configMotor,
  });
  return { estado, registro, motor };
}

// ---------------------------------------------------------------- pruebas

describe('Motor.ejecutar', () => {
  it('computa SOLO los nodos necesarios para el objetivo pedido', async () => {
    const { estado, registro, motor } = crearEntorno();
    registro.registrar(definicionPrueba(estado, 'eco-a'));
    registro.registrar(definicionPrueba(estado, 'eco-b', { entradas: [entradaAudio()] }));
    registro.registrar(definicionPrueba(estado, 'eco-c'));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('eco-a', 'n1'));
    grafo.agregarNodo(instancia('eco-b', 'n2'));
    grafo.agregarNodo(instancia('eco-c', 'n3'));
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    motor.fijarGrafo(grafo);

    const informe = await motor.ejecutar({ objetivos: ['n2'] });

    // n3 pertenece a una rama ajena: jamás se ejecuta.
    expect(estado.contadores.get('eco-c')!.ejecuciones).toBe(0);
    expect(estado.contadores.get('eco-a')!.ejecuciones).toBe(1);
    expect(estado.contadores.get('eco-b')!.ejecuciones).toBe(1);
    expect(informe.resumen).toEqual({
      ejecutados: 2,
      cacheados: 0,
      omitidos: 0,
      bloqueados: 0,
      errores: 0,
      cancelados: 0,
    });
    expect(informe.nodos.map((n) => n.nodoId).sort()).toEqual(['n1', 'n2']);
  });

  it('desactivar un nodo evita su cómputo, el de sus proveedores y bloquea a sus dependientes', async () => {
    const { estado, registro, motor } = crearEntorno();
    registro.registrar(definicionPrueba(estado, 'fuente-x'));
    registro.registrar(definicionPrueba(estado, 'filtro', { entradas: [entradaAudio()] }));
    registro.registrar(definicionPrueba(estado, 'salida-y', { entradas: [entradaAudio()] }));
    registro.registrar(definicionPrueba(estado, 'independiente'));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('fuente-x', 'n1'));
    grafo.agregarNodo(instancia('filtro', 'n2', {}, true));
    grafo.agregarNodo(instancia('salida-y', 'n3'));
    grafo.agregarNodo(instancia('independiente', 'n4'));
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    grafo.conectar({ origen: { nodo: 'n2', puerto: 'salida' }, destino: { nodo: 'n3', puerto: 'entrada' } });
    motor.fijarGrafo(grafo);

    const informe = await motor.ejecutar({ objetivos: ['n3', 'n4'] });

    // El filtro desactivado no se computa...
    expect(estado.contadores.get('filtro')!.ejecuciones).toBe(0);
    // ...ni su proveedor, que solo existía para alimentarlo (poda).
    expect(estado.contadores.get('fuente-x')!.ejecuciones).toBe(0);
    // La rama independiente sigue funcionando.
    expect(estado.contadores.get('independiente')!.ejecuciones).toBe(1);

    const estados = motor.estados();
    expect(estados.get('n2')?.estado).toBe('desactivado');
    expect(estados.get('n3')?.estado).toBe('bloqueado');
    expect(estados.get('n3')?.motivoBloqueo).toBe('entrada-desactivada');
    expect(estados.get('n4')?.estado).toBe('listo');
    expect(informe.resumen.omitidos).toBe(1);
    expect(informe.resumen.bloqueados).toBe(1);
    expect(informe.resumen.ejecutados).toBe(1);
  });

  it('cachea resultados y re-ejecuta solo la rama cuyo parámetro cambió', async () => {
    const { estado, registro, motor } = crearEntorno();
    const parametros: EspecificacionParametro[] = [
      { tipo: 'numero', clave: 'nivel', etiqueta: 'Nivel', defecto: 1, min: 0, max: 10 },
    ];
    registro.registrar(definicionPrueba(estado, 'rama-a', { parametros }));
    registro.registrar(definicionPrueba(estado, 'rama-b', { entradas: [entradaAudio()] }));
    registro.registrar(definicionPrueba(estado, 'hermana'));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('rama-a', 'n1'));
    grafo.agregarNodo(instancia('rama-b', 'n2'));
    grafo.agregarNodo(instancia('hermana', 'n3'));
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    motor.fijarGrafo(grafo);

    const primera = await motor.ejecutar();
    expect(primera.resumen.ejecutados).toBe(3);

    const segunda = await motor.ejecutar();
    expect(segunda.resumen.cacheados).toBe(3);
    expect(segunda.resumen.ejecutados).toBe(0);

    // Cambiar un parámetro de la rama A invalida A y su dependiente B,
    // pero la rama hermana C sigue cacheada.
    const n1 = grafo.obtenerNodo('n1')!;
    grafo.actualizarNodo({ ...n1, parametros: { nivel: 7 } });
    motor.restablecerEstados('n1');

    const tercera = await motor.ejecutar();
    expect(tercera.resumen.ejecutados).toBe(2);
    expect(tercera.resumen.cacheados).toBe(1);
    expect(estado.contadores.get('rama-a')!.ejecuciones).toBe(2);
    expect(estado.contadores.get('rama-b')!.ejecuciones).toBe(2);
    expect(estado.contadores.get('hermana')!.ejecuciones).toBe(1);
  });

  it('ejecuta en paralelo nodos independientes respetando maxConcurrencia', async () => {
    const { estado, registro, motor } = crearEntorno({ maxConcurrencia: 2 });
    registro.registrar(definicionPrueba(estado, 'lento-1', { demoraMs: 80 }));
    registro.registrar(definicionPrueba(estado, 'lento-2', { demoraMs: 80 }));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('lento-1', 'n1'));
    grafo.agregarNodo(instancia('lento-2', 'n2'));
    motor.fijarGrafo(grafo);

    const inicio = Date.now();
    await motor.ejecutar();
    const duracionParalela = Date.now() - inicio;

    const c1 = estado.contadores.get('lento-1')!;
    const c2 = estado.contadores.get('lento-2')!;
    // eventos[0] = inicio, eventos[1] = fin. Se solaparon si el primer fin
    // llegó después del último inicio.
    const primerFin = Math.min(c1.eventos[1]!.en, c2.eventos[1]!.en);
    const ultimoInicio = Math.max(c1.eventos[0]!.en, c2.eventos[0]!.en);
    expect(primerFin).toBeGreaterThan(ultimoInicio);
    expect(duracionParalela).toBeLessThan(150);

    // Con concurrencia 1 deben serializarse.
    const entorno2 = crearEntorno({ maxConcurrencia: 1 });
    entorno2.registro.registrar(definicionPrueba(entorno2.estado, 'lento-1', { demoraMs: 60 }));
    entorno2.registro.registrar(definicionPrueba(entorno2.estado, 'lento-2', { demoraMs: 60 }));
    const grafo2 = new GrafoDag((tipo) => entorno2.registro.obtener(tipo));
    grafo2.agregarNodo(instancia('lento-1', 'n1'));
    grafo2.agregarNodo(instancia('lento-2', 'n2'));
    entorno2.motor.fijarGrafo(grafo2);
    const inicioSerial = Date.now();
    await entorno2.motor.ejecutar();
    const duracionSerial = Date.now() - inicioSerial;
    const s1 = entorno2.estado.contadores.get('lento-1')!;
    const s2 = entorno2.estado.contadores.get('lento-2')!;
    const primerFinSerial = Math.min(s1.eventos[1]!.en, s2.eventos[1]!.en);
    const ultimoInicioSerial = Math.max(s1.eventos[0]!.en, s2.eventos[0]!.en);
    expect(primerFinSerial).toBeLessThanOrEqual(ultimoInicioSerial);
    expect(duracionSerial).toBeGreaterThanOrEqual(110);
  });

  it('un nodo que falla no tumba el grafo y reintentarNodo re-ejecuta solo lo necesario', async () => {
    const { estado, registro, motor } = crearEntorno();
    registro.registrar(definicionPrueba(estado, 'fuente'));
    registro.registrar(definicionPrueba(estado, 'flaky', { entradas: [entradaAudio()] }));
    registro.registrar(definicionPrueba(estado, 'final', { entradas: [entradaAudio()] }));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('fuente', 'n1'));
    grafo.agregarNodo(instancia('flaky', 'n2'));
    grafo.agregarNodo(instancia('final', 'n3'));
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    grafo.conectar({ origen: { nodo: 'n2', puerto: 'salida' }, destino: { nodo: 'n3', puerto: 'entrada' } });
    motor.fijarGrafo(grafo);

    estado.contadores.get('flaky')!.fallarPrimeras = 1;
    const primera = await motor.ejecutar();

    expect(primera.resumen.errores).toBe(1);
    expect(primera.resumen.bloqueados).toBe(1);
    const estados = motor.estados();
    expect(estados.get('n2')?.estado).toBe('error');
    expect(estados.get('n2')?.error?.codigo).toBe('FALLO_PROGRAMADO');
    expect(estados.get('n2')?.error?.categoria).toBe('temporal');
    expect(estados.get('n3')?.estado).toBe('bloqueado');
    expect(estados.get('n3')?.motivoBloqueo).toBe('entrada-error');
    // La fuente quedó lista y NO se re-ejecutará.
    expect(estados.get('n1')?.estado).toBe('listo');

    const reintento = await motor.reintentarNodo('n2');
    expect(reintento.resumen.ejecutados).toBe(2); // flaky + final
    expect(reintento.resumen.cacheados).toBe(1); // fuente
    expect(motor.estados().get('n3')?.estado).toBe('listo');
    expect(estado.contadores.get('fuente')!.ejecuciones).toBe(1);
  });

  it('rechaza ejecutar dos veces en paralelo', async () => {
    const { estado, registro, motor } = crearEntorno();
    registro.registrar(definicionPrueba(estado, 'lento', { demoraMs: 60 }));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('lento', 'n1'));
    motor.fijarGrafo(grafo);
    const promesa = motor.ejecutar();
    await expect(motor.ejecutar()).rejects.toThrowError(/ejecución en curso/i);
    await promesa;
  });

  it('cancela la ejecución y marca los nodos como cancelados', async () => {
    const { estado, registro, motor } = crearEntorno();
    registro.registrar(definicionPrueba(estado, 'largo', { demoraMs: 2000 }));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('largo', 'n1'));
    motor.fijarGrafo(grafo);
    const promesa = motor.ejecutar();
    await esperar(50);
    motor.cancelar();
    const informe = await promesa;
    expect(informe.resumen.cancelados).toBe(1);
    expect(motor.estadoDe('n1')?.estado).toBe('cancelado');
  });

  it('expone el progreso y los eventos de estado durante la ejecución', async () => {
    const { estado, registro, motor } = crearEntorno();
    registro.registrar(definicionPrueba(estado, 'con-progreso'));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('con-progreso', 'n1'));
    motor.fijarGrafo(grafo);
    const eventos: Array<{ nodoId: string; estado: string; progreso?: number }> = [];
    motor.suscribir((evento) => {
      if (evento.tipo === 'nodo:estado') {
        eventos.push({ nodoId: evento.nodoId, estado: evento.detalle.estado, progreso: evento.detalle.progreso });
      }
    });
    await motor.ejecutar();
    const estadosVistos = eventos.filter((e) => e.nodoId === 'n1').map((e) => e.estado);
    expect(estadosVistos).toContain('ejecutando');
    expect(estadosVistos).toContain('listo');
    expect(eventos.some((e) => e.progreso === 0.5)).toBe(true);
  });

  it('marca error tipado cuando los parámetros no cumplen el contrato', async () => {
    const { estado, registro, motor } = crearEntorno();
    const parametros: EspecificacionParametro[] = [
      { tipo: 'numero', clave: 'intensidad', etiqueta: 'Intensidad', defecto: 5, min: 0, max: 10 },
    ];
    registro.registrar(definicionPrueba(estado, 'con-param', { parametros }));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('con-param', 'n1', { intensidad: 99 }));
    motor.fijarGrafo(grafo);
    const informe = await motor.ejecutar();
    expect(informe.resumen.errores).toBe(1);
    expect(motor.estadoDe('n1')?.error?.codigo).toBe('PARAM_INVALIDOS');
    expect(estado.contadores.get('con-param')!.ejecuciones).toBe(0);
  });

  it('marca error tipado cuando falta una entrada requerida', async () => {
    const { estado, registro, motor } = crearEntorno();
    registro.registrar(definicionPrueba(estado, 'necesita-entrada', { entradas: [entradaAudio()] }));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('necesita-entrada', 'n1'));
    motor.fijarGrafo(grafo);
    const informe = await motor.ejecutar();
    expect(informe.resumen.errores).toBe(1);
    expect(motor.estadoDe('n1')?.error?.codigo).toBe('NODO_SIN_ENTRADA');
    expect(estado.contadores.get('necesita-entrada')!.ejecuciones).toBe(0);
  });

  it('invalidar un nodo fuerza su recomputación y la de sus dependientes', async () => {
    const { estado, registro, motor } = crearEntorno();
    registro.registrar(definicionPrueba(estado, 'base'));
    registro.registrar(definicionPrueba(estado, 'derivado', { entradas: [entradaAudio()] }));
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('base', 'n1'));
    grafo.agregarNodo(instancia('derivado', 'n2'));
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    motor.fijarGrafo(grafo);
    await motor.ejecutar();
    const segunda = await motor.ejecutar();
    expect(segunda.resumen.cacheados).toBe(2);

    motor.invalidar('n1');
    const tercera = await motor.ejecutar();
    expect(tercera.resumen.ejecutados).toBe(2);
    expect(estado.contadores.get('base')!.ejecuciones).toBe(2);
    expect(estado.contadores.get('derivado')!.ejecuciones).toBe(2);
  });

  it('EXTENSIBILIDAD: un nodo registrado en caliente se ejecuta sin tocar el núcleo', async () => {
    // El nodo "eco-de-test" se define AQUÍ, dentro del test, igual que lo
    // haría un paquete externo. El motor lo ejecuta sin ninguna modificación.
    const { registro, motor } = crearEntorno();
    const definicionExterna: DefinicionNodo = {
      tipo: 'eco-de-test',
      version: '1.0.0',
      etiqueta: 'Eco de prueba',
      descripcion: 'Nodo definido por un tercio para demostrar la extensibilidad.',
      categoria: 'edicion',
      runtime: 'cliente',
      entradas: [],
      salidas: [{ clave: 'salida', etiqueta: 'Salida', tipo: 'audio' }],
      parametros: [
        { tipo: 'numero', clave: 'repeticiones', etiqueta: 'Repeticiones', defecto: 1, min: 1, max: 5 },
      ],
      modosDeFallo: [],
      crearProcesador: () => ({
        ejecutar: async (entrada) => ({
          salidas: {
            salida: {
              tipo: 'audio',
              idActivo: `eco-${entrada.parametros.repeticiones}`,
            },
          },
        }),
      }),
    };
    registro.registrar(definicionExterna);
    const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
    grafo.agregarNodo(instancia('eco-de-test', 'n1', { repeticiones: 3 }));
    motor.fijarGrafo(grafo);
    const informe = await motor.ejecutar();
    expect(informe.resumen.ejecutados).toBe(1);
    expect(motor.salidaDe('n1')?.salidas.salida).toEqual({ tipo: 'audio', idActivo: 'eco-3' });
  });
});

describe('validarValoresParametros (contrato de parámetros)', () => {
  const specs: EspecificacionParametro[] = [
    { tipo: 'numero', clave: 'nivel', etiqueta: 'Nivel', defecto: 5, min: 0, max: 10 },
    { tipo: 'booleano', clave: 'activar', etiqueta: 'Activar', defecto: false },
    { tipo: 'opcion', clave: 'modo', etiqueta: 'Modo', defecto: 'a', opciones: [{ valor: 'a', etiqueta: 'A' }, { valor: 'b', etiqueta: 'B' }] },
  ];

  it('aplica defectos cuando la clave está ausente (ausente != nulo)', () => {
    const resultado = validarValoresParametros(specs, {});
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.valores).toEqual({ nivel: 5, activar: false, modo: 'a' });
    }
  });

  it('rechaza null sin degradarlo a defecto', () => {
    const resultado = validarValoresParametros(specs, { nivel: null });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errores[0]!.codigo).toBe('PARAM_NULO');
    }
  });

  it('rechaza fuera de rango, tipos incorrectos y claves desconocidas', () => {
    const fuera = validarValoresParametros(specs, { nivel: 11 });
    expect(fuera.ok).toBe(false);
    if (!fuera.ok) expect(fuera.errores[0]!.codigo).toBe('PARAM_FUERA_DE_RANGO');

    const tipo = validarValoresParametros(specs, { activar: 'sí' });
    expect(tipo.ok).toBe(false);
    if (!tipo.ok) expect(tipo.errores[0]!.codigo).toBe('PARAM_TIPO_INVALIDO');

    const opcion = validarValoresParametros(specs, { modo: 'z' });
    expect(opcion.ok).toBe(false);
    if (!opcion.ok) expect(opcion.errores[0]!.codigo).toBe('PARAM_OPCION_INVALIDA');

    const desconocida = validarValoresParametros(specs, { intruso: 1 });
    expect(desconocida.ok).toBe(false);
    if (!desconocida.ok) expect(desconocida.errores[0]!.codigo).toBe('PARAM_CLAVE_DESCONOCIDA');
  });
});
