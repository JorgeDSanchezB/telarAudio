'use client';

/**
 * Panel «Datos» (tercera pestaña izquierda): todos los datos estructurados de
 * la sesión — transcripciones, curvas de tensión, colocaciones de SFX — al
 * margen del grafo. Se ven y se revisan con la MISMA maquinaria del inspector
 * (VisoresDatos), pero sin necesidad de seleccionar un nodo: así, las
 * transcripciones cargadas desde un proyecto .telar.json siguen siendo
 * visibles y editables aunque el grafo esté vacío.
 */

import { useState } from 'react';
import type { DatoRegistrado, ResultadoNodo } from '@telar/motor';
import { TIPO_DATO_COLOCACIONES, TIPO_DATO_TENSION, TIPO_DATO_TRANSCRIPCION, aplanarPalabras, comoTranscripcion } from '@telar/nodos';
import { Icono } from '@telar/ui';
import type { NombreIcono } from '@telar/ui';
import { VisoresDatos } from './VisoresDatos';

interface MetaTipo {
  etiqueta: string;
  icono: NombreIcono;
}

const META_TIPOS: Record<string, MetaTipo> = {
  [TIPO_DATO_TRANSCRIPCION]: { etiqueta: 'Transcripción', icono: 'lupa' },
  [TIPO_DATO_TENSION]: { etiqueta: 'Curva de tensión', icono: 'rayo' },
  [TIPO_DATO_COLOCACIONES]: { etiqueta: 'Colocaciones de SFX', icono: 'capas' },
};

const META_OTRO: MetaTipo = { etiqueta: 'Dato', icono: 'info' };

/** Resumen corto por tipo (columna derecha de cada fila). */
function resumenDe(dato: DatoRegistrado): string {
  if (dato.tipoDato === TIPO_DATO_TRANSCRIPCION) {
    const transcripcion = comoTranscripcion(dato.contenido);
    const palabras = transcripcion ? aplanarPalabras(transcripcion).length : 0;
    return `${palabras} palabra${palabras === 1 ? '' : 's'} · rev. ${dato.revision}`;
  }
  return `rev. ${dato.revision}`;
}

export interface PropsDatosSesion {
  datos: DatoRegistrado[];
  /** Registro para que los visores resuelvan referencias entre datos. */
  registro: { obtener(idDato: string): DatoRegistrado | undefined };
  catalogoMuletillas: string[];
  onRevisar: (idDato: string, contenido: unknown) => void;
}

export function DatosSesion(props: PropsDatosSesion) {
  const [idSeleccionado, setIdSeleccionado] = useState<string | null>(null);
  const seleccionado = props.datos.find((dato) => dato.idDato === idSeleccionado) ?? null;

  /* Salida sintética con la forma de ResultadoNodo para reutilizar los
     visores del inspector sin pasar por el grafo. */
  const salidaSintetica: ResultadoNodo | undefined = seleccionado
    ? {
        clave: `panel-datos-${seleccionado.idDato}`,
        nodoId: '',
        salidas: { '0': { tipo: 'dato', idDato: seleccionado.idDato, tipoDato: seleccionado.tipoDato } },
        creadoEn: seleccionado.creadoEn,
      }
    : undefined;

  return (
    <div className="tlr-datos" data-testid="panel-datos">
      <p className="tlr-datos-cabecera">
        Transcripciones y datos de análisis de la sesión. Se guardan y cargan con el proyecto; aquí puedes revisarlos
        aunque el grafo esté vacío.
      </p>
      {props.datos.length === 0 ? (
        <div className="tlr-vacio" data-testid="datos-vacios">
          Todavía no hay datos.
          <br />
          Ejecuta un nodo de transcripción o carga un proyecto (.telar.json).
        </div>
      ) : (
        <div className="tlr-datos-lista" role="list">
          {props.datos.map((dato) => {
            const meta = META_TIPOS[dato.tipoDato] ?? META_OTRO;
            const activa = seleccionado?.idDato === dato.idDato;
            return (
              <button
                type="button"
                role="listitem"
                key={dato.idDato}
                className={`tlr-dato-fila ${activa ? 'tlr-dato-fila-seleccionada' : ''}`}
                aria-expanded={activa}
                title={activa ? 'Ocultar el visor' : 'Ver y revisar este dato'}
                onClick={() => setIdSeleccionado((actual) => (actual === dato.idDato ? null : dato.idDato))}
              >
                <Icono nombre={meta.icono} tamaño={13} />
                <span className="tlr-dato-nombre">{meta.etiqueta}</span>
                <span className="tlr-dato-meta">{resumenDe(dato)}</span>
              </button>
            );
          })}
        </div>
      )}
      {salidaSintetica && seleccionado ? (
        <div className="tlr-datos-visores" data-testid="visor-dato">
          <VisoresDatos
            salida={salidaSintetica}
            datos={props.registro}
            catalogoMuletillas={props.catalogoMuletillas}
            onRevisar={props.onRevisar}
          />
        </div>
      ) : (
        <p className="tlr-datos-pista">
          <Icono nombre="info" tamaño={11} />
          Elige un dato de la lista para verlo y revisarlo aquí mismo.
        </p>
      )}
    </div>
  );
}
