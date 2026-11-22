"""Aplicación FastAPI del backend opcional de Telar Audio.

Arranque (desde la carpeta backend/):
    python3 -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app.main:app --port 8000

Fábrica `crear_app` para inyectar ajustes y servicio en las pruebas.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Ajustes
from .ffmpeg import ServicioLimpiezaRuido, ServicioTranscodificacion
from .limitador import LimitadorTasa
from .problemas import registrar_manejadores
from .routers.ruido import crear_router_ruido
from .routers.salud import crear_router_salud
from .routers.transcodificar import crear_router_transcodificar
from .routers.transcripcion import crear_router_transcripcion
from .trabajos import GestorTrabajos
from .whisper import ServicioTranscripcion


async def _bucle_limpieza(gestor: GestorTrabajos) -> None:
    while True:
        await asyncio.sleep(60)
        gestor.limpiar_vencidos()


def crear_app(
    ajustes: Ajustes | None = None,
    servicio=None,
    servicio_transcodificar=None,
    servicio_transcripcion=None,
) -> FastAPI:
    ajustes = ajustes or Ajustes()
    servicio = servicio or ServicioLimpiezaRuido(ajustes)
    servicio_transcodificar = servicio_transcodificar or ServicioTranscodificacion(ajustes)
    servicio_transcripcion = servicio_transcripcion or ServicioTranscripcion(ajustes)

    gestor = GestorTrabajos(ajustes, servicio)
    gestor_transcodificar = GestorTrabajos(ajustes, servicio_transcodificar)
    gestor_transcripcion = GestorTrabajos(ajustes, servicio_transcripcion)
    limitador = LimitadorTasa(ajustes.capacidad_tasa, ajustes.recarga_tasa_por_minuto)

    @contextlib.asynccontextmanager
    async def _ciclo_vida(aplicacion: FastAPI) -> AsyncIterator[None]:
        tarea_limpieza = asyncio.create_task(_bucle_limpieza(gestor))
        tarea_limpieza_transcodificar = asyncio.create_task(_bucle_limpieza(gestor_transcodificar))
        tarea_limpieza_transcripcion = asyncio.create_task(_bucle_limpieza(gestor_transcripcion))
        yield
        tarea_limpieza.cancel()
        tarea_limpieza_transcodificar.cancel()
        tarea_limpieza_transcripcion.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await tarea_limpieza
            await tarea_limpieza_transcodificar
            await tarea_limpieza_transcripcion

    aplicacion = FastAPI(
        title="Telar Audio — backend opcional",
        version=ajustes.version,
        description="Nodos pesados (limpieza de ruido y transcodificación con FFmpeg) para el "
        "estudio Telar. Procesamiento local: el audio nunca sale de la máquina.",
        lifespan=_ciclo_vida,
    )

    aplicacion.add_middleware(
        CORSMiddleware,
        allow_origins=ajustes.origenes_cors,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    registrar_manejadores(aplicacion)
    aplicacion.include_router(crear_router_salud(ajustes, servicio, servicio_transcripcion))
    aplicacion.include_router(crear_router_ruido(ajustes, gestor, limitador))
    aplicacion.include_router(crear_router_transcodificar(ajustes, gestor_transcodificar, limitador))
    aplicacion.include_router(crear_router_transcripcion(ajustes, gestor_transcripcion, limitador))

    return aplicacion


app = crear_app()
