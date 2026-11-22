import { describe, expect, it } from 'vitest';
import { Historial } from '@telar/linea-tiempo';

describe('Historial', () => {
  it('desHace y rehace estados guardando la simetría de las pilas', () => {
    const historial = new Historial<string>(10);
    const estados = ['s0', 's1', 's2'];
    let actual = estados[0]!;
    historial.apilar(actual);
    actual = estados[1]!;
    historial.apilar(actual);
    actual = estados[2]!;

    expect(historial.puedeDeshacer()).toBe(true);
    expect(historial.deshacer(actual)).toBe('s1');
    actual = 's1';
    expect(historial.puedeRehacer()).toBe(true);
    expect(historial.rehacer(actual)).toBe('s2');
    expect(historial.puedeRehacer()).toBe(false);
    expect(historial.puedeDeshacer()).toBe(true);
  });

  it('descarta la pila de rehacer al apilar un estado nuevo', () => {
    const historial = new Historial<string>(10);
    let actual = 'a';
    historial.apilar(actual);
    actual = 'b';
    const deshecho = historial.deshacer(actual);
    expect(deshecho).toBe('a');
    actual = deshecho!;
    historial.apilar(actual); // nueva edición tras deshacer
    expect(historial.puedeRehacer()).toBe(false);
  });

  it('recorta la pila al límite configurado', () => {
    const historial = new Historial<number>(3);
    for (let i = 0; i < 10; i += 1) {
      historial.apilar(i);
    }
    expect(historial.tamanoDeshacer()).toBe(3);
    expect(historial.deshacer(99)).toBe(9);
    expect(historial.deshacer(9)).toBe(8);
    expect(historial.deshacer(8)).toBe(7);
    expect(historial.deshacer(7)).toBeUndefined();
  });

  it('no muta los estados guardados (instantáneas por referencia)', () => {
    const historial = new Historial<{ datos: number[] }>(5);
    const estado = { datos: [1, 2, 3] };
    historial.apilar(estado);
    estado.datos.push(4);
    const deshecho = historial.deshacer({ datos: [] });
    expect(deshecho!.datos).toEqual([1, 2, 3, 4]);
  });

  it('reiniciar vacía ambas pilas', () => {
    const historial = new Historial<string>(5);
    historial.apilar('a');
    historial.deshacer('b');
    historial.reiniciar();
    expect(historial.puedeDeshacer()).toBe(false);
    expect(historial.puedeRehacer()).toBe(false);
  });

  it('rechaza límites inválidos', () => {
    expect(() => new Historial<string>(0)).toThrowError(/entero >= 1/);
  });
});
