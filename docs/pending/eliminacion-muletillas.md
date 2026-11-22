# Pendiente — Nodo `eliminacion-muletillas`

**Estado: IMPLEMENTADO (v1).** Nodo `eliminacion-muletillas`: catálogo en `catalogos.muletillas` (configuración), corte + cierre de huecos + crossfade, revisión aprobación/rechazo en el inspector (excluir por índice de palabra, misma ranura del dato, invalidación selectiva de consumidores).

## Motivo del aplazamiento

Depende de `transcripcion-whisper` (pendiente). Toda su lógica está ya especificada abajo y es de bajo riesgo (cortes + crossfade con Web Audio, ya cubierto por `ServicioRenderizado`).

## Contrato previsto

```ts
DefinicionNodo {
  tipo: 'eliminacion-muletillas'
  version: '1.0.0'
  etiqueta: 'Eliminar muletillas'
  categoria: 'limpieza'
  runtime: 'cliente'
  entradas: [
    { clave: 'audio', etiqueta: 'Audio', tipo: 'audio', requerida: true },
    { clave: 'transcripcion', etiqueta: 'Transcripción', tipo: 'dato', requerida: true },
    // (subtipo esperado: transcripcion/v1 — ver nota de contrato en transcripcion-whisper.md)
  ]
  salidas: [{ clave: 'salida', etiqueta: 'Audio sin muletillas', tipo: 'audio' }]
  parametros: [
    { tipo: 'numero', clave: 'pausaMinimaMs', etiqueta: 'Pausa mínima', defecto: 250, min: 50, max: 2000, unidad: 'ms' },
    { tipo: 'numero', clave: 'fundidoMs', etiqueta: 'Crossfade', defecto: 25, min: 0, max: 200, unidad: 'ms' },
    { tipo: 'opcion', clave: 'modo', defecto: 'solo_pausas',
      opciones: [
        { valor: 'solo_pausas', etiqueta: 'Solo en pausas (seguro)' },
        { valor: 'siempre', etiqueta: 'También en voz seguida (más agresivo)' },
      ] },
  ]
  modosDeFallo: [FUSION-like PARAM_INVALIDOS (validacion), DATO_INCOMPATIBLE (validacion),
                 GANANCIA_AUDIO_SILENTE-like (validacion)]
}
```

Comportamiento: recorre `palabras` de la transcripción; las que estén en el **catálogo de muletillas** (configuración de la app, migrando el formato de `filler_words.json`: lista editable por el usuario) y vengan rodeadas de pausas ≥ `pausaMinimaMs` (o siempre, en modo agresivo) se eliminan del plan de mezcla; los huecos se cierran desplazando el audio posterior; crossfade de `fundidoMs` en cada unión (el original usaba 25 ms por defecto). El resultado es un activo nuevo (el original nunca se toca, igual que `exports/` en el repo original).

## Plan de reproducción

1. Migrar el catálogo: `config.default.json → catalogos.muletillas: string[]` (validado por zod; el usuario lo amplía).
2. Lógica pura `planSinMuletillas(transcripcion, catálogo, params) → PlanMezcla` (en `packages/nodos`, 100 % testeable en Node: casos de pausa corta, muletilla entre palabras, palabras repetidas).
3. Procesador: decodificar audio + aplicar el plan con `renderizarAActivo`.
4. Panel de revisión (el paso «Revisar detecciones» del original): el `dato` intermedio con marcas de detección se muestra en el inspector; aprobar/rechazar edita el `dato` antes de este nodo (sin puertas de pipeline: es un nodo más).
