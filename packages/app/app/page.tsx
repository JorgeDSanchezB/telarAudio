'use client';

/**
 * Única página visible de la aplicación: el estudio. Se carga como componente
 * cliente (toda la interacción es de navegador).
 */

import dynamic from 'next/dynamic';

// El estudio usa AudioContext, React Flow y waveform-playlist: se carga solo
// en el navegador para que el prerender del servidor no toque APIs de audio.
const Estudio = dynamic(() => import('../src/componentes/Estudio').then((modulo) => modulo.Estudio), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh', background: '#14171c', color: '#e8ebf2' }}>
      Cargando Telar Audio…
    </div>
  ),
});

export default function Pagina() {
  return <Estudio />;
}
