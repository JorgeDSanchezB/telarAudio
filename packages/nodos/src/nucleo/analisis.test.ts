/**
 * Pruebas de las funciones puras de análisis (muletillas, tensión, SFX,
 * música): 100 % Node, sin servicios. Casos de las recetas de los contratos
 * en docs/pending/.
 */

import { describe, expect, it } from 'vitest';
import { detectarMuletillas, planSinMuletillas } from './muletillas';
import { calcularCurvaTension, comoTension } from './tension';
import { planSfx } from './sfx';
import type { EfectoCatalogo } from './sfx';
import { planMusica, ventanasConVoz } from './musica';
import type { TranscripcionV1 } from './transcripcion';

function transcripcion(palabras: Array<[string, number, number]>, duracionMs: number): TranscripcionV1 {
  return {
    tipoDato: 'transcripcion/v1',
    idioma: 'es',
    modelo: 'tiny',
    duracionMs,
    segmentos: [
      {
        inicioMs: palabras[0]?.[1] ?? 0,
        finMs: palabras[palabras.length - 1]?.[2] ?? duracionMs,
        texto: palabras.map((p) => p[0]).join(' '),
        palabras: palabras.map(([palabra, inicioMs, finMs]) => ({ palabra, inicioMs, finMs })),
      },
    ],
  };
}

describe('detectarMuletillas / planSinMuletillas', () => {
  const base = transcripcion(
    [
      ['La', 0, 200],
      ['noche', 200, 600],
      ['eh,', 900, 1100], // muletilla con pausas a ambos lados (300 ms)
      ['caía', 1400, 1800],
      ['sobre', 1800, 2100],
      ['el', 2100, 2200],
      ['pueblo.', 2200, 2600],
    ],
    2600,
  );

  it('detecta solo muletillas del catálogo, normalizando puntuación', () => {
    const detecciones = detectarMuletillas(base, ['eh'], {
      pausaMinimaMs: 250,
      fundidoMs: 25,
      modo: 'solo_pausas',
    });
    expect(detecciones).toHaveLength(1);
    expect(detecciones[0]!.palabra.palabra).toBe('eh,');
    expect(detecciones[0]!.pausaAntesMs).toBe(300);
    expect(detecciones[0]!.pausaDespuesMs).toBe(300);
  });

  it('modo seguro respeta pausaMinimaMs: pausa corta no se corta', () => {
    const pegada = transcripcion(
      [
        ['La', 0, 200],
        ['eh', 210, 400], // pegada a la palabra anterior (10 ms)
        ['noche', 410, 800],
      ],
      800,
    );
    const detecciones = detectarMuletillas(pegada, ['eh'], {
      pausaMinimaMs: 250,
      fundidoMs: 25,
      modo: 'solo_pausas',
    });
    expect(detecciones).toHaveLength(0);
  });

  it('modo agresivo corta aunque esté pegada', () => {
    const pegada = transcripcion(
      [
        ['La', 0, 200],
        ['eh', 210, 400],
        ['noche', 410, 800],
      ],
      800,
    );
    const detecciones = detectarMuletillas(pegada, ['eh'], {
      pausaMinimaMs: 250,
      fundidoMs: 25,
      modo: 'siempre',
    });
    expect(detecciones).toHaveLength(1);
  });

  it('el plan conserva el complemento y cierra huecos con crossfade', () => {
    const plan = planSinMuletillas(base, ['eh'], {
      pausaMinimaMs: 250,
      fundidoMs: 25,
      modo: 'solo_pausas',
    });
    expect(plan.detecciones).toHaveLength(1);
    expect(plan.msEliminados).toBe(200);
    expect(plan.duracionResultadoMs).toBe(2400);
    // Dos tramos: [0,900) y [1100,2600) desplazado a 900.
    expect(plan.tramos).toHaveLength(2);
    expect(plan.tramos[0]).toMatchObject({ offsetMs: 0, duracionMs: 900, inicioResultadoMs: 0 });
    expect(plan.tramos[1]).toMatchObject({ offsetMs: 1100, duracionMs: 1500, inicioResultadoMs: 900 });
    expect(plan.tramos[0]!.fundidoSalidaMs).toBe(25);
    expect(plan.tramos[1]!.fundidoEntradaMs).toBe(25);
  });

  it('la revisión excluye palabras por índice (aprobar/rechazar)', () => {
    const revisada: TranscripcionV1 = { ...base, revision: { excluirMuletillas: [2] } };
    const plan = planSinMuletillas(revisada, ['eh'], {
      pausaMinimaMs: 250,
      fundidoMs: 25,
      modo: 'solo_pausas',
    });
    expect(plan.detecciones).toHaveLength(0);
    expect(plan.msEliminados).toBe(0);
  });
});

