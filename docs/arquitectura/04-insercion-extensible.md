# Fase 4 — Lógica de inserción extensible

## El flujo de extensión completo

```
Registro de nodo → validación de contrato AudioProcessor → Motor DAG → UI de nodo → Línea de tiempo
```

Concretamente:

1. **El desarrollador registra el nodo** en el catálogo (`RegistroNodos.registrar`): un objeto `DefinicionNodo` (POD salvo `crearProcesador`).
2. **El registro valida el contrato** antes de aceptarlo: tipo (`^[a-z][a-z0-9-]*$`) único, versión semver, categoría y runtime válidos, puertos bien formados y sin claves repetidas, parámetros válidos con defectos dentro de rango, modos de fallo completos, fábrica ejecutable. Un contrato inválido no entra al motor (error `REGISTRO_*`).
3. **El motor lo reconoce sin cambios en su núcleo**: `@telar/motor` no importa nada de `@telar/nodos` (verificable: `rg "@telar/nodos" packages/motor/src` devuelve únicamente el comentario de documentación de `index.ts` que lo afirma; ningún import). El motor solo ve contratos.
4. **La UI lo ofrece sola**: la paleta itera `registro.listar()` y el inspector genera el formulario desde `EspecificacionParametro`. Ningún componente enumera tipos de nodo a mano.
5. **El usuario lo arrastra, conecta y configura**; el motor lo ejecuta solo si sus entradas están listas y su salida es necesaria para el objetivo.
6. **El resultado llega a la línea de tiempo** con «⇥ Enviar a línea de tiempo» (cualquier salida de audio, de cualquier nodo).

## Ejemplo completo: añadir un nodo «Normalización de loudness»

Reproducción del ejemplo de la especificación con un nodo NO incluido en el catálogo. Solo hay que crear UN archivo y registrar una línea.

```ts
// packages/nodos/src/nodos/loudness.ts  (nuevo archivo)
import type { DefinicionNodo } from '@telar/motor';
import { renderizarAActivo } from './util-render';

export function crearDefinicionLoudness(): DefinicionNodo {
  return {
    tipo: 'loudness',                    // nuevo tipo: nada que tocar en el motor
    version: '1.0.0',
    etiqueta: 'Normalización de loudness',
    descripcion: 'Ajusta el volumen percibido (LUFS) de una narración al nivel objetivo.',
    categoria: 'edicion',
    runtime: 'cliente',
    entradas: [{ clave: 'entrada', etiqueta: 'Audio', tipo: 'audio', requerida: true }],
    salidas: [{ clave: 'salida', etiqueta: 'Audio normalizado', tipo: 'audio' }],
    parametros: [
      { tipo: 'numero', clave: 'objetivoLufs', etiqueta: 'Objetivo', defecto: -16, min: -30, max: 0, paso: 0.5, unidad: 'LUFS' },
    ],
    modosDeFallo: [
      { codigo: 'LOUDNESS_SIN_ENTRADA', categoria: 'validacion', descripcion: 'Sin conexión de entrada.', reintentable: false },
    ],
    crearProcesador: () => ({
      ejecutar: async (entrada, contexto) => {
        // … medir LUFS integrado y aplicar la ganancia con renderizarAActivo …
        return { salidas: { salida: { tipo: 'audio', idActivo: '…' } } };
      },
    }),
  };
}
```

```ts
// packages/nodos/src/index.ts  (una línea nueva)
registro.registrar(crearDefinicionLoudness());
```

Con eso, el nodo aparece en la paleta bajo «Edición», su formulario se genera solo, se conecta, se ejecuta, se cachea y se puede enviar a la línea de tiempo. El test `Motor.test.ts › EXTENSIBILIDAD` demuestra el paso 3 registrando un nodo inventado dentro del propio test y ejecutándolo.

## Variante compatible vs comportamiento nuevo

- **Variante compatible** (nuevos datos, umbral, modelo, catálogo): solo definición + registro. Es el caso de una variante de limpieza con otro modelo RNNoise: mismo contrato, otro valor de parámetro o otra `capacidadBackend`.
- **Comportamiento nuevo** (p. ej. un nodo que emite `dato` en vez de `audio`, como el análisis de tensión): requiere código nuevo, pero **no en el núcleo**: el tipo de puerto `dato` ya existe en los contratos del motor para que esos nodos entren sin tocar `@telar/motor`.

## Control de la inserción (reglas de datos no confiables)

Toda entrada dinámica pasa por validación estricta antes de usarse:

| Control | Mecanismo | Límite |
| --- | --- | --- |
| Claves permitidas | `z.strictObject` en la configuración de la app (rechaza claves desconocidas, no las ignora); `validarValoresParametros` rechaza parámetros desconocidos (`PARAM_CLAVE_DESCONOCIDA`) | — |
| Tipos | Discriminación por unión en cada campo; sin coerciones silenciosas (un string «3» no se convierte en número) | — |
| Tamaño máximo | `max_bytes_subida` (backend, 413 al superarlo); límite RIFF de 4 GiB del codificador WAV | 200 MB por defecto (config.) |
| Profundidad / cantidad | `maxParametrosPorNodo`, `maxOpciones`, `MAX_PUERTOS`, `MAX_MODOS_FALLO` en el registro | 32 / 64 / 16 / 32 |
| Nombres peligrosos | Regex de tipo, clave de puerto, clave de parámetro y semver en el registro; regex de cursor en el backend | — |
| Datos sensibles | No se recogen: sin cuentas, sin telemetría; el audio no sale del equipo (backend en 127.0.0.1) | — |
| Versionado | `DefinicionNodo.version` (semver, parte de la clave de caché); `DocumentoGrafo.version` (rechazo explícito de versiones no soportadas); esquema de config validado al arranque | — |
| Desconocido/inválido | Error tipado y visible, nunca valor por defecto silencioso (salvo el caso legítimo de clave ausente → defecto declarado) | — |

## Por qué especificación POD y no zod/JSON Schema por nodo (ADR-008)

- **Problema que resuelve:** los contratos deben poder serializarse (proyectos guardados, UI dinámica, futuro envío de contrato al backend). zod es código, no dato.
- **Coste:** un validador pequeño propio (~120 líneas, probado) compartido por registro, inspector y motor.
- **Alternativa descartada:** zod embebido en cada nodo — obligaría a mantener dos fuentes de verdad (esquema + formulario) y rompería la serialización. zod SÍ se usa donde toca datos externos de verdad: la configuración de la app.

## Por qué un registro y no plugin-loading dinámico

El registro es un `Map` tipado con validación de entrada: cero indirección, cero carga dinámica de código (riesgo). Cargar nodos desde JSON de configuración habría exigido evaluar código desde datos: se descarta por seguridad; la extensión siempre es un import + una línea de registro en código versionado.
