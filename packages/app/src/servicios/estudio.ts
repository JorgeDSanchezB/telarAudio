/**
 * Fábrica del "estudio": crea y cablea registro de nodos, motor DAG y todos
 * los servicios (adaptadores). Es el único punto donde se componen las
 * piezas; los componentes solo ven el resultado.
 */

import { Motor, RegistroNodos } from '@telar/motor';
import type { ConfigMotor, ServiciosMotor } from '@telar/motor';
import { registrarNodosIncluidos } from '@telar/nodos';
import { RegistroActivosMemoria } from './activos';
import { ClienteBackendLocal } from './backend';
import { DecodificadorAudio } from './audio';
import { ConfiguracionApp, RegistroDatosMemoria } from './datos';
import { ExportadorMp3 } from './exportacion';
import { HashWebCrypto } from './hash';
import { RenderizadorWebAudio } from './render';
import { TranscodificadorWasm } from './transcodificar';
import type { ConfigApp } from '../config/esquema';

export interface Estudio {
  registro: RegistroNodos;
  motor: Motor;
  activos: RegistroActivosMemoria;
  datos: RegistroDatosMemoria;
  decodificador: DecodificadorAudio;
  render: RenderizadorWebAudio;
  clienteBackend: ClienteBackendLocal;
  exportadorMp3: ExportadorMp3;
  transcodificador: TranscodificadorWasm;
  config: ConfigApp;
  registroDeSesion: string[];
}

export function crearEstudio(config: ConfigApp): Estudio {
  const registroDeSesion: string[] = [];
  const registrar = (mensaje: string): void => {
    const conMarca = `${new Date().toLocaleTimeString('es')} ${mensaje}`;
    registroDeSesion.push(conMarca);
    if (registroDeSesion.length > 500) {
      registroDeSesion.shift();
    }
    console.log(`[Telar] ${mensaje}`);
  };

  const registro = new RegistroNodos();
  registrarNodosIncluidos(registro, {
    modeloTranscripcionDefecto: config.transcripcion.modeloDefecto,
  });

  const hash = new HashWebCrypto();
  const activos = new RegistroActivosMemoria(hash);
  const datos = new RegistroDatosMemoria(hash);
  const configuracion = new ConfiguracionApp(config as unknown as Record<string, unknown>);
  const decodificador = new DecodificadorAudio(config.audio.tasaMuestreo, (id) => activos.obtenerBytes(id));
  const render = new RenderizadorWebAudio(config.audio.tasaMuestreo);
  const clienteBackend = new ClienteBackendLocal(config.backend, { activos, decodificador, registrar });

  const servicios: ServiciosMotor = {
    activos,
    audio: decodificador,
    render,
    backend: clienteBackend,
    datos,
    configuracion,
    hash,
    registrar,
    ahora: () => Date.now(),
  };

  const motor = new Motor({
    registro,
    servicios,
    config: config.motor as ConfigMotor,
  });

  const exportadorMp3 = new ExportadorMp3(config.ffmpegMp3);
  const transcodificador = new TranscodificadorWasm(config.ffmpegMp3);

  registrar(
    `Estudio listo. ${registro.tamano()} nodo(s) en el catálogo; tasa de sesión ${config.audio.tasaMuestreo} Hz;` +
      ` backend opcional en ${config.backend.url}.`,
  );

  return { registro, motor, activos, datos, decodificador, render, clienteBackend, exportadorMp3, transcodificador, config, registroDeSesion };
}
