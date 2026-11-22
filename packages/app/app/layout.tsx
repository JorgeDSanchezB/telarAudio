import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

/* Tipografías auto-hospedadas (fontsource): sin CDN, funcionan sin red. */
import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/jetbrains-mono';
import './globals.css';

export const metadata: Metadata = {
  title: 'Telar Audio — Postproducción de narración',
  description:
    'Plataforma de postproducción de audio para narración en español: motor DAG no lineal, nodos visuales y editor de línea de tiempo. Todo en tu navegador.',
};

export const viewport: Viewport = {
  themeColor: '#131014',
  width: 'device-width',
  initialScale: 1,
};

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
