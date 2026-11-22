'use client';

/**
 * Editor de línea de tiempo basado en @waveform-playlist/browser (ADR-003).
 *
 * Arquitectura: las pistas son propiedad de la aplicación (documento como
 * fuente de verdad). Este componente:
 *  - monta el proveedor con `tracks={pistas}` y `onTracksChange` para que las
 *    ediciones del motor (arrastrar/recortar/dividir) fluyan hacia arriba
 *    SIN reconstruir el motor (la librería usa la identidad de la referencia);
 *  - delega las operaciones estructurales y destructivas hacia la app
 *    (eliminar región con rebounce, mezclar y exportar, undo/redo propio),
 *    que es donde viven el historial y los servicios de render.
 *
 * Escalabilidad (regla del "audio infinito"): los picos los calcula la
 * librería desde el AudioBuffer ya decodificado y el dibujo es canvas por
 * pista; el coste vivo por pista es proporcional a los píxeles, no a las
 * muestras. El límite práctico actual es la memoria de los AudioBuffer
 * decodificados (documentado en docs/arquitectura/05-renderizado.md); la
 * estrategia de picos precalculados en Worker/OPFS queda en docs/pending.
 */

import { useCallback, useEffect } from 'react';
import {
  AudioPosition,
  ClipInteractionProvider,
  KeyboardShortcuts,
  MasterVolumeControl,
  PauseButton,
  PlayButton,
  RewindButton,
  StopButton,
  Waveform,
  WaveformPlaylistProvider,
  ZoomInButton,
  ZoomOutButton,
  useClipSplitting,
  usePlaylistData,
  usePlaylistState,
  useTimeFormat,
} from '@waveform-playlist/browser';
import type { WaveformPlaylistTheme, TimeFormat } from '@waveform-playlist/ui-components';
import type { ClipTrack } from '@waveform-playlist/browser';
import type { PistaTelar } from '@telar/linea-tiempo';
import { Icono } from '../comunes/Icono';
import '../estilos/telar.css';

export interface PropsEditorLineaTiempo {
  pistas: PistaTelar[];
  /** Ediciones originadas por el editor (drag/trim/split): pasar la referencia tal cual. */
  onPistasCambio: (pistas: PistaTelar[]) => void;
  onEliminarPista: (pistaId: string) => void;
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  onDeshacer: () => void;
  onRehacer: () => void;
  /** Corte destructivo: la app elimina el rango y persiste el audio resultante. */
  onEliminarRegion: (pistaId: string, desdeMuestra: number, hastaMuestra: number) => void;
  onMezclarExportar: () => void;
  ocupado: boolean;
  errorCarga: string | null;
  /** Opcional: lleva al usuario a la vista del grafo desde el estado vacío. */
  onIrAGrafo?: () => void;
}

const TEMA_TELAR: Partial<WaveformPlaylistTheme> = {
  /* mismos tonos del sistema «taller nocturno» (telar.css): la línea de
     tiempo no es una app distinta, es otra mesa del mismo taller */
  waveOutlineColor: '#8f8590',
  waveFillColor: '#3f3741',
  waveProgressColor: '#e2a24a',
  selectedWaveOutlineColor: '#efbe63',
  selectedWaveFillColor: '#5c4423',
  selectedTrackControlsBackground: '#241f25',
  selectedTrackBackground: '#1c171d',
  timeColor: '#a89ea7',
  timescaleBackgroundColor: '#131014',
  playheadColor: '#e2635f',
  selectionColor: 'rgba(226, 162, 74, 0.22)',
  loopRegionColor: 'rgba(111, 168, 220, 0.15)',
  loopMarkerColor: '#6fa8dc',
  clipHeaderBackgroundColor: '#241f25',
  clipHeaderBorderColor: '#342d34',
  clipHeaderTextColor: '#ede7df',
  selectedClipHeaderBackgroundColor: '#5c4423',
  fadeOverlayColor: 'rgba(237, 231, 242, 0.18)',
  backgroundColor: '#0e0b0f',
  surfaceColor: '#1a161b',
  borderColor: '#342d34',
  textColor: '#ede7df',
  textColorMuted: '#a89ea7',
  inputBackground: '#221d23',
  inputBorder: '#342d34',
  inputText: '#ede7df',
  inputPlaceholder: '#a89ea7',
  inputFocusBorder: '#e2a24a',
  buttonBackground: '#221d23',
  buttonText: '#ede7df',
  buttonBorder: '#342d34',
  buttonHoverBackground: '#2b252c',
  sliderTrackColor: '#342d34',
  sliderThumbColor: '#e2a24a',
};

