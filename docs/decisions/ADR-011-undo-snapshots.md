# ADR-011 — Undo/redo de la línea de tiempo por instantáneas (referencias) e inmutabilidad

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

La edición de la línea de tiempo mezcla eventos de dos orígenes: los del motor de la librería (arrastrar/recortar, que pueden avisar fotograma a fotograma durante un recorte) y los estructurales propios (añadir pista, corte destructivo, undo). El undo debe cubrir ambos con una sola historia.

## Decisión

- **Todas las operaciones del documento son puras e inmutables** (`@telar/linea-tiempo`): devuelven arreglos/objetos nuevos; el historial guarda **referencias** a estados previos ⇒ apilar es O(1) y no copia `AudioBuffer`s.
- `Historial<T>` (pila con tope configurable) es la única historia de undo; el undo propio de la librería no se cablea (para no tener dos historias rivales). Atajos Ctrl+Z/Ctrl+Shift+Z propios.
- Las ráfagas de la librería se coalescen: se guarda el estado previo al primer evento y se confirma tras una ventana de configuración (`confirmacionHistorialMs`), de modo que un recorte arrastrado cuenta como UN paso de undo.

## Problema que resuelve

Undo/redo predecible sobre cualquier operación (incluido el corte destructivo, que es compuesto: eliminación de rango + rebounce + sustitución de pista).

## Coste

Hasta `limiteHistorial` referencias vivas por sesión (metadatos diminutos: los datos pesados son los AudioBuffer que ya están vivos). El deshacer un corte destructivo restaura el arreglo, no borra el audio renderizado (queda en la biblioteca): matiz documentado y deliberado.

## Alternativas descartada

**Patrón Comando** (apply/revert por operación): más complejo y frágil ante operaciones compuestas; obligaría a escribir el inverso de cada operación y a mantener coherencia con los eventos de la librería.
