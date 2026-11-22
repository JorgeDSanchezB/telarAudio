#!/usr/bin/env node
/**
 * Copia ffmpeg.wasm (núcleo single-thread + bundle UMD + worker) desde
 * node_modules a packages/app/public/ffmpeg para que el exportador MP3
 * funcione sin red y sin depender de un CDN (la política del proyecto es no
 * descargar binarios en tiempo de ejecución).
 *
 * Uso:  npm run preparar:ffmpeg
 * Es idempotente: se puede ejecutar tantas veces como se quiera.
 *
 * Por qué el núcleo single-thread y no el multihilo: el núcleo multihilo
 * exige cabeceras COOP/COEP (SharedArrayBuffer), lo que aísla el documento
 * y rompe la carga de audio externo. El single-thread no las necesita.
 *
 * Por qué la build UMD: la build ESM de @ffmpeg/ffmpeg 0.12 contiene
 * `new Worker(new URL(classWorkerURL, import.meta.url))`, que Turbopack no
 * puede analizar y rompe `next build`. La build UMD resuelve su worker
 * desde su propia ruta pública, que es exactamente /ffmpeg/ (ADR-010).
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizProyecto = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(raizProyecto, 'package.json'));
const carpetaDestino = join(raizProyecto, 'packages', 'app', 'public', 'ffmpeg');

/** Archivos a copiar: [paquete npm, ruta dentro del paquete, nombre de destino] */
const ARCHIVOS = [
  ['@ffmpeg/core', 'dist/umd/ffmpeg-core.js', 'ffmpeg-core.js'],
  ['@ffmpeg/core', 'dist/umd/ffmpeg-core.wasm', 'ffmpeg-core.wasm'],
  ['@ffmpeg/ffmpeg', 'dist/umd/814.ffmpeg.js', '814.ffmpeg.js'],
  ['@ffmpeg/ffmpeg', 'dist/umd/ffmpeg.js', 'ffmpeg.js'],
];

function rutaDePaquete(nombrePaquete) {
  // npm hoistea las dependencias a la raíz del monorepo; por si acaso,
  // también se mira dentro del paquete de la app. (Los paquetes @ffmpeg/*
  // no exponen ./package.json en "exports", así que no se puede usar
  // require.resolve con esa subruta.)
  const candidatas = [
    join(raizProyecto, 'node_modules', nombrePaquete),
    join(raizProyecto, 'packages', 'app', 'node_modules', nombrePaquete),
  ];
  for (const candidata of candidatas) {
    if (existsSync(join(candidata, 'package.json'))) {
      return candidata;
    }
  }
  process.stderr.write(
    `ERROR: no se encontró el paquete "${nombrePaquete}" en node_modules. Ejecuta "npm install" en la raíz del monorepo antes de volver a intentarlo.\n`,
  );
  process.exit(1);
}

mkdirSync(carpetaDestino, { recursive: true });

for (const [paquete, relativo, nombreDestino] of ARCHIVOS) {
  const origen = join(rutaDePaquete(paquete), relativo);
  const destino = join(carpetaDestino, nombreDestino);
  try {
    copyFileSync(origen, destino);
  } catch (error) {
    process.stderr.write(
      `ERROR: no se pudo copiar ${origen} -> ${destino}: ${error instanceof Error ? error.message : String(error)}\n` +
        'Revisa que la versión instalada de @ffmpeg/core y @ffmpeg/ffmpeg sea 0.12.x.\n',
    );
    process.exit(1);
  }
  const bytes = statSync(destino).size;
  if (bytes === 0) {
    process.stderr.write(`ERROR: ${destino} quedó vacío. Cancelado.\n`);
    process.exit(1);
  }
  const megabytes = (bytes / (1024 * 1024)).toFixed(1);
  process.stdout.write(`OK  ${nombreDestino}  (${megabytes} MB)\n`);
}

process.stdout.write(
  `\nListo. ffmpeg.wasm queda servido desde /ffmpeg/ en la app.\n` +
    'El exportador MP3 lo cargará bajo demanda (la primera vez tarda unos segundos).\n',
);
