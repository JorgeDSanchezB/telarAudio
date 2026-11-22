/**
 * Pruebas del serializador de proyectos (.telar.json): ida y vuelta completa
 * de la línea de tiempo (con deduplicación de buffers) y de los datos de
 * sesión, más los modos de fallo tipados (versión, estructura, tamaño).
 *
 * Se ejecutan en Node (sin Web Audio): los AudioBuffer son dobles de prueba
 * y la fábrica de buffers se inyecta (misma costura que usa la app).
 */

import { describe, expect, it } from 'vitest';
import { ErrorValidacion } from '@telar/motor';
import type { DatoRegistrado } from '@telar/motor';
import { crearPistaDesdeBuffer } from '@telar/linea-tiempo';
import type { PistaTelar } from '@telar/linea-tiempo';
import { RegistroDatosMemoria } from './datos';
import {
  base64DeFloat32,
  comprobarTamañoProyecto,
  deserializarProyecto,
  float32DesdeBase64,
  nombreArchivoProyecto,
  serializarProyecto,
} from './proyectos';
import type { FabricaAudioBuffer } from './proyectos';

function bufferFalso(canales: Float32Array[], tasa = 48_000): AudioBuffer {
  return {
    sampleRate: tasa,
    length: canales[0]!.length,
    numberOfChannels: canales.length,
    duration: canales[0]!.length / tasa,
    getChannelData: (indice: number) => canales[indice]!,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

/** Fábrica que graba cada llamada (para verificar los canales restaurados). */
function fabricaGrabadora(): {
  llamadas: { canales: Float32Array[]; tasa: number; stub: AudioBuffer }[];
  crearBuffer: FabricaAudioBuffer;
} {
  const llamadas: { canales: Float32Array[]; tasa: number; stub: AudioBuffer }[] = [];
  const crearBuffer: FabricaAudioBuffer = (canales, tasaMuestreo) => {
    const stub = bufferFalso(canales.map((canal) => Float32Array.from(canal)), tasaMuestreo);
    llamadas.push({ canales, tasa: tasaMuestreo, stub });
    return stub;
  };
  return { llamadas, crearBuffer };
}

function sesionEjemplo(): { pistas: PistaTelar[]; datos: DatoRegistrado[]; bufferVoz: AudioBuffer; bufferMusica: AudioBuffer } {
  const bufferVoz = bufferFalso([Float32Array.from([0.5, -0.25, 0.75, 0.125, -0.875, 0.375])]);
  const bufferMusica = bufferFalso(
    [Float32Array.from([0.25, 0.5, 0.75]), Float32Array.from([-0.25, -0.5, -0.75])],
    44_100,
  );
  const voz = crearPistaDesdeBuffer('Narración', 'voz', bufferVoz);
  /* dos clips del MISMO buffer (recortes): deben embeberse una sola vez */
  voz.clips.push({
    ...voz.clips[0]!,
    id: 'clip-voz-2',
    startSample: 6,
    durationSamples: 3,
    offsetSamples: 3,
    fadeIn: { duration: 0.5, type: 'sCurve' },
    fadeOut: { duration: 0.25 },
  });
  const musica = crearPistaDesdeBuffer('Ambiente', 'musica', bufferMusica, { color: '#e2a24a' });
  const datos: DatoRegistrado[] = [
    {
      idDato: 'dato-abc123',
      tipoDato: 'transcripcion/v1',
      contenido: { version: 1, idioma: 'es', palabras: [{ palabra: 'hola', inicioMs: 0, finMs: 400 }] },
      revision: 2,
      creadoEn: 1_700_000_000_000,
    },
    {
      idDato: 'dato-def456',
      tipoDato: 'tension/v1',
      contenido: { version: 1, puntos: [{ tMs: 0, valor: 10 }] },
      revision: 1,
      creadoEn: 1_700_000_001_000,
    },
  ];
  return { pistas: [voz, musica], datos, bufferVoz, bufferMusica };
}

describe('serializarProyecto / deserializarProyecto', () => {
  it('hace ida y vuelta completa de pistas, clips, fundidos y datos', () => {
    const sesion = sesionEjemplo();
    const documento = serializarProyecto(sesion);

    /* el texto es el transporte real: JSON ida y vuelta */
    const porDisco = JSON.parse(JSON.stringify(documento)) as unknown;
    const { llamadas, crearBuffer } = fabricaGrabadora();
    const resultado = deserializarProyecto(porDisco, { versionEsperada: 1, crearBuffer });

    expect(resultado.documento.version).toBe(1);
    expect(resultado.pistas).toHaveLength(2);

    const voz = resultado.pistas[0]!;
    expect(voz.name).toBe('Narración');
    expect(voz.tipoPista).toBe('voz');
    expect(voz.clips).toHaveLength(2);
    expect(voz.clips[0]!.audioBuffer).toBeDefined();
    expect(voz.clips[1]!.fadeIn).toEqual({ duration: 0.5, type: 'sCurve' });
    expect(voz.clips[1]!.fadeOut).toEqual({ duration: 0.25 });
    /* los dos clips de voz comparten EL MISMO buffer restaurado */
    expect(voz.clips[0]!.audioBuffer).toBe(voz.clips[1]!.audioBuffer);

    const musica = resultado.pistas[1]!;
    expect(musica.tipoPista).toBe('musica');
    expect(musica.color).toBe('#e2a24a');

    /* la fábrica recibió los canales exactos (estéreo a 44,1 kHz para música) */
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0]!.tasa).toBe(48_000);
    expect(Array.from(llamadas[0]!.canales[0]!)).toEqual([0.5, -0.25, 0.75, 0.125, -0.875, 0.375]);
    expect(llamadas[1]!.tasa).toBe(44_100);
    expect(llamadas[1]!.canales).toHaveLength(2);
    expect(Array.from(llamadas[1]!.canales[1]!)).toEqual([-0.25, -0.5, -0.75]);

    /* los datos conservan id, revisión y contenido */
    expect(resultado.documento.datos).toEqual(sesion.datos);
  });

  it('deduplica el audio: dos clips del mismo buffer embeben un solo audio', () => {
    const sesion = sesionEjemplo();
    const documento = serializarProyecto(sesion);
    expect(documento.pistas[0]!.clips).toHaveLength(2);
    expect(documento.audios).toHaveLength(2);
    expect(documento.audios.map((audio) => audio.nombreOrigen)).toEqual(['Narración', 'Ambiente']);
  });

  it('rechaza guardar cuando un clip no tiene su audio cargado', () => {
    const sesion = sesionEjemplo();
    sesion.pistas[0]!.clips[1] = { ...sesion.pistas[0]!.clips[1]!, audioBuffer: undefined };
    esperarError(() => serializarProyecto(sesion), 'PROYECTO_CLIP_SIN_AUDIO');
  });

  it('rechaza una versión de formato no soportada', () => {
    const documento = serializarProyecto(sesionEjemplo());
    const futuro = { ...documento, version: 99 } as typeof documento;
    const { crearBuffer } = fabricaGrabadora();
    esperarError(
      () => deserializarProyecto(futuro, { versionEsperada: 1, crearBuffer }),
      'PROYECTO_VERSION_NO_SOPORTADA',
    );
  });

  it('rechaza documentos con estructura inválida (campos desconocidos o ausentes)', () => {
    const { crearBuffer } = fabricaGrabadora();
    const documento = serializarProyecto(sesionEjemplo());

    const conBasura = { ...documento, sorpresa: true } as unknown;
    esperarError(
      () => deserializarProyecto(conBasura, { versionEsperada: 1, crearBuffer }),
      'PROYECTO_INVALIDO',
    );

    const sinAudios = { ...documento, audios: undefined } as unknown;
    esperarError(
      () => deserializarProyecto(sinAudios, { versionEsperada: 1, crearBuffer }),
      'PROYECTO_INVALIDO',
    );

    const clipNegativo = JSON.parse(
      JSON.stringify({ ...documento, pistas: [{ ...documento.pistas[0]!, clips: [{ ...documento.pistas[0]!.clips[0]!, startSample: -5 }] }] }),
    ) as unknown;
    esperarError(
      () => deserializarProyecto(clipNegativo, { versionEsperada: 1, crearBuffer }),
      'PROYECTO_INVALIDO',
    );
  });

  it('rechaza un canal cuya longitud declarada no encaja con el base64', () => {
    const documento = serializarProyecto(sesionEjemplo());
    const corrupto = JSON.parse(JSON.stringify(documento)) as typeof documento;
    corrupto.audios[0]!.longitud = 999;
    const { crearBuffer } = fabricaGrabadora();
    esperarError(
      () => deserializarProyecto(corrupto, { versionEsperada: 1, crearBuffer }),
      'PROYECTO_INVALIDO',
    );
  });

  it('rechaza un clip que referencia un audio inexistente', () => {
    const documento = serializarProyecto(sesionEjemplo());
    const huerfano = JSON.parse(JSON.stringify(documento)) as typeof documento;
    huerfano.pistas[0]!.clips[0]!.audioClave = 'audio-fantasma';
    const { crearBuffer } = fabricaGrabadora();
    esperarError(
      () => deserializarProyecto(huerfano, { versionEsperada: 1, crearBuffer }),
      'PROYECTO_INVALIDO',
    );
  });
});