/** Conserva el campo tipoPista (y el nombre) cuando el motor devuelve ClipTrack planos. */
function conservarTipoPista(pistas: PistaTelar[], nuevas: ClipTrack[]): PistaTelar[] {
  const anteriores = new Map(pistas.map((p) => [p.id, p]));
  return nuevas.map((pista) => {
    const anterior = anteriores.get(pista.id);
    return { ...pista, tipoPista: (pista as PistaTelar).tipoPista ?? anterior?.tipoPista ?? 'voz' };
  });
}

export function EditorLineaTiempo(props: PropsEditorLineaTiempo) {
  return (
    <WaveformPlaylistProvider
      tracks={props.pistas}
      onTracksChange={(tracks) => props.onPistasCambio(conservarTipoPista(props.pistas, tracks))}
      timescale
      samplesPerPixel={1024}
      zoomLevels={[256, 512, 1024, 2048, 4096]}
      controls={{ show: true, width: 200 }}
      theme={TEMA_TELAR}
      onError={(error) => {
        console.error('[Telar] Error del motor de línea de tiempo:', error);
      }}
    >
      <ClipInteractionProvider>
        <InteriorEditor {...props} />
      </ClipInteractionProvider>
    </WaveformPlaylistProvider>
  );
}

/** Opciones del selector de formato de tiempo, en español (el de la librería
 *  viene en inglés y esta UI es íntegramente en español). */
const FORMATOS_TIEMPO: Array<{ valor: TimeFormat; etiqueta: string }> = [
  { valor: 'hh:mm:ss.uuu', etiqueta: 'h:mm:ss.mmm' },
  { valor: 'hh:mm:ss.u', etiqueta: 'h:mm:ss.d' },
  { valor: 'hh:mm:ss', etiqueta: 'h:mm:ss' },
  { valor: 'seconds', etiqueta: 'segundos' },
  { valor: 'thousandths', etiqueta: 'milésimas' },
];

