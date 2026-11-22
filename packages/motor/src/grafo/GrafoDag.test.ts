/**
 * Pruebas del grafo DAG: invariantes estructurales, ciclos, duplicados y
 * recorridos (dependencias/dependientes transitivos, orden topológico).
 */

import { describe, expect, it } from 'vitest';
import { ErrorValidacion, GrafoDag, RegistroNodos } from '@telar/motor';
import type { DefinicionNodo, DocumentoGrafo, InstanciaNodo } from '@telar/motor';

function definicionSimple(tipo: string): DefinicionNodo {
  return {
    tipo,
    version: '1.0.0',
    etiqueta: tipo,
    descripcion: `Nodo de prueba ${tipo}`,
    categoria: 'edicion',
    runtime: 'cliente',
    entradas: [
      { clave: 'entrada', etiqueta: 'Entrada', tipo: 'audio', multiple: true, ordenado: true },
    ],
    salidas: [{ clave: 'salida', etiqueta: 'Salida', tipo: 'audio' }],
    parametros: [],
    modosDeFallo: [],
    crearProcesador: () => ({
      ejecutar: async () => ({ salidas: { salida: { tipo: 'audio', idActivo: 'x' } } }),
    }),
  };
}

function instancia(tipo: string, id: string): InstanciaNodo {
  return { id, tipo, parametros: {}, posicion: { x: 0, y: 0 }, desactivado: false, creadoEn: 0 };
}

function grafoDePrueba() {
  const registro = new RegistroNodos();
  registro.registrar(definicionSimple('a'));
  registro.registrar(definicionSimple('b'));
  registro.registrar(definicionSimple('c'));
  const grafo = new GrafoDag((tipo) => registro.obtener(tipo));
  return { registro, grafo };
}

