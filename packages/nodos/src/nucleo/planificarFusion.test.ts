import { describe, expect, it } from 'vitest';
import { planificarFusion } from '@telar/nodos';
import { ErrorValidacion } from '@telar/motor';

describe('planificarFusion', () => {
  it('coloca las entradas en orden con la separación indicada', () => {
    const plan = planificarFusion(
      [
        { idActivo: 'a', duracionMs: 1000 },
        { idActivo: 'b', duracionMs: 2000 },
        { idActivo: 'c', duracionMs: 500 },
      ],
      { separacionMs: 500, fundidoMs: 0 },
    );
    expect(plan.elementos.map((e) => [e.idActivo, e.inicioMs])).toEqual([
      ['a', 0],
      ['b', 1500],
      ['c', 4000],
    ]);
    expect(plan.duracionTotalMs).toBe(4500);
  });

  it('no añade silencio al final', () => {
    const plan = planificarFusion([{ idActivo: 'a', duracionMs: 1000 }], { separacionMs: 500, fundidoMs: 0 });
    expect(plan.duracionTotalMs).toBe(1000);
  });

  it('limita el fundido a la mitad de cada clip', () => {
    const plan = planificarFusion([{ idActivo: 'a', duracionMs: 1000 }], { separacionMs: 0, fundidoMs: 2000 });
    expect(plan.elementos[0]!.fundidoEntradaMs).toBe(500);
    expect(plan.elementos[0]!.fundidoSalidaMs).toBe(500);
  });

  it('rechaza cero entradas, duraciones inválidas y parámetros negativos', () => {
    expect(() => planificarFusion([], { separacionMs: 0, fundidoMs: 0 })).toThrowError(ErrorValidacion);
    expect(() =>
      planificarFusion([{ idActivo: 'a', duracionMs: 0 }], { separacionMs: 0, fundidoMs: 0 }),
    ).toThrowError(/duración/i);
    expect(() => planificarFusion([{ idActivo: 'a', duracionMs: 10 }], { separacionMs: -1, fundidoMs: 0 })).toThrowError(
      /FUSION_PARAMETROS_INVALIDOS/,
    );
  });
});
