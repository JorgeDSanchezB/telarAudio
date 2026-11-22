# AGENTS.md — Guía para agentes de IA (y humanos) que trabajan en Telar Audio

Plataforma web de **postproducción de audio para narración en español**: motor de procesamiento no lineal basado en **DAG**, UI de nodos visuales (React Flow) y editor de línea de tiempo. Cliente Next.js 16 (procesamiento ligero en el navegador) + backend opcional FastAPI (nodos pesados: FFmpeg, Whisper).

**Idioma**: todo en español — interfaz, comentarios, nombres de dominio (`camelCase` español), documentación y mensajes de error de usuario.

---

## El LISTÓN (principios no negociables)

El proyecto se rige por un estándar interno llamado **LISTÓN**. Antes de tocar código, asúmelo:

1. **Cero hardcoding.** Cada límite, URL, tamaño, catálogo y valor por defecto vive en `packages/app/src/config/esquema.ts` (zod, `strictObject`) + `packages/app/src/config/config.default.json`, validado al arrancar. Las claves desconocidas se **rechazan**, no se ignoran. Si necesitas una constante configurable, añádela al esquema y al JSON **a la vez**.
2. **Honestidad epistémica.** Se distingue siempre: campo opcional ausente ≠ valor nulo (`PARAM_NULO`) ≠ dato inválido ≠ error temporal ≠ de configuración ≠ de autorización ≠ fallo crítico. El README mantiene una tabla de «qué está implementado y qué no»: actualízala con cada cambio; no afirmes nada que no puedas verificar.
3. **Errores tipados, nunca silenciados.** Sin `try/catch` que tragan, sin `alert()`, sin valores por defecto que oculten fallos. Todo fallo tiene `codigo`, `categoria`, `mensaje`, `mensajeUsuario` accionable y `reintentable` (ADR-014). Un nodo que falla queda en `error` y bloquea solo a sus dependientes: **el grafo no se tumba**.
4. **Estados honestos en la UI.** Los CTA deshabilitados explican la razón; la validación fallida se ve en el lienzo; los mensajes dicen qué hacer a continuación.
5. **Motor sin dependencias.** `packages/motor` no importa nada externo. Los nodos se registran desde fuera sin tocar el núcleo (ADR-006).
6. **CSS plano con tokens.** Nada de Tailwind ni librerías de estilos: la identidad vive en `packages/ui/src/estilos/telar.css` (ADR-012) y los contrastes texto/fondo se verifican (AA/AAA) con `scripts/contraste.js`.
7. **TypeScript estricto, sin ESLint.** `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. La calidad se garantiza con `npm run tipos` + pruebas + revisión (ADR-013). No añadas linters/formateadores sin un ADR nuevo.

---

## Comandos

```bash
# Cliente (raíz del monorepo)
npm install            # una vez
npm run dev            # http://localhost:3000 (Next 16 / Turbopack)
npm run build          # build de producción
npm start              # sirve el build
npm test               # 91 pruebas vitest (motor, nodos, línea de tiempo)
npm run tipos          # tsc --noEmit de los 4 paquetes TS
npm run verificar      # tipos + pruebas + build (pásalo antes de dar por terminado algo)
npm run preparar:ffmpeg  # copia ffmpeg.wasm (~31 MB) a public/ffmpeg (MP3 y rescate de formatos)

