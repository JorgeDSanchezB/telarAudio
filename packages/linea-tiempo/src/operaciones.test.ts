/**
 * Pruebas del dominio de línea de tiempo: operaciones puras, invariantes del
 * documento, eliminación destructiva de rango y plan de mezcla.
 */

import { describe, expect, it } from 'vitest';
import {
  crearPistaDesdeBuffer,
  eliminarRangoDePista,
  planificarMezclaPistas,
  validarDocumento,
} from '@telar/linea-tiempo';
import type { PistaTelar } from '@telar/linea-tiempo';
import type { AudioClip } from '@waveform-playlist/browser';

function bufferFalso(muestras: number, tasa = 48_000): AudioBuffer {
  return {
    sampleRate: tasa,
    length: muestras,
    duration: muestras / tasa,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(muestras),
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as AudioBuffer;
}

function clipDe(principal: Partial<AudioClip>): AudioClip {
  return {
    id: crypto.randomUUID(),
    startSample: 0,
    durationSamples: 1000,
    offsetSamples: 0,
    sampleRate: 48_000,
    sourceDurationSamples: 5000,
    gain: 1,
    ...principal,
  } as AudioClip;
}

describe('crearPistaDesdeBuffer', () => {
  it('crea una pista con un clip que abarca todo el buffer', () => {
    const pista = crearPistaDesdeBuffer('Narración', 'voz', bufferFalso(4800));
    expect(pista.name).toBe('Narración');
    expect(pista.tipoPista).toBe('voz');
    expect(pista.clips).toHaveLength(1);
    expect(pista.clips[0]!.durationSamples).toBe(4800);
    expect(pista.clips[0]!.startSample).toBe(0);
    expect(validarDocumento([pista])).toEqual([]);
  });

  it('aplica la ganancia en dB convirtiéndola a lineal', () => {
    const pista = crearPistaDesdeBuffer('Música', 'musica', bufferFalso(100), { gananciaDb: -6 });
    expect(pista.clips[0]!.gain).toBeCloseTo(0.5012, 3);
  });
});

describe('eliminarRangoDePista (corte destructivo a nivel documento)', () => {
  const pistaBase = (): PistaTelar => ({
    id: 'p1',
    name: 'Voz',
    tipoPista: 'voz',
    clips: [
      clipDe({ id: 'c1', startSample: 0, durationSamples: 1000 }),
      clipDe({ id: 'c2', startSample: 2000, durationSamples: 1000 }),
      clipDe({ id: 'c3', startSample: 4000, durationSamples: 1000 }),
    ],
    muted: false,
    soloed: false,
    volume: 1,
    pan: 0,
  });

  it('elimina un clip completo y desplaza los posteriores', () => {
    const resultado = eliminarRangoDePista([pistaBase()], 'p1', 2000, 3000);
    const pista = resultado.pistaModificada;
    expect(pista.clips.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(pista.clips[1]!.startSample).toBe(3000); // 4000 - 1000
    expect(resultado.muestrasEliminadas).toBe(1000);
    expect(validarDocumento(resultado.pistas)).toEqual([]);
  });

  it('recorta un clip parcialmente solapado por la izquierda y por la derecha', () => {
    // El clip c2 [2000,3000): eliminar [2500, 2750) deja 250 + 250.
    const resultado = eliminarRangoDePista([pistaBase()], 'p1', 2500, 2750);
    const c2 = resultado.pistaModificada.clips.find((c) => c.id === 'c2');
    expect(c2).toBeDefined();
    expect(c2!.durationSamples).toBe(500);
    expect(resultado.muestrasEliminadas).toBe(250);
    expect(validarDocumento(resultado.pistas)).toEqual([]);
  });

  it('divide en dos un clip que abarca todo el rango', () => {
    // Eliminar [400, 700) de c1 [0,1000) -> [0,400) + [400, 700) tras el hueco.
    const resultado = eliminarRangoDePista([pistaBase()], 'p1', 400, 700);
    // Las dos partes supervivientes de c1 (la izquierda conserva su id; la derecha recibe uno nuevo).
    const clips = resultado.pistaModificada.clips.filter((c) => c.id !== 'c2' && c.id !== 'c3');
    expect(clips).toHaveLength(2);
    expect(clips[0]!.durationSamples).toBe(400);
    expect(clips[1]!.startSample).toBe(400);
    expect(clips[1]!.durationSamples).toBe(300);
    expect(clips[1]!.offsetSamples).toBe(700);
    expect(resultado.muestrasEliminadas).toBe(300);
    // c2 se desplazó de 2000 a 1700 por el hueco de 300.
    expect(resultado.pistaModificada.clips.find((c) => c.id === 'c2')!.startSample).toBe(1700);
    expect(validarDocumento(resultado.pistas)).toEqual([]);
  });

  it('deja intacto lo que está fuera del rango', () => {
    const pistas = [pistaBase()];
    const resultado = eliminarRangoDePista(pistas, 'p1', 5000, 6000);
    expect(resultado.muestrasEliminadas).toBe(0);
    expect(resultado.pistaModificada.clips).toHaveLength(3);
    // El documento original no se muta (inmutabilidad).
    expect(pistas[0]!.clips[0]!.durationSamples).toBe(1000);
  });

  it('rechaza rangos y pistas inválidos', () => {
    expect(() => eliminarRangoDePista([pistaBase()], 'p1', 900, 100)).toThrowError(/RANGO_INVALIDO/);
    expect(() => eliminarRangoDePista([pistaBase()], 'inexistente', 0, 10)).toThrowError(/PISTA_INEXISTENTE/);
  });
});

describe('validarDocumento', () => {
  it('detecta solapes, ids duplicados y clips fuera de su fuente', () => {
    const pista: PistaTelar = {
      id: 'p1',
      name: 'Voz',
      tipoPista: 'voz',
      clips: [
        clipDe({ id: 'repetido', startSample: 0, durationSamples: 500 }),
        clipDe({ id: 'repetido', startSample: 250, durationSamples: 100 }),
        clipDe({ id: 'c3', startSample: 1000, durationSamples: 100, offsetSamples: 4950 }),
      ],
      muted: false,
      soloed: false,
      volume: 1,
      pan: 0,
    };
    const fallos = validarDocumento([pista]);
    const codigos = fallos.map((f) => f.codigo);
    expect(codigos).toContain('CLIP_ID_INVALIDO');
    expect(codigos).toContain('CLIP_SOLAPADO');
    expect(codigos).toContain('CLIP_FUERA_DE_FUENTE');
  });
});

describe('planificarMezclaPistas', () => {
  const pistaConClips = (): PistaTelar => ({
    id: 'p1',
    name: 'Voz',
    tipoPista: 'voz',
    clips: [
      {
        id: 'c1',
        audioBuffer: bufferFalso(4800),
        startSample: 0,
        durationSamples: 4800,
        offsetSamples: 0,
        sampleRate: 48_000,
        sourceDurationSamples: 4800,
        gain: 1,
        fadeIn: { duration: 0.01, type: 'linear' },
        fadeOut: { duration: 0.02, type: 'linear' },
      },
    ],
    muted: false,
    soloed: false,
    volume: 0.5,
    pan: 0,
  });

  it('convierte clips en elementos de mezcla con ganancia y fundidos combinados', () => {
    const plan = planificarMezclaPistas([pistaConClips()], { tasaMuestreo: 48_000 });
    expect(plan.elementos).toHaveLength(1);
    const elemento = plan.elementos[0]!;
    expect(elemento.inicioMs).toBe(0);
    expect(elemento.duracionMs).toBe(100);
    expect(elemento.gananciaDb).toBeCloseTo(-6.0206, 3); // pista a 0.5
    expect(elemento.fundidoEntradaMs).toBeCloseTo(10, 5);
    expect(elemento.fundidoSalidaMs).toBeCloseTo(20, 5);
    expect(plan.duracionTotalMs).toBe(100);
  });

  it('excluye pistas silenciadas y respeta el solo', () => {
    const pista2: PistaTelar = { ...pistaConClips(), id: 'p2', soloed: false, clips: pistaConClips().clips.map((c) => ({ ...c, id: 'x1', startSample: 0 })) };
    const pistas = [pistaConClips(), pista2];
    const planSolo = planificarMezclaPistas([{ ...pistas[0]!, soloed: true }, pista2], { tasaMuestreo: 48_000 });
    expect(planSolo.elementos).toHaveLength(1); // solo la pista en solo
    const planMute = planificarMezclaPistas(
      pistas.map((p, i) => (i === 1 ? { ...p, muted: true } : p)),
      { tasaMuestreo: 48_000 },
    );
    expect(planMute.elementos).toHaveLength(1); // solo la no silenciada
  });

  it('falla con error tipado si un clip no tiene audio cargado', () => {
    const pista: PistaTelar = {
      id: 'p1',
      name: 'Voz',
      tipoPista: 'voz',
      clips: [clipDe({ id: 'sin-audio' })],
      muted: false,
      soloed: false,
      volume: 1,
      pan: 0,
    };
    expect(() => planificarMezclaPistas([pista], { tasaMuestreo: 48_000 })).toThrowError(/CLIP_SIN_AUDIO/);
  });
});
