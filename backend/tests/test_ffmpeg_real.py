"""Integración REAL con FFmpeg: genera una narración sintética (tono + ruido),
la procesa a través del endpoint completo y verifica el WAV resultante.

Se salta automáticamente si no hay binario ffmpeg/ffprobe en el sistema
(pytest.skip): así el mismo archivo sirve en entornos con y sin FFmpeg.
"""

from __future__ import annotations

import io
import math
import random
import time
import shutil
import struct
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Ajustes
from app.main import crear_app

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe no están disponibles en este entorno",
)

TASA = 48_000


def generar_narracion_ruidosa(duracion_s: float = 1.5) -> bytes:
    """Tono de 220 Hz (voz sintética) + ruido blanco moderado."""
    buffer = io.BytesIO()
    generador = random.Random(42)
    with wave.open(buffer, "wb") as archivo:
        archivo.setnchannels(1)
        archivo.setsampwidth(2)
        archivo.setframerate(TASA)
        for i in range(int(duracion_s * TASA)):
            tono = 0.25 * math.sin(2 * math.pi * 220 * (i / TASA))
            ruido = generador.uniform(-0.12, 0.12)
            muestra = max(-1.0, min(1.0, tono + ruido))
            archivo.writeframes(struct.pack("<h", int(muestra * 32767)))
    return buffer.getvalue()


def leer_wav(datos: bytes) -> tuple[int, int, int]:
    with wave.open(io.BytesIO(datos)) as archivo:
        return archivo.getframerate(), archivo.getnchannels(), archivo.getnframes()


def test_limpieza_real_con_ffmpeg(tmp_path: Path) -> None:
    ajustes = Ajustes(dir_datos=tmp_path / "datos")
    with TestClient(crear_app(ajustes=ajustes)) as cliente:
        entrada = generar_narracion_ruidosa()
        creacion = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "media", "filtro": "afftdn"}'},
            files={"archivo": ("narracion-ruidosa.wav", entrada, "audio/wav")},
        )
        assert creacion.status_code == 202, creacion.text
        id_trabajo = creacion.json()["id"]

        estado_final = None
        for _ in range(120):
            estado = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}").json()
            estado_final = estado
            if estado["estado"] in ("completado", "error"):
                break
            time.sleep(0.05)
        assert estado_final is not None and estado_final["estado"] == "completado", estado_final
        assert estado_final.get("progreso") == 100

        resultado = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}/resultado")
        assert resultado.status_code == 200
        assert resultado.headers["content-type"].startswith("audio/wav")

        tasa, canales, tramas = leer_wav(resultado.content)
        assert tasa == ajustes.tasa_salida_hz
        assert canales == ajustes.canales_salida
        # La duración resultante coincide (±0.1 s) con la de entrada.
        duracion_entrada = len(entrada) / (2 * TASA)
        assert abs(tramas / tasa - duracion_entrada) < 0.1


def test_filtro_arnndn_sin_modelo_da_409_configuracion(tmp_path: Path) -> None:
    ajustes = Ajustes(dir_datos=tmp_path / "datos", ruta_modelo_arnndn=tmp_path / "no-existe.rnnn")
    with TestClient(crear_app(ajustes=ajustes)) as cliente:
        creacion = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "media", "filtro": "arnndn"}'},
            files={"archivo": ("a.wav", generar_narracion_ruidosa(0.2), "audio/wav")},
        )
        assert creacion.status_code == 202
        id_trabajo = creacion.json()["id"]
        for _ in range(120):
            estado = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}").json()
            if estado["estado"] in ("completado", "error"):
                break
            time.sleep(0.05)
        assert estado["estado"] == "error"
        assert estado["error"]["codigo"] == "MODELO_RNNOISE_AUSENTE"
        assert estado["error"]["categoria"] == "configuracion"


def test_transcodificar_real_remesa_y_conserva_canales(tmp_path: Path) -> None:
    """Rescate real: WAV estéreo 44.1 kHz -> WAV 48 kHz conservando estéreo."""
    ajustes = Ajustes(dir_datos=tmp_path / "datos")
    with TestClient(crear_app(ajustes=ajustes)) as cliente:
        # Entrada estéreo a 44.1 kHz (tasa distinta de la de salida a propósito).
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as archivo:
            archivo.setnchannels(2)
            archivo.setsampwidth(2)
            archivo.setframerate(44_100)
            for i in range(44_100 // 2):
                archivo.writeframes(struct.pack("<hh", 8000, -8000))
        entrada = buffer.getvalue()

        creacion = cliente.post(
            "/api/v1/transcodificar/trabajos",
            data={"parametros": "{}"},
            files={"archivo": ("estereo-44k.wav", entrada, "audio/wav")},
        )
        assert creacion.status_code == 202, creacion.text
        id_trabajo = creacion.json()["id"]

        estado_final = None
        for _ in range(120):
            estado = cliente.get(f"/api/v1/transcodificar/trabajos/{id_trabajo}").json()
            estado_final = estado
            if estado["estado"] in ("completado", "error"):
                break
            time.sleep(0.05)
        assert estado_final is not None and estado_final["estado"] == "completado", estado_final

        resultado = cliente.get(f"/api/v1/transcodificar/trabajos/{id_trabajo}/resultado")
        assert resultado.status_code == 200
        tasa, canales, tramas = leer_wav(resultado.content)
        assert tasa == 48_000
        assert canales == 2  # la transcodificación NO fuerza mono
        assert abs(tramas / tasa - 0.5) < 0.05