describe('calcularCurvaTension', () => {
  it('produce puntos por ventana dentro de 0..100 con suavizado', () => {
    const narracion = transcripcion(
      [
        ['Todo', 0, 300],
        ['empezó', 300, 700],
        ['aquella', 700, 1000],
        ['noche', 1000, 1400],
        ['calma.', 1400, 1800],
      ],
      60_000,
    );
    const curva = calcularCurvaTension(narracion, { granularidadS: 30 });
    expect(curva.tipoDato).toBe('tension/v1');
    expect(curva.corregible).toBe(true);
    expect(curva.motor).toBe('heuristica');
    expect(curva.puntos).toHaveLength(2); // 60 s / 30 s
    for (const punto of curva.puntos) {
      expect(punto.tension).toBeGreaterThanOrEqual(0);
      expect(punto.tension).toBeLessThanOrEqual(100);
      expect(punto.animo).toBeTruthy();
    }
    // La primera ventana (con voz) supera a la segunda (silencio decae).
    expect(curva.puntos[0]!.tension).toBeGreaterThan(curva.puntos[1]!.tension);
  });

  it('es determinista: misma entrada, misma curva', () => {
    const narracion = transcripcion(
      [
        ['Una', 0, 200],
        ['prueba.', 200, 600],
      ],
      30_000,
    );
    const a = calcularCurvaTension(narracion, { granularidadS: 30 });
    const b = calcularCurvaTension(narracion, { granularidadS: 30 });
    expect(a).toEqual(b);
  });

  it('comoTension valida la forma y rechaza contenidos ajenos', () => {
    expect(comoTension({ tipoDato: 'otro', puntos: [] })).toBeNull();
    expect(comoTension('texto')).toBeNull();
    expect(comoTension({ tipoDato: 'tension/v1', puntos: [{ inicioMs: 0, tension: 50 }] })).not.toBeNull();
  });
});

describe('planSfx', () => {
  const catalogo: EfectoCatalogo[] = [
    { id: 'trueno', nombre: 'Trueno', ruta: '/sfx/trueno.wav', terminos: ['trueno', 'rayo'] },
    { id: 'campana', nombre: 'Campana', ruta: '/sfx/campana.wav', terminos: ['campana'] },
  ];

  it('coloca cada efecto al fin de su palabra, con plural tolerado', () => {
    const narracion = transcripcion(
      [
        ['Un', 0, 150],
        ['trueno', 150, 700],
        ['retumbó', 700, 1200],
        ['y', 1200, 1300],
        ['campanas', 1300, 1800],
      ],
      2000,
    );
    const plan = planSfx(narracion, catalogo, { gananciaSfxDb: -12, desplazamientoMs: 0 });
    expect(plan.activas).toHaveLength(2);
    expect(plan.activas[0]).toMatchObject({ efecto: catalogo[0], enMs: 700 });
    expect(plan.activas[1]).toMatchObject({ efecto: catalogo[1], enMs: 1800 });
  });

  it('el desplazamiento mueve las colocaciones (y nunca a negativo)', () => {
    const narracion = transcripcion(
      [
        ['rayo', 0, 400],
        ['final.', 400, 900],
      ],
      900,
    );
    const plan = planSfx(narracion, catalogo, { gananciaSfxDb: -12, desplazamientoMs: -1000 });
    expect(plan.activas[0]!.enMs).toBe(0);
  });

  it('la revisión desactiva por índice de palabra manteniendo la lista estable', () => {
    const narracion = transcripcion(
      [
        ['Un', 0, 100],
        ['trueno', 100, 500],
        ['y', 500, 600],
        ['un', 600, 700],
        ['rayo', 700, 1100],
      ],
      1200,
    );
    const conRevision: TranscripcionV1 = { ...narracion, revision: { excluirMuletillas: [], desactivarSfx: [1] } };
    const plan = planSfx(conRevision, catalogo, { gananciaSfxDb: -12, desplazamientoMs: 0 });
    expect(plan.colocaciones).toHaveLength(2); // sigue listando ambas
    expect(plan.activas).toHaveLength(1); // pero solo suena la activa
    expect(plan.activas[0]!.efecto.id).toBe('trueno');
    expect(plan.activas[0]!.indicePalabra).toBe(4);
  });
});

