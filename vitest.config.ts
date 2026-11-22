import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Configuración única de pruebas para todos los paquetes TypeScript del monorepo.
 * Los alias apuntan al código fuente de cada paquete (no a artefactos compilados)
 * para que las pruebas siempre verifiquen el código que se publica en la app.
 */
const aliasDe = (ruta: string) => fileURLToPath(new URL(ruta, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@telar/motor': aliasDe('./packages/motor/src/index.ts'),
      '@telar/nodos': aliasDe('./packages/nodos/src/index.ts'),
      '@telar/linea-tiempo': aliasDe('./packages/linea-tiempo/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    reporters: ['default'],
  },
});
