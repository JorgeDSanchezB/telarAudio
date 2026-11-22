'use client';

/**
 * Iconos SVG en línea (trazo 1.7, estilo pluma) para toda la UI de Telar.
 * Sustituyen a los glifos unicode (▶ ■ ⤓ …), que se veían distintos en cada
 * sistema operativo y no admiten color/peso fino. Sin dependencias externas:
 * cada icono es un path de 24×24 dibujado a mano, hereda currentColor y se
 * escala con la altura de línea del texto que lo rodea.
 */

export type NombreIcono =
  | 'reproducir'
  | 'pausar'
  | 'detener'
  | 'cancelar'
  | 'reintentar'
  | 'descargar'
  | 'subir'
  | 'enviar'
  | 'tijeras'
  | 'deshacer'
  | 'rehacer'
  | 'alerta'
  | 'info'
  | 'exito'
  | 'fallo'
  | 'carpeta'
  | 'nodos'
  | 'grafo'
  | 'onda'
  | 'cpu'
  | 'mas'
  | 'menos'
  | 'poder'
  | 'cache'
  | 'rayo'
  | 'capas'
  | 'disco'
  | 'cerrar'
  | 'lupa'
  | 'candado'
  | 'papelera'
  | 'abrir';

const TRAZOS: Record<NombreIcono, React.ReactNode> = {
  reproducir: <polygon points="7 4.5 19.5 12 7 19.5 7 4.5" fill="currentColor" stroke="none" />,
  pausar: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  detener: <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor" stroke="none" />,
  cancelar: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </>
  ),
  reintentar: (
    <>
      <polyline points="22 4 22 10 16 10" />
      <path d="M20.49 15a9 9 0 1 1-2.13-9.36L22 10" />
    </>
  ),
  descargar: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7.5 10.5 12 15 16.5 10.5" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>
  ),
  subir: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7.5 7.5 12 3 16.5 7.5" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </>
  ),
  enviar: (
    <>
      <path d="M22 2 11 13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </>
  ),
  tijeras: (
    <>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <line x1="20" y1="4" x2="8.2" y2="15.8" />
      <line x1="14.5" y1="14.5" x2="20" y2="20" />
      <line x1="8.2" y1="8.2" x2="12" y2="12" />
    </>
  ),
  deshacer: (
    <>
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </>
  ),
  rehacer: (
    <>
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </>
  ),
  alerta: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13.5" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="11" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </>
  ),
  exito: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  fallo: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </>
  ),
  carpeta: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  nodos: (
    <>
      <circle cx="5.5" cy="6" r="2.5" />
      <circle cx="18.5" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M7.5 7.2 10.4 16M16.5 7.2 13.6 16M8 6h8" />
    </>
  ),
  grafo: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  onda: (
    <>
      <path d="M3 12h2l2-7 3 14 3-11 2.5 7 2-3H21" />
    </>
  ),
  cpu: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <line x1="9" y1="2" x2="9" y2="5" />
      <line x1="15" y1="2" x2="15" y2="5" />
      <line x1="9" y1="19" x2="9" y2="22" />
      <line x1="15" y1="19" x2="15" y2="22" />
      <line x1="19" y1="9" x2="22" y2="9" />
      <line x1="19" y1="15" x2="22" y2="15" />
      <line x1="2" y1="9" x2="5" y2="9" />
      <line x1="2" y1="15" x2="5" y2="15" />
    </>
  ),
  mas: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  menos: <line x1="5" y1="12" x2="19" y2="12" />,
  poder: (
    <>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="11" />
    </>
  ),
  cache: (
    <>
      <polyline points="22 4 22 10 16 10" />
      <polyline points="2 20 2 14 8 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L22 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </>
  ),
  rayo: <polygon points="13 2 3.5 14 11.5 14 10.5 22 20.5 10 12.5 10 13 2" />,
  capas: (
    <>
      <polygon points="12 2.5 2.5 7.5 12 12.5 21.5 7.5 12 2.5" />
      <polyline points="2.5 17 12 22 21.5 17" />
      <polyline points="2.5 12 12 17 21.5 12" />
    </>
  ),
  disco: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  abrir: (
    <>
      <path d="M21 17V9a2 2 0 0 0-2-2h-7.6a2 2 0 0 1-1.7-1l-.8-1.4a2 2 0 0 0-1.7-1H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z" />
      <path d="M3 11h18" />
    </>
  ),
  cerrar: (
    <>
      <line x1="17" y1="7" x2="7" y2="17" />
      <line x1="7" y1="7" x2="17" y2="17" />
    </>
  ),
  lupa: (
    <>
      <circle cx="11" cy="11" r="7.5" />
      <line x1="21" y1="21" x2="16.2" y2="16.2" />
    </>
  ),
  candado: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ),
  papelera: (
    <>
      <polyline points="3.5 6 5.5 6 20.5 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>
  ),
};

export interface PropsIcono {
  nombre: NombreIcono;
  /** Tamaño en píxeles del lienzo (por defecto 15, altura de icono de botón). */
  tamaño?: number;
}

export function Icono({ nombre, tamaño = 15 }: PropsIcono) {
  return (
    <svg
      className="tlr-icono"
      width={tamaño}
      height={tamaño}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRAZOS[nombre]}
    </svg>
  );
}