describe('planMusica / ventanasConVoz', () => {
  it('divide por bloques de tensión y bucles de pista, con ganancias coherentes', () => {
    const curva = {
      tipoDato: 'tension/v1' as const,
      corregible: true as const,
      motor: 'heuristica' as const,
      puntos: [
        { inicioMs: 0, tension: 20 },
        { inicioMs: 10_000, tension: 80 },
      ],
    };
    const plan = planMusica(curva, 30_000, 12_000, {
      gananciaMusicaDb: -18,
      ducking: false,
      gananciaDuckingDb: -8,
      fundidoMs: 250,
    });
    expect(plan.duracionTotalMs).toBe(30_000);
    // Cortes: 0, 10k (bloque), 12k y 24k (loops) → 4 tramos.
    expect(plan.tramos.map((t) => t.inicioMs)).toEqual([0, 10_000, 12_000, 24_000]);
    // El tramo de alta tensión suena más fuerte que el de baja.
    expect(plan.tramos[1]!.gananciaDb).toBeGreaterThan(plan.tramos[0]!.gananciaDb);
    // El loop reinicia el offset de la pista.
    expect(plan.tramos[2]!.offsetMs).toBe(0);
  });

  it('el ducking baja la ganancia en las ventanas con voz', () => {
    const curva = {
      tipoDato: 'tension/v1' as const,
      corregible: true as const,
      motor: 'heuristica' as const,
      puntos: [{ inicioMs: 0, tension: 50 }],
    };
    const ventanas = [
      { desdeMs: 0, hastaMs: 4_000 },
      { desdeMs: 6_000, hastaMs: 10_000 },
    ];
    const plan = planMusica(curva, 10_000, 30_000, {
      gananciaMusicaDb: -18,
      ducking: true,
      gananciaDuckingDb: -8,
      fundidoMs: 250,
    }, ventanas);
    const conVoz = plan.tramos.find((t) => t.inicioMs === 0);
    // El hueco sin voz es el tramo que empieza justo tras la primera ventana
    // (4250 = 4000 + fundido 250); el que empieza en 5750 vuelve a tener voz.
    const sinVoz = plan.tramos.find((t) => t.inicioMs === 4250);
    expect(conVoz).toBeDefined();
    expect(sinVoz).toBeDefined();
    expect(conVoz!.gananciaDb).toBe(sinVoz!.gananciaDb - 8);
  });

  it('ventanasConVoz agrupa energía y funde ventanas pegadas', () => {
    const rms = new Float32Array([0.5, 0.5, 0.5, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0, 0.0]);
    const ventanas = ventanasConVoz(rms, 100, { umbralRelativo: 0.06, paddingMs: 250 });
    // Dos grupos (0-300 y 400-600) con padding 250 ms se funden en una.
    expect(ventanas).toHaveLength(1);
    expect(ventanas[0]!.desdeMs).toBe(0);
    expect(ventanas[0]!.hastaMs).toBeGreaterThan(600);
  });

  it('ventanasConVoz con silencio total no abre ventanas', () => {
    expect(ventanasConVoz(new Float32Array(20), 100)).toHaveLength(0);
  });
});
