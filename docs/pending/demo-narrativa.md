# Demo narrativa completa (grafo de ejemplo con nodos diferenciadores)

Estado: **propuesta** (no implementada).

## Contexto

El botón «Cargar narración de ejemplo» del lienzo vacío monta hoy la cadena
simple y universal Fuente → Ganancia (−3 dB) → Fusión. Funciona sin backend y
cabe en cualquier máquina, pero enseña «plomería» (conectar y ejecutar), no la
propuesta de valor del producto: **postproducción de narración asistida**.

La auditoría visual adversarial (ronda 4) lo señaló como la mejora de mayor
impacto pendiente: la demo debería narrar lo que Telar hace con una narración.

## Propuesta

Montar, cuando el backend esté disponible y con un activo de narración real:

```
Fuente (narración) → Transcripción Whisper → Análisis de tensión
                                    ├→ Eliminar muletillas ─┐
                                    └→ Efectos por contexto ├→ Fusión → línea de tiempo
                                     Música de fondo (ducking)┘
```

y dejar visibles los datos generados (curva de tensión corregible en el
inspector, colocaciones de SFX, catálogo de muletillas) antes de enviar la
mezcla a la línea de tiempo.

## Por qué no está hecha

1. **Falta un activo de narración de ejemplo**: la biblioteca trae solo música
   (`catalogos.musica`). Haría falta grabar/sintetizar una narración corta en
   español (~30 s) y catalogarla (`catalogos.narracion`).
2. **Depende del backend**: la transcripción es un nodo pesado; sin backend la
   cadena muere a mitad. La demo simple debe seguir existiendo como fallback
   (decisión en `cargarEjemplo` según `estadoBackend.disponible`).
3. **Coste de ejecución**: Whisper tiny sobre ~30 s tarda decenas de segundos
   la primera vez; la demo debería mostrar progreso honesto, no fingir
   inmediatez.

## Criterios de aceptación

- Con backend: se monta la cadena completa, se ejecuta y el usuario ve la
  curva de tensión y las colocaciones de SFX antes de la línea de tiempo.
- Sin backend: se monta la cadena simple actual (sin errores de por medio).
- La narración de ejemplo se reproduce correctamente y su transcripción tiene
  marcas de tiempo por palabra.
