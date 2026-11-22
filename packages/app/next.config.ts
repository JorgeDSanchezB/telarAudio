import type { NextConfig } from 'next';

/**
 * Los paquetes internos se publican como código fuente TypeScript (sin build
 * propio, ver ADR-009), por lo que Next debe transpilarlos.
 */
const configuracion: NextConfig = {
  transpilePackages: ['@telar/motor', '@telar/nodos', '@telar/linea-tiempo', '@telar/ui'],
  // Sin el botón flotante de DevTools en desarrollo: en un estudio de
  // edición a pantalla completa estorba y contamina las capturas.
  devIndicators: false,
  // Solo desarrollo: orígenes desde los que se pueden pedir recursos de dev
  // (chunks, HMR). Si sirves la app tras un proxy, añade aquí su dominio.
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  async rewrites() {
    // El backend opcional (uvicorn en 127.0.0.1:8000) se consume a través de
    // la ruta "/backend" del propio Next (config `backend.url`): así funciona
    // igual en local y tras proxies que solo exponen un puerto.
    return [{ source: '/backend/:path*', destination: 'http://127.0.0.1:8000/:path*' }];
  },
};

export default configuracion;