function InteriorEditor(props: PropsEditorLineaTiempo) {
  const { selectionStart, selectionEnd, selectedTrackId } = usePlaylistState();
  const { sampleRate, tracks, playoutRef, samplesPerPixel } = usePlaylistData();
  const { timeFormat, setTimeFormat } = useTimeFormat();
  const { splitClipAtPlayhead } = useClipSplitting({ tracks, samplesPerPixel, engineRef: playoutRef });

  const haySeleccion = selectionEnd > selectionStart && selectedTrackId !== null;

  const deshacer = props.onDeshacer;
  const rehacer = props.onRehacer;
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      const objetivo = evento.target as HTMLElement | null;
      if (objetivo && ['INPUT', 'SELECT', 'TEXTAREA'].includes(objetivo.tagName)) {
        return;
      }
      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'z') {
        evento.preventDefault();
        if (evento.shiftKey) {
          rehacer();
        } else {
          deshacer();
        }
      }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [deshacer, rehacer]);

  const eliminarRegion = useCallback(() => {
    if (!selectedTrackId || selectionEnd <= selectionStart) {
      return;
    }
    // selectionStart/End están en SEGUNDOS (verificación en
    // docs/arquitectura/05-renderizado.md): convertimos a muestras con la
    // tasa real del motor.
    props.onEliminarRegion(
      selectedTrackId,
      Math.round(selectionStart * sampleRate),
      Math.round(selectionEnd * sampleRate),
    );
  }, [props, sampleRate, selectedTrackId, selectionStart, selectionEnd]);

  const pistasVacias = props.pistas.length === 0;

  return (
    <div className="tlr-linea-tiempo" data-testid="editor-linea-tiempo">
      <div
        className={`tlr-lt-barra ${pistasVacias ? 'tlr-lt-barra-vacia' : ''}`}
        role="toolbar"
        aria-label="Barra de la línea de tiempo"
      >
        <div className="tlr-lt-grupo" role="group" aria-label="Transporte">
          <RewindButton />
          <PlayButton />
          <PauseButton />
          <StopButton />
        </div>
        <div className="tlr-lt-separador" />
        <div className="tlr-lt-grupo" role="group" aria-label="Zoom">
          <ZoomInButton />
          <ZoomOutButton />
        </div>
        <div className="tlr-lt-separador" />
        <AudioPosition />
        <select
          className="tlr-lt-formato"
          value={timeFormat}
          aria-label="Formato de tiempo"
          onChange={(evento) => setTimeFormat(evento.target.value as TimeFormat)}
        >
          {FORMATOS_TIEMPO.map((formato) => (
            <option key={formato.valor} value={formato.valor}>
              {formato.etiqueta}
            </option>
          ))}
        </select>
        <MasterVolumeControl />
        <div className="tlr-lt-separador" />
        <button
          type="button"
          className="tlr-boton tlr-boton-mini"
          onClick={() => splitClipAtPlayhead()}
          disabled={pistasVacias || props.ocupado}
          title="Dividir el clip bajo el cursor (atajo: S)"
        >
          <Icono nombre="tijeras" tamaño={12} />
          Dividir
        </button>
        <button
          type="button"
          className="tlr-boton tlr-boton-mini tlr-boton-peligro"
          onClick={eliminarRegion}
          disabled={!haySeleccion || props.ocupado}
          title="Elimina la selección de la pista elegida y PERSISTE el audio resultante (operación destructiva)"
        >
          <Icono nombre="tijeras" tamaño={12} />
          Eliminar región
        </button>
        <div className="tlr-lt-separador" />
        <button
          type="button"
          className="tlr-boton tlr-boton-mini"
          onClick={props.onDeshacer}
          disabled={!props.puedeDeshacer || props.ocupado}
          title="Deshacer (Ctrl+Z)"
        >
          <Icono nombre="deshacer" tamaño={12} />
          Deshacer
        </button>
        <button
          type="button"
          className="tlr-boton tlr-boton-mini"
          onClick={props.onRehacer}
          disabled={!props.puedeRehacer || props.ocupado}
          title="Rehacer (Ctrl+Shift+Z)"
        >
          <Icono nombre="rehacer" tamaño={12} />
          Rehacer
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="tlr-boton tlr-boton-mini tlr-boton-acento"
          onClick={props.onMezclarExportar}
          disabled={pistasVacias || props.ocupado}
          title="Mezcla todas las pistas audibles en un nuevo archivo y lo guarda en la biblioteca"
        >
          <Icono nombre="descargar" tamaño={12} />
          {props.ocupado ? 'Procesando…' : 'Mezclar y exportar'}
        </button>
      </div>

      {props.errorCarga ? <div className="tlr-lt-ayuda tlr-nodo-error">{props.errorCarga}</div> : null}

      {pistasVacias ? (
        <div className="tlr-lt-contenido tlr-lt-contenido-vacio">
          <Waveform
            showClipHeaders
            interactiveClips
            showFades
            onRemoveTrack={(indice) => {
              const pista = props.pistas[indice];
              if (pista) {
                props.onEliminarPista(pista.id);
              }
            }}
          />
          <KeyboardShortcuts playback clipSplitting />
          <div className="tlr-lt-vacio">
            <Icono nombre="onda" tamaño={34} />
            <div className="tlr-lt-vacio-titulo">La mesa está vacía</div>
            <div className="tlr-lt-vacio-sub">
              Aquí se montan las pistas de tu narración. Para traer audio:
            </div>
            <ul>
              <li>Ejecuta el grafo de nodos</li>
              <li>Abre un nodo con salida de audio</li>
              <li>Pulsa «A línea de tiempo» en su inspector</li>
            </ul>
            {props.onIrAGrafo ? (
              <button type="button" className="tlr-boton" onClick={props.onIrAGrafo}>
                <Icono nombre="grafo" tamaño={13} />
                Ir al grafo de nodos
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="tlr-lt-contenido">
          <Waveform
            showClipHeaders
            interactiveClips
            showFades
            onRemoveTrack={(indice) => {
              const pista = props.pistas[indice];
              if (pista) {
                props.onEliminarPista(pista.id);
              }
            }}
          />
          <KeyboardShortcuts playback clipSplitting />
        </div>
      )}
    </div>
  );
}
