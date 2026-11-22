# Pendiente — Nodo `analisis-tension`

**Estado: IMPLEMENTADO (v1 heurística).** Nodo `analisis-tension`: función pura (densidad de palabras + pausas + signos + léxico), curva corregible arrastrando puntos en el inspector. La variante LLM sigue pendiente de decisión de producto (el parámetro existe y falla con MOTOR_NO_DISPONIBLE, sin prometer lo no verificado).

## Motivo del aplazamiento

Depende de `transcripcion-whisper` y de una decisión de producto que no corresponde tomar en silencio: en bardoStudio la tensión por escena la calculaba un LLM (vía z-ai-web-dev-sdk). Para Telar hay que decidir entre LLM local (coste/instalación) o heurística sin LLM (energía + ritmo + signos de puntuación). El contrato es agnóstico a esa decisión.

## Contrato previsto

```ts
DefinicionNodo {
  tipo: 'analisis-tension'
  version: '1.0.0'
  etiqueta: 'Análisis de tensión narrativa'
  categoria: 'enriquecimiento'
  runtime: 'cliente'   // heurística; si se elige LLM, variante con runtime 'backend'
  entradas: [{ clave: 'transcripcion', etiqueta: 'Transcripción', tipo: 'dato', requerida: true }]
  salidas: [{ clave: 'curva', etiqueta: 'Curva de tensión', tipo: 'dato' }]  // subtipo en el valor: tension/v1
  parametros: [
    { tipo: 'numero', clave: 'granularidadS', etiqueta: 'Granularidad', defecto: 30, min: 5, max: 120, unidad: 's' },
    { tipo: 'opcion', clave: 'motor', defecto: 'heuristica',
      opciones: [{valor:'heuristica',...},{valor:'llm-backend',...}] },
  ]
  modosDeFallo: [DATO_INCOMPATIBLE (validacion), MOTOR_NO_DISPONIBLE (config)]
}
```

`tension/v1`: `{ puntos: [{ inicioMs, tension: 0..100, animo?: string }], corregible: true }`. La curva es **corregible** (en bardoStudio el usuario ajustaba antes de avanzar): el inspector permitirá editar los puntos del `dato` antes de pasarlo al nodo de música; no hay puerta que bloquee el resto del grafo.

## Plan de reproducción

1. Heurística v1 (sin LLM): energía RMS por ventana (ya existe la infraestructura de buffers) + densidad de palabras + signos, todo en función pura testeable con transcripciones sintéticas.
2. Variante LLM (si se decide): nodo `runtime: 'backend'` con capacidad `analisis-tension`, mismo contrato de salida.
3. Visualizador de curva en el inspector (SVG sparkline con puntos arrastrables).
4. La asignación de música (siguiente pendiente) consume `tension/v1` por diseño.