describe('GrafoDag', () => {
  it('rechaza nodos con tipo no registrado', () => {
    const { grafo } = grafoDePrueba();
    expect(() => grafo.agregarNodo(instancia('inexistente', 'n1'))).toThrowError(ErrorValidacion);
  });

  it('rechaza ids duplicados', () => {
    const { grafo } = grafoDePrueba();
    grafo.agregarNodo(instancia('a', 'n1'));
    expect(() => grafo.agregarNodo(instancia('a', 'n1'))).toThrowError(/duplicado/i);
  });

  it('conecta puertos válidos y rechaza puertos inexistentes', () => {
    const { grafo } = grafoDePrueba();
    grafo.agregarNodo(instancia('a', 'n1'));
    grafo.agregarNodo(instancia('b', 'n2'));
    const arista = grafo.conectar({
      origen: { nodo: 'n1', puerto: 'salida' },
      destino: { nodo: 'n2', puerto: 'entrada' },
    });
    expect(arista.origen).toEqual({ nodo: 'n1', puerto: 'salida' });
    expect(() =>
      grafo.conectar({ origen: { nodo: 'n1', puerto: 'inventado' }, destino: { nodo: 'n2', puerto: 'entrada' } }),
    ).toThrowError(/puerto/i);
  });

  it('rechaza ciclos directos e indirectos', () => {
    const { grafo } = grafoDePrueba();
    grafo.agregarNodo(instancia('a', 'n1'));
    grafo.agregarNodo(instancia('b', 'n2'));
    grafo.agregarNodo(instancia('c', 'n3'));
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    grafo.conectar({ origen: { nodo: 'n2', puerto: 'salida' }, destino: { nodo: 'n3', puerto: 'entrada' } });
    // n3 -> n1 cerraría el ciclo n1 -> n2 -> n3 -> n1
    expect(() =>
      grafo.conectar({ origen: { nodo: 'n3', puerto: 'salida' }, destino: { nodo: 'n1', puerto: 'entrada' } }),
    ).toThrowError(ErrorValidacion);
    expect(() =>
      grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n1', puerto: 'entrada' } }),
    ).toThrowError(/sí mismo/);
  });

  it('rechaza aristas duplicadas y orden inválido', () => {
    const { grafo } = grafoDePrueba();
    grafo.agregarNodo(instancia('a', 'n1'));
    grafo.agregarNodo(instancia('a', 'n2'));
    grafo.agregarNodo(instancia('b', 'n3'));
    const base = { origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n3', puerto: 'entrada' } };
    grafo.conectar(base);
    expect(() => grafo.conectar(base)).toThrowError(/duplicada/i);
    // Arista nueva (n2 -> n3) pero con orden inválido.
    expect(() =>
      grafo.conectar({ origen: { nodo: 'n2', puerto: 'salida' }, destino: { nodo: 'n3', puerto: 'entrada' }, orden: Number.NaN }),
    ).toThrowError(/orden/i);
  });

  it('elimina un nodo junto con sus aristas', () => {
    const { grafo } = grafoDePrueba();
    grafo.agregarNodo(instancia('a', 'n1'));
    grafo.agregarNodo(instancia('b', 'n2'));
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    const eliminadas = grafo.eliminarNodo('n1');
    expect(eliminadas).toHaveLength(1);
    expect(grafo.obtenerAristas()).toHaveLength(0);
    expect(grafo.listarNodos().map((n) => n.id)).toEqual(['n2']);
  });

  it('calcula dependencias y dependientes transitivos', () => {
    const { grafo } = grafoDePrueba();
    for (const [tipo, id] of [
      ['a', 'n1'],
      ['b', 'n2'],
      ['c', 'n3'],
    ] as const) {
      grafo.agregarNodo(instancia(tipo, id));
    }
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    grafo.conectar({ origen: { nodo: 'n2', puerto: 'salida' }, destino: { nodo: 'n3', puerto: 'entrada' } });
    expect([...grafo.dependenciasTransitivas(['n3'])].sort()).toEqual(['n1', 'n2']);
    expect([...grafo.dependientesTransitivos('n1')].sort()).toEqual(['n2', 'n3']);
    expect(grafo.nodosHoja()).toEqual(['n3']);
  });

  it('produce un orden topológico válido', () => {
    const { grafo } = grafoDePrueba();
    for (const [tipo, id] of [
      ['a', 'n1'],
      ['b', 'n2'],
      ['c', 'n3'],
    ] as const) {
      grafo.agregarNodo(instancia(tipo, id));
    }
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n3', puerto: 'entrada' } });
    grafo.conectar({ origen: { nodo: 'n2', puerto: 'salida' }, destino: { nodo: 'n3', puerto: 'entrada' } });
    const orden = grafo.ordenTopologico();
    expect(orden.indexOf('n1')).toBeLessThan(orden.indexOf('n3'));
    expect(orden.indexOf('n2')).toBeLessThan(orden.indexOf('n3'));
  });

  it('ordena aristas de un puerto ordenado por su campo orden', () => {
    const { grafo } = grafoDePrueba();
    for (const [tipo, id] of [
      ['a', 'n1'],
      ['a', 'n2'],
      ['b', 'n3'],
    ] as const) {
      grafo.agregarNodo(instancia(tipo, id));
    }
    // Conectar en desorden: n2 con orden 1, n1 con orden 2.
    grafo.conectar({
      origen: { nodo: 'n2', puerto: 'salida' },
      destino: { nodo: 'n3', puerto: 'entrada' },
      orden: 1,
    });
    grafo.conectar({
      origen: { nodo: 'n1', puerto: 'salida' },
      destino: { nodo: 'n3', puerto: 'entrada' },
      orden: 2,
    });
    const aristas = grafo.aristasHacia('n3', 'entrada');
    expect(aristas.map((a) => a.origen.nodo)).toEqual(['n2', 'n1']);
    grafo.actualizarOrdenArista(aristas[1]!.id, 0);
    expect(grafo.aristasHacia('n3', 'entrada').map((a) => a.origen.nodo)).toEqual(['n1', 'n2']);
  });

  it('reconstruye desde documento y valida la versión', () => {
    const { grafo, registro } = grafoDePrueba();
    grafo.agregarNodo(instancia('a', 'n1'));
    grafo.agregarNodo(instancia('b', 'n2'));
    grafo.conectar({ origen: { nodo: 'n1', puerto: 'salida' }, destino: { nodo: 'n2', puerto: 'entrada' } });
    const documento = grafo.aDocumento();
    const reconstruido = GrafoDag.desdeDocumento(documento, (tipo) => registro.obtener(tipo));
    expect(reconstruido.listarNodos()).toHaveLength(2);
    expect(reconstruido.obtenerAristas()).toHaveLength(1);
    expect(() =>
      GrafoDag.desdeDocumento({ ...documento, version: 99 } as unknown as DocumentoGrafo, (tipo) => registro.obtener(tipo)),
    ).toThrowError(/versión/i);
  });
});
