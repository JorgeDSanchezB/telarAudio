/**
 * Puertos de servicios que el motor inyecta a los procesadores (hexagonal
 * simplificado: los contratos viven aquí, las implementaciones viven en la
 * aplicación y son intercambiables, lo que permite probar los nodos en Node
 * con servicios falsos).
 */

/** Metadatos de un activo de audio de la sesión. */
export interface MetadatosActivo {
  /** Identificador direccionado por contenido (sha256 de los bytes). */
  id: string;
  nombre: string;
  mime: string;
  /** Duración en milisegundos; null si aún no se ha analizado. */
  duracionMs: number | null;
  tasaMuestreo: number | null;
  canales: number | null;
  bytes: number;
  creadoEn: number;
  origen: 'subida' | 'nodo' | 'linea-tiempo' | 'rescate';
}

/** Almacén de activos (implementación en memoria en la app; OPFS pendiente). */
export interface ServicioRegistroActivos {
  obtenerMeta(id: string): MetadatosActivo | undefined;
  /** Registra los bytes y devuelve el metadato con su id direccionado por contenido. */
  poner(datos: Blob, meta: Omit<MetadatosActivo, 'id' | 'creadoEn'>): Promise<MetadatosActivo>;
  obtenerBytes(id: string): Promise<Blob>;
  existe(id: string): boolean;
  eliminar(id: string): boolean;
  /** Listado completo para la biblioteca de la UI. */
  listar(): MetadatosActivo[];
}

/** Decodificación de activos a AudioBuffer (con caché en la implementación). */
export interface ServicioAudio {
  decodificar(idActivo: string, senal?: AbortSignal): Promise<AudioBuffer>;
}

/** Un elemento a mezclar: el buffer ya decodificado y su colocación. */
export interface ElementoMezcla {
  buffer: AudioBuffer;
  /** Inicio del elemento en la línea de tiempo de salida, en ms. */
  inicioMs: number;
  /** Cuánto dura el elemento, en ms. */
  duracionMs: number;
  /** Punto de entrada dentro del buffer (recorte), en ms. */
  offsetMs: number;
  gananciaDb: number;
  fundidoEntradaMs: number;
  fundidoSalidaMs: number;
}

/** Plan de mezcla listo para renderizar. */
export interface PlanMezcla {
  elementos: ElementoMezcla[];
  duracionTotalMs: number;
}

/** Renderizado offline (OfflineAudioContext en la implementación real). */
export interface ServicioRenderizado {
  mezclar(
    plan: PlanMezcla,
    opciones?: { senal?: AbortSignal; progreso?: (fraccion: number) => void },
  ): Promise<AudioBuffer>;
}

export interface RespuestaCapacidad {
  disponible: boolean;
  version?: string;
  capacidades?: string[];
  /** Motivo legible cuando no está disponible. */
  detalle?: string;
}

/**
 * Cliente del backend opcional de nodos pesados. Encapsula el protocolo de
 * trabajos (subir -> sondear -> descargar / cancelar) para que cada nodo
 * remoto solo declare su capacidad y sus parámetros.
 */
export interface ClienteBackend {
  verificar(): Promise<RespuestaCapacidad>;
  ejecutarNodo(parametros: {
    capacidad: string;
    idActivoEntrada: string;
    parametrosNodo: Record<string, unknown>;
    onProgreso?: (fraccion: number, mensaje: string) => void;
    senal?: AbortSignal;
  }): Promise<{ idActivoSalida: string }>;
  /**
   * Variante para capacidades cuyo resultado es un dato estructurado (JSON),
   * p. ej. transcripcion: sube el audio, espera el trabajo y devuelve el
   * contenido del JSON (quien llama lo registra en ServicioRegistroDatos).
   */
  ejecutarNodoDato(parametros: {
    capacidad: string;
    idActivoEntrada: string;
    parametrosNodo: Record<string, unknown>;
    onProgreso?: (fraccion: number, mensaje: string) => void;
    senal?: AbortSignal;
  }): Promise<unknown>;
}

export interface ServicioHash {
  /** sha256 en hexadecimal de los datos recibidos. */
  sha256(datos: ArrayBuffer | Uint8Array | string): Promise<string>;
}

/**
 * Un dato estructurado registrado en la sesión (contrato v1.1 de puertos):
 * el contenido que viaja por una arista `dato`, direccionado por `idDato`.
 * El `idDato` identifica la RANURA (salida de un nodo); las revisiones
 * posteriores (ediciones en el inspector) actualizan el contenido en el mismo
 * id e incrementan `revision`, y quien edita invalida los nodos consumidores.
 */
export interface DatoRegistrado {
  idDato: string;
  /** Subtipo de dato (p. ej. 'transcripcion/v1', 'tension/v1'). */
  tipoDato: string;
  /** Contenido del dato; su forma la define cada subtipo. */
  contenido: unknown;
  revision: number;
  creadoEn: number;
}

/**
 * Almacén de datos estructurados de la sesión (análogo a ServicioRegistroActivos
 * para audio). Los nodos de análisis emiten referencias; los consumidores las
 * resuelven aquí al ejecutarse.
 */
export interface ServicioRegistroDatos {
  /** Registra un dato nuevo y devuelve su metadato con id único. */
  registrar(tipoDato: string, contenido: unknown): Promise<DatoRegistrado>;
  /** Resuelve un idDato a su dato (última revisión). */
  obtener(idDato: string): DatoRegistrado | undefined;
  /**
   * Reemplaza el contenido de un dato existente (misma ranura, nueva revisión).
   * Devuelve el dato revisado. Lanza si el id no existe.
   */
  revisar(idDato: string, contenido: unknown): DatoRegistrado;
  listar(): DatoRegistrado[];
}

/**
 * Acceso de solo lectura a la configuración validada de la aplicación por
 * rutas con punto (p. ej. 'catalogos.muletillas'). Los nodos validan y
 * ajustan el contenido a su contrato; este servicio solo lo transporta.
 */
export interface ServicioConfiguracion {
  leer<T>(ruta: string): T | undefined;
}

/** Conjunto de servicios que el motor pone a disposición de los procesadores. */
export interface ServiciosMotor {
  activos: ServicioRegistroActivos;
  audio: ServicioAudio;
  render: ServicioRenderizado;
  /** Opcional: si no está, los nodos con runtime 'backend' fallan con ErrorConfiguracion. */
  backend?: ClienteBackend;
  /** Opcional: si no está, los nodos que emiten o consumen `dato` fallan con ErrorConfiguracion. */
  datos?: ServicioRegistroDatos;
  /** Opcional: catálogos y ajustes de la app para nodos que los necesitan. */
  configuracion?: ServicioConfiguracion;
  hash: ServicioHash;
  /** Registro global de la sesión (logs). */
  registrar(mensaje: string): void;
  /** Reloj inyectable para pruebas. */
  ahora(): number;
}
