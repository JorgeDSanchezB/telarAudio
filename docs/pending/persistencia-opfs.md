# Pendiente — Persistencia entre sesiones (OPFS/IndexedDB) y proyectos guardables

**Estado: NO implementado.** En esta pasada la sesión vive en memoria: al recargar se pierden grafo, biblioteca y línea de tiempo (los archivos originales del usuario nunca se tocan).

## Motivo del aplazamiento

La rebanada vertical priorizó el motor y el editor. La persistencia añade un ciclo de vida asíncrono completo (migraciones de esquema, cuotas, eviction) que merece su propia pasada con pruebas de upgrade.

## Diseño previsto

- **`ServicioRegistroActivos` persistente**: los blobs a OPFS (`navigator.storage.getDirectory()`), metadatos en IndexedDB; misma interfaz actual (la app no cambia). Estrategia de cuota: `navigator.storage.estimate()` + política LRU visible para el usuario (nada de borrado silencioso).
- **Proyectos**: `Proyecto { id, nombre, creadoEn, actualizadoEn, documentoGrafo, pistas (sin AudioBuffer: ids de activos), config }` serializado a JSON con `version`; importación validada con zod estricto (claves desconocidas rechazadas) y `GrafoDag.desdeDocumento` ya valida la versión del grafo.
- **Rehidratación**: los `AudioBuffer` se re-decodifican bajo demanda desde los blobs persistidos (el caché actual ya funciona así); los clips de la línea de tiempo se reconstruyen con sus ids.
- Fichas de audio ya presentes para el futuro: ids por contenido (estables entre sesiones) e `idActivo` como única referencia cruzada (grafo↔timeline↔biblioteca).

## Pasos

1. Implementar `RegistroActivosOPFS` con la misma interfaz + pruebas (fake-indexeddb en Node para la lógica, navegador para OPFS).
2. Guardado/autosave del proyecto (debounced) y pantalla de apertura.
3. Prueba de upgrade: cargar un proyecto v1 con un binario v2 debe fallar con mensaje claro (el rechazo ya existe en `desdeDocumento`).
