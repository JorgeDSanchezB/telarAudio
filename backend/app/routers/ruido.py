"""Endpoints de la capacidad "limpieza de ruido" (protocolo de trabajos).

Contrato completo en docs/api/contratos.md. Toda la maquinaria común vive en
routers/capacidad.py; aquí solo la configuración de esta capacidad.
"""

from __future__ import annotations

from fastapi import APIRouter

from ..config import Ajustes
from ..ffmpeg import ParametrosLimpieza
from ..limitador import LimitadorTasa
from ..trabajos import GestorTrabajos
from .capacidad import crear_router_capacidad


def crear_router_ruido(
    ajustes: Ajustes,
    gestor: GestorTrabajos,
    limitador: LimitadorTasa,
) -> APIRouter:
    return crear_router_capacidad(
        ajustes=ajustes,
        gestor=gestor,
        limitador=limitador,
        prefijo="limpieza-ruido",
        desde_dict=ParametrosLimpieza.desde_dict,
        nombre_resultado="limpieza-ruido.wav",
    )
