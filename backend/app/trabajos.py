"""Gestor de trabajos: crea, ejecuta (con límite de concurrencia), consulta,
lista con paginación por cursor, cancela y limpia trabajos vencidos.

Persistencia: en memoria y archivos temporales bajo dir_datos. Es un backend
local de procesamiento efímero: los resultados los descarga el cliente y los
trabajos caducan por TTL. No hay base de datos a propósito (ADR-004);
docs/pending/ recoge la persistencia real si algún día hace falta.
"""

from __future__ import annotations

import asyncio
import base64
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .config import Ajustes
from .problemas import ErrorNegocio

ESTADOS_TERMINALES = ("completado", "error", "cancelado")


@dataclass
class Trabajo:
    id: str
    estado: str = "pendiente"
    progreso: float | None = None
    mensaje: str | None = None
    creado_en: float = field(default_factory=time.time)
    actualizado_en: float = field(default_factory=time.time)
    error: dict | None = None
    entrada: Path | None = None
    salida: Path | None = None

    def vista_publica(self) -> dict:
        cuerpo = {
            "id": self.id,
            "estado": self.estado,
            "creado_en": datetime.fromtimestamp(self.creado_en, tz=timezone.utc).isoformat(),
            "actualizado_en": datetime.fromtimestamp(self.actualizado_en, tz=timezone.utc).isoformat(),
        }
        if self.progreso is not None:
            cuerpo["progreso"] = round(self.progreso * 100)
        if self.mensaje is not None:
            cuerpo["mensaje"] = self.mensaje
        if self.error is not None:
            cuerpo["error"] = self.error
        return cuerpo


