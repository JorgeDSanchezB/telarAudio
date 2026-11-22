"""Endpoint de salud y capacidades del backend (el cliente lo usa para
decidir si los nodos pesados están disponibles)."""

from __future__ import annotations

import shutil

from fastapi import APIRouter, Request

from ..config import Ajustes
from ..ffmpeg import ServicioLimpiezaRuido
from ..whisper import ServicioTranscripcion


def crear_router_salud(
    ajustes: Ajustes,
    servicio: ServicioLimpiezaRuido,
    servicio_transcripcion: ServicioTranscripcion | None = None,
) -> APIRouter:
    # Router LOCAL (no compartido a nivel de módulo): cada app de prueba
    # registra su propio handler con sus propios servicios; uno compartido
    # haría ganar siempre al primero registrado (el del import, con ajustes
    # por defecto).
    router = APIRouter(prefix="/api/v1", tags=["salud"])

    @router.get("/salud")
    async def salud(_: Request) -> dict:
        cuerpo = {
            "estado": "ok",
            "version": ajustes.version,
            "capacidades": ["limpieza-ruido", "transcodificar", "transcripcion"],
            "ffmpeg_disponible": shutil.which(ajustes.ffmpeg_binario) is not None,
            "modelo_arnndn_disponible": servicio.modelo_arnndn_disponible(),
        }
        if servicio_transcripcion is not None:
            cuerpo["modelos_whisper"] = servicio_transcripcion.modelos_disponibles()
        return cuerpo

    return router