describe('base64 float32', () => {
  it('ida y vuelta con un canal mayor que el trozo de codificación', () => {
    const canal = new Float32Array(20_000);
    for (let i = 0; i < canal.length; i += 1) {
      canal[i] = Math.sin(i / 97) * 0.9;
    }
    const texto = base64DeFloat32(canal);
    const restaurado = float32DesdeBase64(texto, canal.length);
    expect(restaurado).toHaveLength(canal.length);
    for (let i = 0; i < canal.length; i += 1) {
      expect(restaurado[i]).toBe(canal[i]);
    }
  });
});

describe('comprobarTamañoProyecto', () => {
  it('deja pasar por debajo del límite y lanza error tipado por encima', () => {
    expect(() => comprobarTamañoProyecto(1024, 1)).not.toThrow();
    esperarError(() => comprobarTamañoProyecto(2 * 1024 * 1024, 1), 'PROYECTO_DEMASIADO_GRANDE');
  });
});

describe('nombreArchivoProyecto', () => {
  it('compone prefijo + fecha local con relleno a dos dígitos', () => {
    const fecha = new Date(2026, 10, 22, 19, 30);
    expect(nombreArchivoProyecto('proyecto-telar', fecha)).toBe('proyecto-telar-20261122-1930.telar.json');
  });
});

