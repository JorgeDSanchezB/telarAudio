'use client';

/**
 * Visores de datos de salida para el inspector (app): transcripción con
 * revisión de muletillas, curva de tensión editable arrastrando, y lista de
 * colocaciones de SFX con interruptores. Las ediciones revisan el DATO
 * (misma ranura, nueva revisión) e invalidan los nodos consumidores: sin
 * puertas de pipeline, el grafo se recalcula solo donde hace falta.
 */

import { useMemo, useRef, useState } from 'react';
import type { DatoRegistrado, ResultadoNodo } from '@telar/motor';
import {
  aplanarPalabras,
  comoTension,
  comoTranscripcion,
  detectarMuletillas,
  normalizarPalabra,
  TIPO_DATO_COLOCACIONES,
  TIPO_DATO_TENSION,
  TIPO_DATO_TRANSCRIPCION,
} from '@telar/nodos';
import type { RevisionTranscripcion, TensionV1, TranscripcionV1 } from '@telar/nodos';

export interface PropsVisoresDatos {
  /** Resultado cacheado del nodo seleccionado (con sus salidas dato). */
  salida: ResultadoNodo | undefined;
  /** Almacén de datos de la sesión. */
  datos: { obtener(idDato: string): DatoRegistrado | undefined };
  /** Catálogo de muletillas (para resaltar en la transcripción). */
  catalogoMuletillas: string[];
  /** Revisa un dato (misma ranura) e invalida los consumidores. */
  onRevisar: (idDato: string, contenido: unknown) => void;
}

interface Colocacion {
  indicePalabra: number;
  efecto: string;
  nombre: string;
  palabra: string;
  enMs: number;
  activa: boolean;
}

export function VisoresDatos(props: PropsVisoresDatos) {
  const { salida } = props;
  const valoresDato = useMemo(() => {
    if (!salida) return [];
    return Object.values(salida.salidas).filter((valor): valor is { tipo: 'dato'; idDato: string; tipoDato: string } => valor.tipo === 'dato');
  }, [salida]);

  if (valoresDato.length === 0) return null;

  return (
    <>
      {valoresDato.map((valor) => {
        const dato = props.datos.obtener(valor.idDato);
        if (!dato) return null;
        if (valor.tipoDato === TIPO_DATO_TRANSCRIPCION) {
          return (
            <VisorTranscripcion
              key={valor.idDato}
              idDato={valor.idDato}
              transcripcion={comoTranscripcion(dato.contenido)}
              revision={dato.revision}
              catalogo={props.catalogoMuletillas}
              onRevisar={props.onRevisar}
            />
          );
        }
        if (valor.tipoDato === TIPO_DATO_TENSION) {
          return (
            <VisorTension
              key={valor.idDato}
              idDato={valor.idDato}
              curva={comoTension(dato.contenido)}
              revision={dato.revision}
              onRevisar={props.onRevisar}
            />
          );
        }
        if (valor.tipoDato === TIPO_DATO_COLOCACIONES) {
          const contenido = dato.contenido as { idTranscripcion?: string };
          const datoTranscripcion = contenido.idTranscripcion
            ? props.datos.obtener(contenido.idTranscripcion)
            : undefined;
          return (
            <VisorColocaciones
              key={valor.idDato}
              contenido={dato.contenido}
              transcripcion={datoTranscripcion}
              onRevisar={props.onRevisar}
            />
          );
        }
        return (
          <details key={valor.idDato}>
            <summary style={{ cursor: 'pointer', color: 'var(--tlr-texto-suave)' }}>
              Dato «{valor.tipoDato}» (revisión {dato.revision})
            </summary>
            <pre style={{ fontSize: 11, overflow: 'auto', maxHeight: 200 }}>
              {JSON.stringify(dato.contenido, null, 2)?.slice(0, 2000)}
            </pre>
          </details>
        );
      })}
    </>
  );
}

// ------------------------------------------------------------ transcripción

