"""Endpoints de la capacidad "transcripcion" (protocolo de trabajos, resultado JSON).

Misma forma que limpieza-ruido (multipart → 202 → sondeo → resultado), pero el
artefacto de salida es transcripcion.json (transcripcion/v1) en vez de WAV.
Toda la maquinaria común vive en routers/capacidad.py.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..config import Ajustes
from ..limitador import LimitadorTasa
from ..trabajos import GestorTrabajos
from ..whisper import ParametrosTranscripcion, ServicioTranscripcion
from .capacidad import crear_router_capacidad


def crear_router_transcripcion(
    ajustes: Ajustes,
    gestor: GestorTrabajos,
    limitador: LimitadorTasa,
) -> APIRouter:
    return crear_router_capacidad(
        ajustes=ajustes,
        gestor=gestor,
        limitador=limitador,
        prefijo="transcripcion",
        desde_dict=ParametrosTranscripcion.desde_dict,
        nombre_resultado="transcripcion.json",
        media_type="application/json",
    )
