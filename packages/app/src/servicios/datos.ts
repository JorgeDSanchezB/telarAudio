/**
 * Almacén de datos estructurados de la sesión (implementación de
 * ServicioRegistroDatos del motor): transcripciones, curvas de tensión,
 * colocaciones… Vive en memoria (como los activos); la persistencia OPFS
 * sigue documentada en docs/pending/persistencia-opfs.md.
 */

import { ErrorValidacion } from '@telar/motor';
import type { DatoRegistrado, ServicioRegistroDatos } from '@telar/motor';
import type { ServicioHash } from '@telar/motor';

export class RegistroDatosMemoria implements ServicioRegistroDatos {
  private readonly datos = new Map<string, DatoRegistrado>();
  private contador = 0;

  constructor(
    private readonly hash: ServicioHash,
    private readonly ahora: () => number = () => Date.now(),
  ) {}

  async registrar(tipoDato: string, contenido: unknown): Promise<DatoRegistrado> {
    this.contador += 1;
    const semilla = await this.hash.sha256(
      `${tipoDato}|${this.contador}|${this.ahora()}|${JSON.stringify(contenido)?.length ?? 0}`,
    );
    const dato: DatoRegistrado = {
      idDato: `dato-${semilla.slice(0, 12)}`,
      tipoDato,
      contenido,
      revision: 1,
      creadoEn: this.ahora(),
    };
    this.datos.set(dato.idDato, dato);
    return dato;
  }

  obtener(idDato: string): DatoRegistrado | undefined {
    return this.datos.get(idDato);
  }

  revisar(idDato: string, contenido: unknown): DatoRegistrado {
    const dato = this.datos.get(idDato);
    if (!dato) {
      throw new ErrorValidacion({
        codigo: 'DATO_NO_ENCONTRADO',
        mensaje: `No existe el dato ${idDato} que se quería revisar.`,
        mensajeUsuario: 'El dato que intentas revisar ya no existe.',
        reintentable: false,
      });
    }
    const revisado: DatoRegistrado = {
      ...dato,
      contenido,
      revision: dato.revision + 1,
    };
    this.datos.set(idDato, revisado);
    return revisado;
  }

  listar(): DatoRegistrado[] {
    return [...this.datos.values()];
  }
}

/**
 * ServicioConfiguracion sobre la configuración validada de la app: lectura
 * por rutas con punto (catalogos.muletillas, transcripcion.modeloDefecto…).
 */
export class ConfiguracionApp {
  constructor(private readonly config: Record<string, unknown>) {}

  leer<T>(ruta: string): T | undefined {
    let actual: unknown = this.config;
    for (const parte of ruta.split('.')) {
      if (typeof actual !== 'object' || actual === null) return undefined;
      actual = (actual as Record<string, unknown>)[parte];
    }
    return (actual as T) ?? undefined;
  }
}
