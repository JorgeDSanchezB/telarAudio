# Nodos y capacidades pendientes

**Estado: NO implementados.** Este directorio documenta lo que quedó fuera, con su motivo, su contrato previsto y su plan de reproducción. Ninguno de estos nodos está registrado en el catálogo de la aplicación: si apareciera alguno con estos nombres en una sesión, sería un error.

## Migrados ya (histórico de esta carpeta)

Los siguientes documentos describían nodos PENDIENTES y hoy están implementados y verificados (contrato v1.1 de puertos con `tipoDato`, pruebas en Node + backend, E2E en navegador con Whisper real):

| Nodo | Documento original | Estado |
| --- | --- | --- |
| `transcripcion-whisper` | `transcripcion-whisper.md` | Implementado (backend faster-whisper, bloques reanudables, word timestamps) |
| `eliminacion-muletillas` | `eliminacion-muletillas.md` | Implementado (catálogo en configuración, revisión en el inspector sin puertas) |
| `analisis-tension` | `analisis-tension.md` | Implementado v1 heurística (sin LLM, corregible arrastrando; LLM sigue pendiente de decisión) |
| `colocacion-sfx` | `colocacion-sfx.md` | Implementado (diccionario en configuración + 6 efectos sintéticos originales, colocaciones activables) |
| `asignacion-musica` | `asignacion-musica.md` | Implementado v1 (una pista de la biblioteca, ganancia por tensión, ducking por energía; selección de pista por banda queda como variante) |

Sus documentos se mantienen abajo con el sello **IMPLEMENTADO** como memoria del contrato.

## Sigue pendiente

| Pendiente | Motivo de no incluirlo ahora | Documento |
| --- | --- | --- |
| Persistencia OPFS/IndexedDB | La sesión vive en memoria por diseño en esta pasada | `persistencia-opfs.md` |
| Picos precalculados en Worker | Optimización para audios de varias horas (regla del «audio infinito») | `picos-worker.md` |
| Proyectos guardables (JSON + activos) | Derivado de la persistencia | dentro de `persistencia-opfs.md` |
| Tensión con LLM | Decisión de producto pendiente (proveedor/modelo vs heurística local) | `analisis-tension.md` (variante) |
| Demo narrativa completa | Falta un activo de narración de ejemplo y depende del backend (hoy la demo es la cadena simple) | `demo-narrativa.md` |

## Qué SÍ está listo para recibirlos (por diseño, sin tocar el núcleo)

- El tipo de puerto `dato` con subtipo validado (`DefinicionPuerto.tipoDato`, contrato v1.1): los nodos de análisis emiten `{tipo:'dato', idDato, tipoDato}` y el grafo rechaza conexiones de subtipos incompatibles.
- El almacén de datos de la sesión (`ServicioRegistroDatos`): registros, revisiones (misma ranura, nueva revisión) e invalidación selectiva de consumidores.
- El protocolo de trabajos del backend es genérico por capacidad: un nodo pesado nuevo solo añade su router y su `capacidadBackend` (la transcripción lo demuestra con resultado JSON en vez de WAV).
- La paleta, el inspector y la línea de tiempo se generan del registro: registrar la definición los hace aparecer.
