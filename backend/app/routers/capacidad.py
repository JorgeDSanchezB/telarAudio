"""Factoría de router de capacidad (protocolo de trabajos de un nodo pesado).

El protocolo es idéntico para toda capacidad (limpieza-ruido, transcodificar,
y las futuras): POST /trabajos, GET /trabajos (paginado), GET /trabajos/{id},
GET /trabajos/{id}/resultado, DELETE /trabajos/{id}. Esta factoría lo
implementa una vez; cada capacidad solo aporta prefijo, parser de parámetros
y nombre de archivo de resultado. Contrato completo en docs/api/contratos.md.
"""

from __future__ import annotations

import json
from collections.abc import Callable

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from ..config import Ajustes
from ..limitador import LimitadorTasa
from ..problemas import ErrorNegocio
from ..trabajos import GestorTrabajos


def crear_router_capacidad(
    *,
    ajustes: Ajustes,
    gestor: GestorTrabajos,
    limitador: LimitadorTasa,
    prefijo: str,
    desde_dict: Callable[[dict], object],
    nombre_resultado: str,
    media_type: str = "audio/wav",
) -> APIRouter:
    router = APIRouter(prefix=f"/api/v1/{prefijo}", tags=[prefijo])

    @router.post("/trabajos", status_code=202)
    async def crear_trabajo(
        request: Request,
        archivo: UploadFile = File(...),
        parametros: str = Form(...),
    ) -> JSONResponse:
        permitido, espera = limitador.permitir(request.client.host if request.client else "local")
        if not permitido:
            raise ErrorNegocio(
                429,
                "Demasiadas peticiones",
                "Límite de tasa alcanzado; espera unos segundos.",
                "LIMITE_TASA",
                "temporal",
                reintentable=True,
                retry_after=espera,
            )

        try:
            valores = json.loads(parametros)
            if not isinstance(valores, dict):
                raise ValueError("parametros debe ser un objeto JSON")
        except ValueError as error:
            raise ErrorNegocio(
                422,
                "Parámetros inválidos",
                f"El campo parametros debe ser JSON válido: {error}",
                "PARAMETROS_INVALIDOS",
                "validacion",
            ) from error
        parametros_capacidad = desde_dict(valores)

        datos = bytearray()
        while True:
            fragmento = await archivo.read(1024 * 1024)
            if not fragmento:
                break
            datos.extend(fragmento)
            if len(datos) > ajustes.max_bytes_subida:
                raise ErrorNegocio(
                    413,
                    "Archivo demasiado grande",
                    f"El archivo supera el máximo de {ajustes.max_bytes_subida} bytes configurado en el backend.",
                    "ARCHIVO_GRANDE",
                    "validacion",
                )
        if len(datos) == 0:
            raise ErrorNegocio(
                422,
                "Archivo vacío",
                "El archivo subido está vacío.",
                "ARCHIVO_VACIO",
                "validacion",
            )

        trabajo = await gestor.crear(bytes(datos), parametros_capacidad)
        return JSONResponse(
            status_code=202,
            content={
                "id": trabajo.id,
                "estado": trabajo.estado,
                "enlaces": {
                    "self": f"/api/v1/{prefijo}/trabajos/{trabajo.id}",
                    "resultado": f"/api/v1/{prefijo}/trabajos/{trabajo.id}/resultado",
                },
            },
            headers={"Location": f"/api/v1/{prefijo}/trabajos/{trabajo.id}"},
        )

    @router.get("/trabajos")
    async def listar_trabajos(
        limit: int = Query(default=None, ge=1, le=None),
        cursor: str | None = Query(default=None),
    ) -> dict:
        limite_efectivo = min(limit or ajustes.limite_defecto_pagina, ajustes.max_limite_pagina)
        pagina, siguiente = gestor.listar(limite_efectivo, cursor)
        cuerpo = {"items": [trabajo.vista_publica() for trabajo in pagina]}
        if siguiente is not None:
            cuerpo["siguiente_cursor"] = siguiente
        return cuerpo

    @router.get("/trabajos/{id_trabajo}")
    async def estado_trabajo(id_trabajo: str) -> dict:
        trabajo = gestor.obtener(id_trabajo)
        if trabajo is None:
            raise ErrorNegocio(
                404,
                "Trabajo no encontrado",
                f"No existe el trabajo {id_trabajo}.",
                "TRABAJO_NO_ENCONTRADO",
                "validacion",
            )
        return trabajo.vista_publica()

    @router.get("/trabajos/{id_trabajo}/resultado")
    async def resultado_trabajo(id_trabajo: str) -> FileResponse:
        trabajo = gestor.obtener(id_trabajo)
        if trabajo is None:
            raise ErrorNegocio(
                404,
                "Trabajo no encontrado",
                f"No existe el trabajo {id_trabajo}.",
                "TRABAJO_NO_ENCONTRADO",
                "validacion",
            )
        if trabajo.estado != "completado" or trabajo.salida is None or not trabajo.salida.is_file():
            raise ErrorNegocio(
                409,
                "Resultado no disponible",
                f"El trabajo está en estado {trabajo.estado}; el resultado solo existe al completarse.",
                "RESULTADO_NO_LISTO",
                "temporal",
                reintentable=True,
            )
        return FileResponse(trabajo.salida, media_type=media_type, filename=nombre_resultado)

    @router.delete("/trabajos/{id_trabajo}", status_code=204)
    async def cancelar_trabajo(id_trabajo: str) -> JSONResponse:
        trabajo = gestor.obtener(id_trabajo)
        if trabajo is None:
            raise ErrorNegocio(
                404,
                "Trabajo no encontrado",
                f"No existe el trabajo {id_trabajo}.",
                "TRABAJO_NO_ENCONTRADO",
                "validacion",
            )
        gestor.cancelar(id_trabajo)
        return JSONResponse(status_code=204, content=None)

    return router
