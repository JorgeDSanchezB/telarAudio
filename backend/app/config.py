"""Ajustes del backend opcional de Telar (pydantic-settings).

Cero hardcoding: todos los límites, rutas y mapeos viven aquí y se pueden
sobrescribir con variables de entorno con prefijo TELAR_ (p. ej.
TELAR_MAX_BYTES_SUBIDA) o con un archivo .env. Se validan al arrancar.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INTENSIDADES = ("ligera", "media", "fuerte")
FILTROS = ("afftdn", "arnndn")


class Ajustes(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TELAR_", env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # servidor
    host: str = "127.0.0.1"
    puerto: int = Field(default=8000, ge=1, le=65535)
    version: str = "0.1.0"
    origenes_cors: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"]
    )

    # límites (regla de escalabilidad y tolerancia)
    max_bytes_subida: int = Field(default=200 * 1024 * 1024, ge=1)
    capacidad_tasa: int = Field(default=20, ge=1)
    recarga_tasa_por_minuto: float = Field(default=30.0, gt=0)
    limite_defecto_pagina: int = Field(default=20, ge=1)
    max_limite_pagina: int = Field(default=100, ge=1)
    trabajos_simultaneos: int = Field(default=2, ge=1)
    ttl_trabajos_horas: float = Field(default=2.0, gt=0)

    # almacenamiento de trabajo
    dir_datos: Path = Path("datos")

    # ffmpeg
    ffmpeg_binario: str = "ffmpeg"
    ffprobe_binario: str = "ffprobe"
    ruta_modelo_arnndn: Path = Path("modelos/std.rnnn")
    tasa_salida_hz: int = Field(default=48_000, ge=8_000, le=384_000)
    canales_salida: int = Field(default=1, ge=1, le=2)

    # transcripción (faster-whisper)
    dir_modelos_whisper: Path = Path("modelos")
    whisper_compute_type: str = "int8"
    transcripcion_bloque_s: float = Field(default=300.0, gt=10.0, le=3_600.0)
    """Mapeo intensidad -> parámetros del filtro afftdn (negociable por entorno)."""
    afftdn_por_intensidad: dict[str, dict[str, float]] = Field(
        default_factory=lambda: {
            "ligera": {"nr": 12, "nf": -26},
            "media": {"nr": 20, "nf": -30},
            "fuerte": {"nr": 31, "nf": -35},
        }
    )

    @field_validator("afftdn_por_intensidad")
    @classmethod
    def _validar_mapeo(cls, valor: dict[str, dict[str, float]]) -> dict[str, dict[str, float]]:
        faltantes = [i for i in INTENSIDADES if i not in valor]
        if faltantes:
            raise ValueError(f"afftdn_por_intensidad debe definir las intensidades {faltantes}")
        for intensidad, parametros in valor.items():
            if intensidad not in INTENSIDADES:
                raise ValueError(f"intensidad desconocida: {intensidad}")
            if "nr" not in parametros or "nf" not in parametros:
                raise ValueError(f"la intensidad {intensidad} necesita nr y nf")
            if not (1 <= float(parametros["nr"]) <= 97):
                raise ValueError(f"nr de {intensidad} debe estar entre 1 y 97")
            if not (-80 <= float(parametros["nf"]) <= -20):
                raise ValueError(f"nf de {intensidad} debe estar entre -80 y -20")
        return valor