# Backend opcional (nodos pesados: limpieza de ruido, transcripción, transcodificación)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
python3 -m pytest tests/   # 23 pruebas (las de FFmpeg real se saltan solas si no hay binario)
```

Requisitos: Node ≥ 20.19, npm ≥ 10, Chrome de escritorio; backend con Python 3.11+ y FFmpeg de sistema.

**Antes de considerar terminado un cambio**: `npm run verificar` en verde y `pytest` del backend si lo tocaste. Actualiza la tabla de estado del `README.md` y, si introduce una decisión nueva, escribe un ADR en `docs/decisions/`.

---

## Arquitectura del monorepo (npm workspaces)

```
packages/
├── motor/          # Núcleo DAG, SIN dependencias: grafo, contratos (tipoDato v1.1),
│                   # registro de nodos, planificador, caché selectiva, errores tipados
├── nodos/          # Nodos incluidos (fuente, fusión, ganancia, limpieza-ruido,
│                   # transcripción, muletillas, tensión, SFX, música) + lógica pura en nucleo/
├── linea-tiempo/   # Dominio del editor: operaciones puras validadas + historial undo/redo
├── ui/             # Presentación React: lienzo React Flow, paleta, inspector, editor
│                   # de línea de tiempo. Estilos: src/estilos/telar.css (CSS plano)
└── app/            # Next.js 16: estado (zustand), servicios/adaptadores, configuración
backend/            # FastAPI opcional: trabajos con progreso, RFC 7807, rate limit
docs/               # arquitectura/, api/contratos.md, decisions/ (ADRs), pending/
scripts/            # preparar-ffmpeg.mjs, contraste.js
```

**Dirección de dependencias**: `motor` ← `nodos` ← `ui` ← `app`. `linea-tiempo` es dominio puro consumido por `ui`/`app`. `app` ensambla todo (estado global en `src/estado/almacen.ts`, adaptadores en `src/servicios/`).

### Cómo añadir un nodo (flujo canónico)

Guía completa con ejemplo en `docs/arquitectura/04-insercion-extensible.md`. Resumen:

1. Implementa la interfaz `AudioProcessor` (contrato en `packages/motor/src/contratos/nodos.ts`): declara entradas/salidas con `tipoDato` (se validan al conectar), parámetros con defaults, y modos de fallo tipados.
2. Lógica pesada → función pura en `packages/nodos/src/nucleo/` (fácil de probar); el archivo del nodo en `src/nodos/` la orquesta.
3. Regístralo en el registro (`packages/motor/src/registro/RegistroNodos.ts` consume los registros que exporta `packages/nodos`) — el núcleo no cambia.
4. Si el nodo necesita catálogos o límites (umbral, ruta, tamaño), van al `esquema.ts` + `config.default.json`, nunca inline.
5. Pruebas del procesador en `packages/nodos/src/nodos/*.test.ts`; datos de prueba pequeños y sintéticos (WAV generado en código).

### Cómo fluye la ejecución

`Motor.ts` calcula los nodos **necesarios** (cierre transitivo de dependencias, podando ramas desactivadas), ejecuta en paralelo con `maxConcurrencia`, cachea resultados por hash de entradas+parámetros (invalidación por rama desde el inspector), y aísla fallos por nodo.

### Backend: protocolo

- La app llama al backend a través de la ruta `/backend` de su propio origen (Next la redirige a `127.0.0.1:8000`; ver `packages/app/next.config.ts`). Cambiar destino → `backend.url` en `config.default.json`.
- Capacidades anunciadas en `GET /api/v1/salud` (`limpieza`, `transcripcion`, `transcodificar`, modelos Whisper disponibles). El cliente degrada con honestidad: sin backend, esos nodos fallan con `BACKEND_NO_DISPONIBLE` y el mensaje incluye el comando exacto para arrancarlo.
- Todos los errores backend salen como `application/problem+json` (RFC 7807) con `codigo`, `categoria`, `reintentable`. El cliente traduce a la misma taxonomía del motor (tabla en `docs/api/contratos.md`).
- Configuración backend: variables con prefijo `TELAR_` o `backend/.env` (ver `backend/app/config.py`).
- **Modelos Whisper y `.rnnn` NO se commitean**: se colocan en `backend/modelos/` (está en `.gitignore`; instrucciones de descarga en el README).

### Subida de audio resistente

Al subir un archivo: 1) decodifica el navegador; si falla → 2) rescate. El rescate elige orden según lo disponible: **backend local primero si ya está verificado** (subida pequeña + FFmpeg real), **ffmpeg.wasm primero si no hay backend** (offline; primera vez descarga ~32 MB con límite de tiempo `ffmpegMp3.timeoutCargaMs`); el otro como respaldo. Si ni FFmpeg puede leerlo, `AUDIO_NO_DECODIFICABLE` es definitivo (archivo corrupto). Todo en `packages/app/src/estado/almacen.ts` (`rescatarAWav`), con avisos al usuario en cada etapa.

**Detalle crítico de la UI de nodos**: los nodos que se pasan a React Flow son controlados; la selección para borrado (tecla Suprimir/Retroceso) debe reflejarse en el campo `selected` de cada nodo y mantenerse en `LienzoNodos` (`seleccionFlujo`), o cada re-render la pierde y la tecla deja de funcionar.

---

## Qué NO se hace

- No commitear `backend/modelos/` (78 MB), `packages/app/public/ffmpeg/` (regenerable con `npm run preparar:ffmpeg`), `node_modules/`, `.next/`, `backend/.venv/`, `backend/datos/` — todos fuera del repo vía `.gitignore`.
- No hardcodear valores ni añadir dependencias a `packages/motor`.
- No silenciar errores ni usar `alert()`/`confirm()`.
- No afirmar «implementado» en el README sin verificación: lo no implementado se documenta en `docs/pending/` con contrato y plan (p. ej. persistencia OPFS).
- No tocar el esquema de config sin actualizar `config.default.json` a la vez (el `strictObject` romperá el arranque con claves huérfanas).
- No añadir librerías de estilos, estado o UI sin un ADR que lo justifique.

## Convenciones de código

- TypeScript estricto en los 4 paquetes; `npm run tipos` debe pasar siempre.
- Pruebas junto al código (`*.test.ts`, vitest). El motor y las operaciones puras tienen cobertura de comportamiento; la UI se verifica en navegador (así se hizo: cada nodo verificado E2E).
- Comentarios y docstrings en español, orientados al *porqué*.
- Commits en español, imperativo, con alcance claro (p. ej. «nodos: invalidar caché al revisar muletillas»).
- Decisiones con impacto: ADR nuevo en `docs/decisions/` (problema, decisión, coste, alternativa descartada).
