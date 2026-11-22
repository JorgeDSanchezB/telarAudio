# Pendiente — Nodo `asignacion-musica`

**Estado: IMPLEMENTADO (v1).** Nodo `asignacion-musica`: una pista de la biblioteca (las de ejemplo se importan solas al arrancar: 2 ambientes SINTÉTICOS originales en `public/musica/`), loop con ganancia por bloque de tensión y ducking por energía de la voz. La selección de pista por banda de tensión queda como variante futura documentada.

## Motivo del aplazamiento

Depende de `analisis-tension` y de un catálogo musical. El catálogo implica una decisión con consecuencias legales y de distribución (licencias CC0 verificadas, tamaño del repo); no se debe resolver con URLs inventadas.

## Contrato previsto

```ts
DefinicionNodo {
  tipo: 'asignacion-musica'
  version: '1.0.0'
  etiqueta: 'Música de fondo'
  categoria: 'enriquecimiento'
  runtime: 'cliente'
  entradas: [
    { clave: 'voz', etiqueta: 'Voz', tipo: 'audio', requerida: true },
    { clave: 'curva', etiqueta: 'Curva de tensión', tipo: 'dato', requerida: true },  // subtipo: tension/v1
  ]
  salidas: [{ clave: 'mezcla', etiqueta: 'Voz + música', tipo: 'audio' }]
  parametros: [
    { tipo: 'activo', clave: 'pista', etiqueta: 'Pista musical', defecto: '' },   // activo de la biblioteca etiquetado como música
    { tipo: 'numero', clave: 'gananciaMusicaDb', etiqueta: 'Volumen música', defecto: -18, min: -40, max: 0, unidad: 'dB' },
    { tipo: 'booleano', clave: 'ducking', etiqueta: 'Bajar música bajo la voz', defecto: true },
  ]
  modosDeFallo: [SIN_PISTA (validacion), CURVA_INCOMPATIBLE (validacion)]
}
```

Comportamiento previsto: la pista musical se repite/corta por escenas siguiendo la curva (bloques por segmento de tensión con crossfades, como la Fase 4 de bardoStudio); ducking = bajar la música en las ventanas con voz (compresor lateral implementable como envolvente por ventana sobre el plan de mezcla).

## Plan de reproducción

1. Extender la configuración con `catalogos.musica: { id, nombre, ruta/activo, bandaTension: [min,max] }[]` (validado; importación de archivos del usuario igual que la biblioteca, sin re-codificar — igual que bardoStudio).
2. Función pura `planMusica(curva, pista, params, duraciónVoz) → ElementoMezcla[]` (loop/colisión/crossfades) — testeable en Node.
3. Ducking: función pura que, dadas las ventanas con voz (de la transcripción), genera la envolvente de ganancia de la música.
4. El motor de mezcla (`ServicioRenderizado`) ya soporta todo lo necesario (elementos con ganancia/fundidos por elemento): la música entra como más elementos del plan.
5. Licencias: solo CC0/propia del usuario; el catálogo por defecto llega vacío y la app explica cómo llenarlo (nada de audio de origen dudoso en el repo).
