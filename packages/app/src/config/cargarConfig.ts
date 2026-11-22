/**
 * Carga y validación de la configuración. Falla rápido con un mensaje claro:
 * una configuración inválida jamás se degrada en silencio.
 */

import { z } from 'zod';
import { esquemaConfigApp } from './esquema';
import type { ConfigApp } from './esquema';
import configPorDefecto from './config.default.json';

export type ResultadoConfig =
  | { ok: true; config: ConfigApp }
  | { ok: false; error: string };

export function cargarConfig(entrada: unknown = configPorDefecto): ResultadoConfig {
  try {
    // Las secciones ausentes se rellenan con objetos vacíos y cada hoja del
    // esquema aplica su valor por defecto; las claves desconocidas se rechazan.
    const base = entrada && typeof entrada === 'object' ? (entrada as Record<string, unknown>) : {};
    const completa = {
      motor: base.motor ?? {},
      backend: base.backend ?? {},
      audio: base.audio ?? {},
      lineaTiempo: base.lineaTiempo ?? {},
      ffmpegMp3: base.ffmpegMp3 ?? {},
      ui: base.ui ?? {},
      proyectos: base.proyectos ?? {},
      transcripcion: base.transcripcion ?? {},
      catalogos: base.catalogos ?? {},
    };
    const config = esquemaConfigApp.parse(completa);
    return { ok: true, config };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detalles = error.issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`).join(' · ');
      return { ok: false, error: `Configuración inválida: ${detalles}` };
    }
    return { ok: false, error: `No se pudo leer la configuración: ${String(error)}` };
  }
}