class GestorTrabajos:
    """Un gestor por capacidad: comparte el protocolo pero aísla colas y TTL."""

    def __init__(self, ajustes: Ajustes, servicio) -> None:  # noqa: ANN001 - servicio con procesar()
        self.ajustes = ajustes
        self.servicio = servicio
        self.trabajos: dict[str, Trabajo] = {}
        self._tareas: dict[str, asyncio.Task] = {}
        self._semaforo = asyncio.Semaphore(ajustes.trabajos_simultaneos)
        self._dir_trabajos = ajustes.dir_datos / "trabajos"
        self._dir_trabajos.mkdir(parents=True, exist_ok=True)
    # ------------------------------------------------------------ ciclo

    async def crear(self, datos: bytes, parametros: object) -> Trabajo:
        id_trabajo = uuid.uuid4().hex
        carpeta = self._dir_trabajos / id_trabajo
        carpeta.mkdir(parents=True, exist_ok=True)
        entrada = carpeta / "entrada"
        # La capacidad decide el nombre del artefacto de salida (WAV o JSON).
        salida = carpeta / self.servicio.nombre_salida  # type: ignore[attr-defined]
        entrada.write_bytes(datos)
        trabajo = Trabajo(id=id_trabajo, entrada=entrada, salida=salida)
        self.trabajos[id_trabajo] = trabajo
        self._tareas[id_trabajo] = asyncio.create_task(self._ejecutar(trabajo, parametros))
        return trabajo

    async def _ejecutar(self, trabajo: Trabajo, parametros: object) -> None:
        cancelado = asyncio.Event()

        def _marcar_cancelado() -> None:
            cancelado.set()

        tarea_actual = asyncio.current_task()
        assert trabajo.salida is not None and trabajo.entrada is not None
        try:
            async with self._semaforo:
                trabajo.estado = "en_progreso"
                trabajo.mensaje = "Procesando con FFmpeg…"
                trabajo.actualizado_en = time.time()

                def reportar(fraccion: float, mensaje: str) -> None:
                    trabajo.progreso = max(0.0, min(1.0, fraccion))
                    trabajo.mensaje = mensaje
                    trabajo.actualizado_en = time.time()

                assert tarea_actual is not None
                tarea_actual.add_done_callback(lambda t: _marcar_cancelado() if t.cancelled() else None)
                await self.servicio.procesar(trabajo.entrada, trabajo.salida, parametros, reportar, cancelado)
                trabajo.estado = "completado"
                trabajo.progreso = 1.0
                trabajo.mensaje = "Completado"
                trabajo.actualizado_en = time.time()
        except asyncio.CancelledError:
            trabajo.estado = "cancelado"
            trabajo.mensaje = "Cancelado"
            trabajo.actualizado_en = time.time()
        except ErrorNegocio as error:
            trabajo.estado = "error"
            trabajo.error = {
                "title": error.titulo,
                "detail": error.detalle,
                "codigo": error.codigo,
                "categoria": error.categoria,
                "reintentable": error.reintentable,
            }
            trabajo.mensaje = error.titulo
            trabajo.actualizado_en = time.time()
        except Exception as error:  # noqa: BLE001 - fallo crítico tipificado
            print(f"[Telar backend] Fallo inesperado en trabajo {trabajo.id}: {type(error).__name__}: {error}")
            trabajo.estado = "error"
            trabajo.error = {
                "title": "Fallo inesperado",
                "detail": "El procesamiento falló de forma inesperada. Consulta la consola del backend.",
                "codigo": "FALLO_INESPERADO",
                "categoria": "critico",
                "reintentable": True,
            }
            trabajo.actualizado_en = time.time()

    # -------------------------------------------------------- consultas

    def obtener(self, id_trabajo: str) -> Trabajo | None:
        return self.trabajos.get(id_trabajo)

    def listar(self, limite: int, cursor: str | None) -> tuple[list[Trabajo], str | None]:
        """Paginación keyset por (creado_en, id), de más reciente a más antiguo."""
        trabajos = sorted(self.trabajos.values(), key=lambda t: (t.creado_en, t.id), reverse=True)
        if cursor is not None:
            punto = self._decodificar_cursor(cursor)
            trabajos = [t for t in trabajos if (t.creado_en, t.id) < punto]
        pagina = trabajos[:limite]
        siguiente = None
        if len(trabajos) > limite and pagina:
            ultimo = pagina[-1]
            siguiente = self._codificar_cursor(ultimo.creado_en, ultimo.id)
        return pagina, siguiente

    @staticmethod
    def _codificar_cursor(creado_en: float, id_trabajo: str) -> str:
        # repr de float es la representación más corta con round-trip exacto:
        # nunca redondea, así el ítem frontera no puede repetirse en la
        # página siguiente.
        crudo = f"{creado_en!r}|{id_trabajo}".encode("utf-8")
        return base64.urlsafe_b64encode(crudo).decode("ascii")

    @staticmethod
    def _decodificar_cursor(cursor: str) -> tuple[float, str]:
        try:
            crudo = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
            creado_en, id_trabajo = crudo.split("|", 1)
            return float(creado_en), id_trabajo
        except (ValueError, UnicodeDecodeError) as error:
            raise ErrorNegocio(
                422,
                "Cursor inválido",
                "El cursor de paginación no es válido; empieza de nuevo sin cursor.",
                "CURSOR_INVALIDO",
                "validacion",
            ) from error

    # ------------------------------------------------------ operaciones

    def cancelar(self, id_trabajo: str) -> bool:
        """Cancela si sigue vivo; devuelve False si ya es terminal."""
        trabajo = self.trabajos.get(id_trabajo)
        if trabajo is None:
            return False
        if trabajo.estado in ESTADOS_TERMINALES:
            return False
        tarea = self._tareas.get(id_trabajo)
        if tarea is not None and not tarea.done():
            tarea.cancel()
        else:
            trabajo.estado = "cancelado"
            trabajo.actualizado_en = time.time()
        return True

    def limpiar_vencidos(self) -> int:
        """Elimina trabajos terminales cuyo TTL venció (y sus archivos)."""
        ahora = time.time()
        vencidos = [
            trabajo
            for trabajo in self.trabajos.values()
            if trabajo.estado in ESTADOS_TERMINALES
            and ahora - trabajo.actualizado_en > self.ajustes.ttl_trabajos_horas * 3600
        ]
        for trabajo in vencidos:
            self.trabajos.pop(trabajo.id, None)
            self._tareas.pop(trabajo.id, None)
            carpeta = self._dir_trabajos / trabajo.id
            if carpeta.is_dir():
                for archivo in carpeta.iterdir():
                    archivo.unlink(missing_ok=True)
                carpeta.rmdir()
        return len(vencidos)
