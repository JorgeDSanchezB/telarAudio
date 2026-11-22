'use client';

/**
 * Marca de Telar: dos urdimbres (ocre y terracota) y una trama (verde agua)
 * que pasa por encima de una y por debajo de la otra, como en un telar real.
 * El orden de dibujado crea el entrelazado: trama izquierda bajo la urdimbre
 * ocre, trama derecha sobre la terracota.
 */

export interface PropsMarca {
  /** Tamaño en píxeles (por defecto 26, tamaño de la barra superior). */
  tamaño?: number;
}

export function Marca({ tamaño = 26 }: PropsMarca) {
  return (
    <svg
      width={tamaño}
      height={tamaño}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* urdimbre ocre */}
      <path
        d="M7.5 2.5 C 15.5 8.5, 15.5 19.5, 7.5 25.5"
        stroke="#e2a24a"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* trama (izquierda): pasa por DEBAJO de la urdimbre ocre */}
      <path d="M2.5 14 H 12.4" stroke="#56bcae" strokeWidth="2.4" strokeLinecap="round" />
      {/* urdimbre terracota */}
      <path
        d="M20.5 2.5 C 12.5 8.5, 12.5 19.5, 20.5 25.5"
        stroke="#dd7a45"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* trama (derecha): pasa por ENCIMA de la urdimbre terracota */}
      <path d="M15.6 14 H 25.5" stroke="#56bcae" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
