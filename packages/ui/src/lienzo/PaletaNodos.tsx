'use client';

/**
 * Paleta de nodos disponibles: se genera DINÁMICAMENTE a partir del registro
 * (Fase 5: la UI nunca enumera tipos de nodo a mano; añadir un nodo al
 * catálogo lo hace aparecer aquí sin tocar este componente).
 *
 * El filtro de búsqueda es estado local de presentación: no toca el almacén.
 */

import { useMemo, useState } from 'react';
import type { DefinicionNodo } from '@telar/motor';
import { ETIQUETAS_CATEGORIA } from '../tipos';
import { Icono } from '../comunes/Icono';

export interface PropsPaletaNodos {
  definiciones: DefinicionNodo[];
  onAñadir: (tipo: string) => void;
}

function coincide(definicion: DefinicionNodo, consulta: string): boolean {
  if (!consulta) {
    return true;
  }
  const texto = `${definicion.etiqueta} ${definicion.descripcion} ${
    ETIQUETAS_CATEGORIA[definicion.categoria] ?? definicion.categoria
  } ${definicion.runtime}`.toLowerCase();
  return texto.includes(consulta.toLowerCase());
}

export function PaletaNodos({ definiciones, onAñadir }: PropsPaletaNodos) {
  const [consulta, setConsulta] = useState('');

  const porCategoria = useMemo(() => {
    const grupos = new Map<string, DefinicionNodo[]>();
    for (const definicion of definiciones) {
      if (!coincide(definicion, consulta)) {
        continue;
      }
      const grupo = grupos.get(definicion.categoria) ?? [];
      grupo.push(definicion);
      grupos.set(definicion.categoria, grupo);
    }
    return [...grupos.entries()];
  }, [definiciones, consulta]);

  return (
    <div className="tlr-paleta" data-testid="paleta-nodos">
      <div className="tlr-paleta-busqueda">
        <input
          type="text"
          value={consulta}
          onChange={(evento) => setConsulta(evento.target.value)}
          placeholder="Filtrar nodos…"
          aria-label="Filtrar nodos de la paleta"
        />
      </div>
      {porCategoria.length === 0 ? (
        <div className="tlr-vacio">Ningún nodo coincide con «{consulta}».</div>
      ) : null}
      {porCategoria.map(([categoria, nodos]) => (
        <section key={categoria} className="tlr-paleta-categoria" data-categoria={categoria}>
          <h3>{ETIQUETAS_CATEGORIA[categoria] ?? categoria}</h3>
          <div className="tlr-paleta-lista">
            {nodos.map((definicion) => (
              <div
                key={definicion.tipo}
                className="tlr-paleta-item"
                data-categoria={definicion.categoria}
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(evento) => {
                  evento.dataTransfer.setData('application/telar-tipo-nodo', definicion.tipo);
                  evento.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onAñadir(definicion.tipo)}
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter' || evento.key === ' ') {
                    evento.preventDefault();
                    onAñadir(definicion.tipo);
                  }
                }}
                title="Arrastra al lienzo o haz clic para añadir"
              >
                <span className="tlr-paleta-nombre">
                  {definicion.etiqueta}
                  {definicion.runtime === 'backend' ? (
                    <span className="tlr-chip" title="Requiere el backend local">
                      <Icono nombre="cpu" tamaño={10} />
                      backend
                    </span>
                  ) : null}
                </span>
                <span className="tlr-paleta-desc">{definicion.descripcion}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
