"""Endpoints de la capacidad "transcodificar" (protocolo de trabajos).

Ruta de rescate para grabaciones cuyo códec el navegador no decodifica
(AMR, 3gp, WMA, ALAC…): FFmpeg las convierte a WAV PCM. El cliente la usa
automáticamente cuando decodeAudioData falla al subir un archivo.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..config import Ajustes
from ..ffmpeg import ParametrosTranscodificar
from ..limitador import LimitadorTasa
from ..trabajos import GestorTrabajos
from .capacidad import crear_router_capacidad


def crear_router_transcodificar(
    ajustes: Ajustes,
    gestor: GestorTrabajos,
    limitador: LimitadorTasa,
) -> APIRouter:
    return crear_router_capacidad(
        ajustes=ajustes,
        gestor=gestor,
        limitador=limitador,
        prefijo="transcodificar",
        desde_dict=ParametrosTranscodificar.desde_dict,
        nombre_resultado="transcodificado.wav",
    )
