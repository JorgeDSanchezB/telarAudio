# Backend opcional de Telar Audio

Nodos pesados (hoy: **limpieza de ruido con FFmpeg**) para el estudio Telar. Servicio **local** (127.0.0.1): el audio no sale de tu equipo. Sin base de datos: los trabajos son efímeros con TTL.

## Arranque

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```

Salud y capacidades: `GET http://127.0.0.1:8000/api/v1/salud`. Contrato HTTP completo: `../docs/api/contratos.md`.

## Requisitos

- Python 3.11+ (verificado con 3.12).
- `ffmpeg` y `ffprobe` en el PATH (verificado con FFmpeg 7.1). Para el filtro `arnndn` (RNNoise), coloca un modelo `.rnnn` en `modelos/std.rnnn` (p. ej. de [rnnoise-models](https://github.com/GregorR/rnnoise-models)); `afftdn` funciona sin nada.

## Configuración (cero hardcoding)

Variables con prefijo `TELAR_` o archivo `.env` (ver `app/config.py`): límites de subida (`TELAR_MAX_BYTES_SUBIDA`, 200 MB), límites de tasa (`TELAR_CAPACIDAD_TASA`, `TELAR_RECARGA_TASA_POR_MINUTO`), paginación (`TELAR_MAX_LIMITE_PAGINA`), concurrencia (`TELAR_TRABAJOS_SIMULTANEOS`), TTL (`TELAR_TTL_TRABAJOS_HORAS`), mapeo intensidad→parámetros del filtro (`TELAR_AFFTDN_POR_INTENSIDAD`, JSON), rutas de binarios y modelo, orígenes CORS.

## Pruebas

```bash
python3 -m pytest tests/
```

`tests/test_ffmpeg_real.py` hace la **integración real** (subir narración sintética → limpiar → verificar WAV resultante) y se salta solo si falta el binario de FFmpeg.