function VisorTranscripcion(props: {
  idDato: string;
  transcripcion: TranscripcionV1 | null;
  revision: number;
  catalogo: string[];
  onRevisar: (idDato: string, contenido: unknown) => void;
}) {
  const { transcripcion } = props;
  if (!transcripcion) return null;

  const palabras = aplanarPalabras(transcripcion);
  const excluidas = new Set(transcripcion.revision?.excluirMuletillas ?? []);
  const detecciones = detectarMuletillas(
    transcripcion,
    props.catalogo,
    { pausaMinimaMs: 0, fundidoMs: 0, modo: 'siempre' },
  );
  const indicesMuletilla = new Set(detecciones.map((d) => d.indice));
  const conDetecciones = indicesMuletilla.size;

  const alternar = (indice: number): void => {
    const nueva: RevisionTranscripcion = {
      excluirMuletillas: excluidas.has(indice)
        ? [...excluidas].filter((i) => i !== indice)
        : [...excluidas, indice],
    };
    props.onRevisar(props.idDato, { ...transcripcion, revision: nueva });
  };

  return (
    <div data-testid="visor-transcripcion">
      <h3>
        Transcripción <span className="tlr-chip">rev. {props.revision}</span>{' '}
        <span className="tlr-chip">
          {transcripcion.estadisticas?.palabras ?? palabras.length} palabras ·{' '}
          {transcripcion.idioma} · {transcripcion.modelo}
        </span>
      </h3>
      <p className="tlr-inspector-desc">
        Las palabras marcadas son muletillas del catálogo: haz clic para excluir una de la
        eliminación (se recalcula el grafo, no la transcripción). {conDetecciones} detectada(s).
      </p>
      <div
        style={{
          maxHeight: 220,
          overflow: 'auto',
          lineHeight: 1.9,
          fontSize: 13,
          border: '1px solid var(--tlr-borde)',
          borderRadius: 6,
          padding: '6px 10px',
        }}
      >
        {palabras.map((palabra, indice) => {
          const esMuletilla = indicesMuletilla.has(indice);
          const excluida = excluidas.has(indice);
          return (
            <span
              key={`${indice}-${palabra.inicioMs}`}
              role={esMuletilla ? 'button' : undefined}
              tabIndex={esMuletilla ? 0 : undefined}
              onClick={esMuletilla ? () => alternar(indice) : undefined}
              onKeyDown={
                esMuletilla
                  ? (evento) => {
                      if (evento.key === 'Enter' || evento.key === ' ') alternar(indice);
                    }
                  : undefined
              }
              style={{
                cursor: esMuletilla ? 'pointer' : 'default',
                background: esMuletilla
                  ? excluida
                    ? 'transparent'
                    : 'var(--tlr-acento-suave, #fde8c8)'
                  : 'transparent',
                outline: esMuletilla && !excluida ? '1px dashed var(--tlr-acento, #b8860b)' : 'none',
                textDecoration: esMuletilla && excluida ? 'line-through' : 'none',
                borderRadius: 3,
                padding: '0 1px',
              }}
              title={
                esMuletilla
                  ? `${palabra.palabra} (${palabra.inicioMs}–${palabra.finMs} ms) — clic para ${excluida ? 'volver a eliminar' : 'excluir de la eliminación'}`
                  : `${palabra.inicioMs}–${palabra.finMs} ms`
              }
            >
              {palabra.palabra}{' '}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tensión

function VisorTension(props: {
  idDato: string;
  curva: TensionV1 | null;
  revision: number;
  onRevisar: (idDato: string, contenido: unknown) => void;
}) {
  const { curva } = props;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  if (!curva || curva.puntos.length === 0) return null;

  const ANCHO = 260;
  const ALTO = 90;
  const MARGEN = 14;
  const duracionMs = Math.max(
    ...curva.puntos.map((p) => p.inicioMs),
    1,
  );
  const x = (ms: number): number => MARGEN + (ms / duracionMs) * (ANCHO - MARGEN * 2);
  const y = (tension: number): number => ALTO - MARGEN - (tension / 100) * (ALTO - MARGEN * 2);

  const camino = curva.puntos
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.inicioMs).toFixed(1)} ${y(p.tension).toFixed(1)}`)
    .join(' ');

  const mover = (evento: React.PointerEvent<SVGSVGElement>, indice: number): void => {
    if (arrastrando !== indice || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const proporcion = (evento.clientX - rect.left - MARGEN) / (ANCHO - MARGEN * 2);
    const nuevaTension = Math.round(
      Math.max(0, Math.min(100, (1 - (evento.clientY - rect.top - MARGEN) / (ALTO - MARGEN * 2)) * 100)),
    );
    void proporcion;
    const puntos = curva.puntos.map((p, i) =>
      i === indice ? { ...p, tension: nuevaTension } : p,
    );
    props.onRevisar(props.idDato, { ...curva, puntos });
  };

  return (
    <div data-testid="visor-tension">
      <h3>
        Curva de tensión <span className="tlr-chip">rev. {props.revision}</span>{' '}
        <span className="tlr-chip">{curva.motor}</span>
      </h3>
      <p className="tlr-inspector-desc">
        Arrastra los puntos para corregir la curva (corregible por diseño): la música se
        recalcula al soltar, sin re-transcribir nada.
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        style={{ width: '100%', maxWidth: ANCHO, touchAction: 'none', cursor: arrastrando !== null ? 'grabbing' : 'default' }}
        onPointerMove={(evento) => {
          if (arrastrando !== null) mover(evento, arrastrando);
        }}
        onPointerUp={() => setArrastrando(null)}
        onPointerLeave={() => setArrastrando(null)}
      >
        {[0, 25, 50, 75, 100].map((g) => (
          <line
            key={g}
            x1={MARGEN}
            x2={ANCHO - MARGEN}
            y1={y(g)}
            y2={y(g)}
            stroke="var(--tlr-borde)"
            strokeWidth={0.5}
          />
        ))}
        <path d={camino} fill="none" stroke="var(--tlr-acento, #b8860b)" strokeWidth={2} />
        {curva.puntos.map((punto, indice) => (
          <circle
            key={`${punto.inicioMs}-${indice}`}
            cx={x(punto.inicioMs)}
            cy={y(punto.tension)}
            r={arrastrando === indice ? 6 : 4.5}
            fill="var(--tlr-acento, #b8860b)"
            style={{ cursor: 'grab' }}
            onPointerDown={() => setArrastrando(indice)}
          />
        ))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, fontSize: 11 }}>
        {curva.puntos.map((punto, indice) => (
          <span key={indice} className="tlr-chip">
            {Math.round(punto.inicioMs / 1000)}s: {punto.tension}
            {punto.animo ? ` (${punto.animo})` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- colocaciones

function VisorColocaciones(props: {
  contenido: unknown;
  transcripcion?: DatoRegistrado;
  onRevisar: (idDato: string, contenido: unknown) => void;
}) {
  const contenido = props.contenido as { colocaciones?: Colocacion[]; desplazamientoMs?: number };
  const colocaciones = contenido?.colocaciones ?? [];

  if (colocaciones.length === 0) {
    return (
      <div data-testid="visor-colocaciones">
        <h3>Colocaciones de efectos</h3>
        <p className="tlr-inspector-desc">
          Ninguna palabra del catálogo apareció en la transcripción todavía.
        </p>
      </div>
    );
  }

  const alternar = (colocacion: Colocacion): void => {
    const transcripcion = props.transcripcion;
    if (!transcripcion) return;
    const contenido = transcripcion.contenido as { revision?: RevisionTranscripcion };
    const previa = new Set(contenido.revision?.desactivarSfx ?? []);
    const clave = colocacion.indicePalabra;
    if (previa.has(clave)) previa.delete(clave);
    else previa.add(clave);
    props.onRevisar(transcripcion.idDato, {
      ...contenido,
      revision: {
        excluirMuletillas: contenido.revision?.excluirMuletillas ?? [],
        desactivarSfx: [...previa].sort((a, b) => a - b),
      },
    });
  };

  return (
    <div data-testid="visor-colocaciones">
      <h3>Colocaciones de efectos</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 12 }}>
        {colocaciones.map((colocacion, indice) => (
          <li
            key={indice}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              opacity: colocacion.activa ? 1 : 0.45,
            }}
          >
            <input
              id={`colocacion-${indice}`}
              type="checkbox"
              checked={colocacion.activa}
              disabled={!props.transcripcion}
              onChange={() => alternar(colocacion)}
            />
            <label htmlFor={`colocacion-${indice}`}>
              «{colocacion.palabra}» → <b>{colocacion.nombre}</b> a los{' '}
              {(colocacion.enMs / 1000).toFixed(1)} s
            </label>
          </li>
        ))}
      </ul>
      <p className="tlr-inspector-desc">
        {props.transcripcion
          ? 'Cada interruptor revisa la transcripción e invalida este nodo: vuelve a ejecutar para oír el cambio.'
          : 'Ejecuta de nuevo el nodo para poder activar/desactivar desde aquí.'}
      </p>
    </div>
  );
}
