# Pendiente — Nodo `transcripcion-whisper`

**Estado: IMPLEMENTADO (v1).** Backend `app/whisper.py` (faster-whisper, bloques reanudables, word timestamps, LRU de 1 modelo) + nodo `transcripcion-whisper` + visor en el inspector. Modelos en `backend/modelos/whisper-<tamaño>/` (ver README).

## Motivo del aplazamiento

La rebanada vertical de esta pasada priorizó motor + fusión + línea de tiempo. La transcripción es el prerequisito de tres nodos más (muletillas, tensión, SFX) y merece su propia pasada con decisiones de modelo (tamaño, idioma, hardware) tomadas con calma y verificadas con audio real de narración.

## Contrato previsto

```ts
DefinicionNodo {
  tipo: 'transcripcion-whisper'
  version: '1.0.0'
  etiqueta: 'Transcripción (Whisper, backend)'
  categoria: 'enriquecimiento'
  runtime: 'backend'
  capacidadBackend: 'transcripcion'
  entradas:  [{ clave: 'entrada', etiqueta: 'Audio', tipo: 'audio', requerida: true }]
  salidas:   [{ clave: 'transcripcion', etiqueta: 'Transcripción', tipo: 'dato' }]
  // El subtipo viaja en el VALOR del puerto: { tipo:'dato', idDato, tipoDato:'transcripcion/v1' }.
  // Nota de contrato: para VALIDAR el subtipo en la entrada de los nodos que
  // lo consumen hará falta extender DefinicionPuerto con `tipoDato?`
  // (extensión de contrato v1.1, localizada en packages/motor/src/contratos/puertos.ts).
  parametros: [
    { tipo: 'opcion', clave: 'modelo', defecto: 'small',
      opciones: [{valor:'tiny',...},{valor:'base',...},{valor:'small',...}] },
    { tipo: 'opcion', clave: 'idioma', defecto: 'es', opciones: [...idiomas con foco es...] },
  ]
  modosDeFallo: [BACKEND_NO_DISPONIDO (config), MODELO_NO_DESCARGADO (config),
                 AUDIO_SIN_VOZ (validacion), TIMEOUT (temporal)]
}
```

`transcripcion/v1` (el `dato` que emite):

```json
{ "segmentos": [{ "inicioMs": 0, "finMs": 1520, "texto": "…",
                  "palabras": [{ "palabra": "…", "inicioMs": 0, "finMs": 320 }] }] }
```

## Plan de reproducción (migración desde eliminaMuletillas)

1. Backend: `backend/app/whisper.py` — cargar modelo bajo demanda (cache LRU de 1 modelo), transcribir con `word_timestamps=True` en bloques reanudables (≤5 min por bloque, como hacía bardoStudio para acotar RAM), emitir progreso por bloque. Router `transcripcion` con la misma forma de `ruido.py` (multipart → 202 → sondeo → resultado JSON en vez de WAV).
2. Cliente: procesador que llama `ejecutarNodo` (el protocolo ya soporta resultados no-audio si el backend responde JSON y el cliente registra el `dato` en un almacén de datos análogo al de activos — añadir `ServicioRegistroDatos` a los contratos, ~40 líneas).
3. Inspector: visor mínimo de segmentos/palabras del `dato` (tabla virtualizada).
4. Pruebas: procesador con backend falso (ya cubierto el patrón); backend con modelo real marcado skipif si no hay modelo descargado.
5. Riesgos: peso del modelo en disco/ram (elegir `small` por defecto), licencias (Whisper es MIT), idioma (forzar decodificación `es` para velocidad).
