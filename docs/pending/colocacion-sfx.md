# Pendiente — Nodo `colocacion-sfx`

**Estado: IMPLEMENTADO (v1).** Nodo `colocacion-sfx`: diccionario en `catalogos.sfx` (migración del FORMATO de `sfx_config.json`; los 381 términos originales y la biblioteca de 37 SFX del repo no se redistribuyen: el catálogo por defecto trae 6 efectos SINTÉTICOS originales en `public/sfx/`), colocación al fin exacto de la palabra, dato de colocaciones activable por interruptor. Añade tus propios WAV y términos en la configuración.

## Motivo del aplazamiento

Depende de `transcripcion-whisper` y del catálogo de efectos (misma consideración de licencias/distribución que la música).

## Contrato previsto

```ts
DefinicionNodo {
  tipo: 'colocacion-sfx'
  version: '1.0.0'
  etiqueta: 'Efectos de sonido por contexto'
  categoria: 'enriquecimiento'
  runtime: 'cliente'
  entradas: [
    { clave: 'voz', etiqueta: 'Voz', tipo: 'audio', requerida: true },
    { clave: 'transcripcion', etiqueta: 'Transcripción', tipo: 'dato', requerida: true },  // subtipo: transcripcion/v1
  ]
  salidas: [{ clave: 'mezcla', etiqueta: 'Voz + efectos', tipo: 'audio' }]
  parametros: [
    { tipo: 'numero', clave: 'gananciaSfxDb', etiqueta: 'Volumen efectos', defecto: -12, min: -40, max: 6, unidad: 'dB' },
    { tipo: 'numero', clave: 'desplazamientoMs', etiqueta: 'Desplazamiento', defecto: 0, min: -2000, max: 2000, unidad: 'ms' },
  ]
  modosDeFallo: [SIN_EFECTOS_EN_CATALOGO (config), DATO_INCOMPATIBLE (validacion)]
}
```

Comportamiento: el diccionario (migración directa de `sfx_config.json`: término → efecto, con sinónimos/plurales/derivados) se aplica sobre las `palabras` de la transcripción; cada coincidencia coloca el SFX en el segundo exacto de la mención (`finMs` de la palabra + `desplazamientoMs`); el resultado entra como elementos de mezcla. Todo auditable: el `dato` intermedio lista las colocaciones para activar/desactivar/mover en el inspector (equivalente al panel de bardoStudio, sin puerta).

## Plan de reproducción

1. Config: `catalogos.sfx: { id, nombre, terminos: string[] }[]` (validado con zod; formato inspirado en `sfx_config.json`).
2. Función pura `planSfx(transcripcion, catálogo, params) → { colocaciones, elementos }` — casos: coincidencia múltiple en la misma frase, solapes, términos derivados.
3. Reutilizar `renderizarAActivo` (la infraestructura de mezcla ya está).
4. Panel de colocaciones en el inspector (lista virtualizada con interruptores).
