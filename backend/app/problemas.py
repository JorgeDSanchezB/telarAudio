"""Errores de negocio y respuestas RFC 7807 (Problem Details).

El cliente traduce los campos `codigo` y `categoria` a sus errores tipados
(ver docs/api/contratos-backend.md, tabla de mapeo).
"""

from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as HTTPExceptionEstrella


class ErrorNegocio(Exception):
    """Error tipado del backend; se serializa como problem+json."""

    def __init__(
        self,
        status: int,
        titulo: str,
        detalle: str,
        codigo: str,
        categoria: str,
        reintentable: bool = False,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(detalle)
        self.status = status
        self.titulo = titulo
        self.detalle = detalle
        self.codigo = codigo
        self.categoria = categoria
        self.reintentable = reintentable
        self.retry_after = retry_after

    def cuerpo(self) -> dict:
        cuerpo = {
            "type": "about:blank",
            "title": self.titulo,
            "status": self.status,
            "detail": self.detalle,
            "codigo": self.codigo,
            "categoria": self.categoria,
            "reintentable": self.reintentable,
        }
        if self.retry_after is not None:
            cuerpo["retry_after"] = self.retry_after
        return cuerpo


def respuesta_problema(
    status: int,
    titulo: str,
    detalle: str,
    codigo: str,
    categoria: str,
    reintentable: bool = False,
    retry_after: float | None = None,
) -> JSONResponse:
    error = ErrorNegocio(status, titulo, detalle, codigo, categoria, reintentable, retry_after)
    cabeceras = {}
    if retry_after is not None:
        cabeceras["Retry-After"] = str(max(1, round(retry_after)))
    return JSONResponse(status_code=status, content=error.cuerpo(), media_type="application/problem+json", headers=cabeceras)


def registrar_manejadores(aplicacion) -> None:  # noqa: ANN001 - FastAPI
    @aplicacion.exception_handler(ErrorNegocio)
    async def _manejar_error_negocio(_: Request, error: ErrorNegocio) -> JSONResponse:
        cabeceras = {}
        if error.retry_after is not None:
            cabeceras["Retry-After"] = str(max(1, round(error.retry_after)))
        return JSONResponse(
            status_code=error.status,
            content=error.cuerpo(),
            media_type="application/problem+json",
            headers=cabeceras,
        )

    @aplicacion.exception_handler(RequestValidationError)
    async def _manejar_validacion(_: Request, error: RequestValidationError) -> JSONResponse:
        detalle = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in error.errors())
        return respuesta_problema(
            422,
            "Datos inválidos",
            detalle or "La petición no superó la validación.",
            "DATOS_INVALIDOS",
            "validacion",
        )

    @aplicacion.exception_handler(HTTPExceptionEstrella)
    async def _manejar_http(_: Request, error: HTTPExceptionEstrella) -> JSONResponse:
        return respuesta_problema(
            error.status_code,
            "Error HTTP",
            str(error.detail),
            "ERROR_HTTP",
            "temporal" if error.status_code >= 500 else "validacion",
        )

    @aplicacion.exception_handler(Exception)
    async def _manejar_critico(_: Request, error: Exception) -> JSONResponse:
        # Nunca se filtran internos al cliente: se registran y se responde genérico.
        print(f"[Telar backend] Fallo crítico no controlado: {type(error).__name__}: {error}")
        return respuesta_problema(
            500,
            "Error interno",
            "El backend falló de forma inesperada. Consulta la consola del servidor.",
            "FALLO_INTERNO",
            "critico",
        )