describe('RegistroDatosMemoria.importar', () => {
  const hashFalso = { sha256: async () => 'ab'.repeat(32) };

  it('importa un dato nuevo conservando id y revisión', () => {
    const registro = new RegistroDatosMemoria(hashFalso);
    registro.importar({
      idDato: 'dato-importado',
      tipoDato: 'transcripcion/v1',
      contenido: { version: 1, palabras: [] },
      revision: 3,
      creadoEn: 123,
    });
    const listado = registro.listar();
    expect(listado).toHaveLength(1);
    expect(listado[0]!.idDato).toBe('dato-importado');
    expect(listado[0]!.revision).toBe(3);
    expect(registro.obtener('dato-importado')!.contenido).toEqual({ version: 1, palabras: [] });
  });

  it('sustituye un dato existente con el mismo idDato', () => {
    const registro = new RegistroDatosMemoria(hashFalso);
    registro.importar({
      idDato: 'dato-x',
      tipoDato: 'tension/v1',
      contenido: { antiguo: true },
      revision: 1,
      creadoEn: 1,
    });
    registro.importar({
      idDato: 'dato-x',
      tipoDato: 'tension/v1',
      contenido: { nuevo: true },
      revision: 5,
      creadoEn: 2,
    });
    const listado = registro.listar();
    expect(listado).toHaveLength(1);
    expect(listado[0]!.revision).toBe(5);
    expect(listado[0]!.contenido).toEqual({ nuevo: true });
  });

  it('rechaza datos mal formados', () => {
    const registro = new RegistroDatosMemoria(hashFalso);
    esperarError(
      () =>
        registro.importar({
          idDato: 'dato-y',
          tipoDato: 'tension/v1',
          contenido: {},
          revision: 0,
          creadoEn: 1,
        }),
      'DATO_IMPORTADO_INVALIDO',
    );
  });
});

/** Aserción auxiliar: falla si fn no lanza ErrorValidacion con el código dado. */
function esperarError(fn: () => unknown, codigo: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorValidacion);
    expect((error as ErrorValidacion).codigo).toBe(codigo);
    return;
  }
  throw new Error(`Se esperaba un ErrorValidacion «${codigo}» pero la llamada no falló.`);
}
