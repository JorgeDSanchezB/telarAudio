'use client';

/**
 * Biblioteca de activos de la sesión: subida de archivos (clic o arrastrar y
 * soltar), listado virtualizado (react-window, clave estable por id de activo)
 * y acciones por activo (descargar WAV, convertir MP3, eliminar).
 */

import { useRef, useState } from 'react';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import type { MetadatosActivo } from '@telar/motor';
import { Icono } from '@telar/ui';

interface DatosFila {
  activos: MetadatosActivo[];
  ocupadoMp3: boolean;
  onDescargar: (id: string) => void;
  onExportarMp3: (id: string) => void;
  onEliminar: (id: string) => void;
}

function Fila({ index, style, ariaAttributes, activos, ocupadoMp3, onDescargar, onExportarMp3, onEliminar }: RowComponentProps<DatosFila>) {
  const activo = activos[index];
  if (!activo) {
    return <div style={style} />;
  }
  /* duración en formato de reloj (coherente con la línea de tiempo) */
  const duracion =
    activo.duracionMs !== null
      ? (() => {
          const s = Math.round(activo.duracionMs / 1000);
          return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        })()
      : 'analizando…';
  /* jerarquía del nombre: lo que hay antes del separador es lo principal */
  const separador = activo.nombre.indexOf(' — ');
  const nombrePrincipal = separador > 0 ? activo.nombre.slice(0, separador) : activo.nombre;
  const nombreSecundario = separador > 0 ? activo.nombre.slice(separador) : '';
  return (
    <div className="tlr-activo" style={style} data-id={activo.id} {...ariaAttributes}>
      <span className="tlr-activo-nombre" title={`${activo.nombre} · ${activo.origen}`}>
        {nombrePrincipal}
        {nombreSecundario ? <span className="tlr-activo-sufijo">{nombreSecundario}</span> : null}
      </span>
      <span className="tlr-activo-meta">{duracion}</span>
      <span className="tlr-activo-acciones">
        <button
          type="button"
          className="tlr-boton tlr-boton-icono"
          title="Descargar WAV"
          aria-label={`Descargar ${activo.nombre} como WAV`}
          onClick={() => onDescargar(activo.id)}
        >
          <Icono nombre="descargar" tamaño={13} />
        </button>
        <button
          type="button"
          className="tlr-boton tlr-boton-mini"
          title="Convertir a MP3 con ffmpeg.wasm (requiere npm run preparar:ffmpeg)"
          aria-label={`Descargar ${activo.nombre} como MP3`}
          disabled={ocupadoMp3}
          onClick={() => onExportarMp3(activo.id)}
        >
          <Icono nombre="descargar" tamaño={11} />
          MP3
        </button>
        <button
          type="button"
          className="tlr-boton tlr-boton-icono tlr-boton-peligro"
          title="Eliminar de la biblioteca"
          aria-label={`Eliminar ${activo.nombre}`}
          onClick={() => onEliminar(activo.id)}
        >
          <Icono nombre="papelera" tamaño={13} />
        </button>
      </span>
    </div>
  );
}

export interface PropsBibliotecaActivos {
  activos: MetadatosActivo[];
  ocupadoMp3: boolean;
  onSubir: (archivos: FileList) => void;
  onDescargar: (id: string) => void;
  onExportarMp3: (id: string) => void;
  onEliminar: (id: string) => void;
}

const ACEPTA_AUDIO = 'audio/*,.m4a,.aac,.mp3,.wav,.ogg,.oga,.flac,.webm,.opus,.wma,.aiff';

export function BibliotecaActivos(props: PropsBibliotecaActivos) {
  const entrada = useRef<HTMLInputElement>(null);
  const [encima, setEncima] = useState(false);

  return (
    <div className="tlr-biblioteca">
      <div className="tlr-biblioteca-subir">
        <input
          ref={entrada}
          type="file"
          accept={ACEPTA_AUDIO}
          multiple
          style={{ display: 'none' }}
          onChange={(evento) => {
            if (evento.target.files && evento.target.files.length > 0) {
              props.onSubir(evento.target.files);
            }
            evento.target.value = '';
          }}
        />
        <button
          type="button"
          className={`tlr-zona-subida ${encima ? 'tlr-zona-subida-encima' : ''}`}
          onClick={() => entrada.current?.click()}
          onDragOver={(evento) => {
            evento.preventDefault();
            evento.dataTransfer.dropEffect = 'copy';
            setEncima(true);
          }}
          onDragLeave={() => setEncima(false)}
          onDrop={(evento) => {
            evento.preventDefault();
            setEncima(false);
            if (evento.dataTransfer.files.length > 0) {
              props.onSubir(evento.dataTransfer.files);
            }
          }}
        >
          <Icono nombre="subir" tamaño={22} />
          <span className="tlr-zona-subida-titulo">Añadir archivos de audio</span>
          <span className="tlr-zona-subida-sub">haz clic o arrastra aquí</span>
          <span className="tlr-chip">WAV · MP3 · M4A · OGG · FLAC y más</span>
        </button>
      </div>
      {props.activos.length === 0 ? (
        <div className="tlr-vacio" data-testid="biblioteca-vacia">
          La biblioteca está vacía.
          <br />
          Sube tu narración para empezar.
        </div>
      ) : (
        <div className="tlr-biblioteca-lista" data-testid="biblioteca-lista">
          <List
            rowComponent={Fila}
            rowProps={{
              activos: props.activos,
              ocupadoMp3: props.ocupadoMp3,
              onDescargar: props.onDescargar,
              onExportarMp3: props.onExportarMp3,
              onEliminar: props.onEliminar,
            }}
            rowCount={props.activos.length}
            rowHeight={52}
            rowKey={(indice, datos) => datos.activos[indice]?.id ?? String(indice)}
            style={{ height: '100%' }}
          />
        </div>
      )}
      <p className="tlr-biblioteca-nota">
        <Icono nombre="candado" tamaño={12} />
        Procesamiento 100% local — el audio nunca sale de tu máquina.
      </p>
    </div>
  );
}
