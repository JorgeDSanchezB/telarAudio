"""Pruebas del backend: salud, ciclo de vida de trabajos (con servicio falso),
validaciones, límite de tasa, paginación por cursor y errores RFC 7807.

La integración REAL con FFmpeg (presente en el entorno de desarrollo) vive en
test_ffmpeg_real.py y se salta automáticamente si no hay binario.
"""

from __future__ import annotations

import asyncio
import io
import time
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Ajustes
from app.ffmpeg import ParametrosLimpieza
from app.main import crear_app
from app.problemas import ErrorNegocio


class ServicioFalso:
    """Servicio de limpieza determinista para pruebas sin FFmpeg."""

    nombre_salida = "salida.wav"

    def __init__(self, demora: float = 0.0, fallo: ErrorNegocio | None = None) -> None:
        self.demora = demora
        self.fallo = fallo
        self.llamadas: list[ParametrosLimpieza] = []

    def modelo_arnndn_disponible(self) -> bool:
        return False

    async def procesar(self, entrada: Path, salida: Path, parametros, reportar, cancelado) -> None:  # noqa: ANN001
        self.llamadas.append(parametros)
        if self.fallo is not None:
            raise self.fallo
        if self.demora:
            await asyncio.sleep(self.demora)
        reportar(0.5, "procesando (falso)")
        salida.write_bytes(b"RIFF-falso")


def generar_wav(duracion_s: float = 0.2, tasa: int = 48_000) -> bytes:
    """WAV mono con silencio, generado con la biblioteca estándar."""
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as archivo:
        archivo.setnchannels(1)
        archivo.setsampwidth(2)
        archivo.setframerate(tasa)
        archivo.writeframes(b"\x00\x00" * int(duracion_s * tasa))
    return buffer.getvalue()


@pytest.fixture()
def ajustes(tmp_path: Path) -> Ajustes:
    return Ajustes(
        dir_datos=tmp_path / "datos",
        max_bytes_subida=1024 * 1024,
        capacidad_tasa=100,
        ttl_trabajos_horas=1.0,
    )


@pytest.fixture()
def cliente(ajustes: Ajustes) -> TestClient:
    aplicacion = crear_app(ajustes=ajustes, servicio=ServicioFalso())
    return TestClient(aplicacion)


# ------------------------------------------------------------------ salud


def test_salud_reporta_capacidades(cliente: TestClient) -> None:
    respuesta = cliente.get("/api/v1/salud")
    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["estado"] == "ok"
    assert "limpieza-ruido" in cuerpo["capacidades"]
    assert isinstance(cuerpo["ffmpeg_disponible"], bool)


# ------------------------------------------------------- ciclo de vida


def test_ciclo_completo_de_trabajo(cliente: TestClient) -> None:
    creacion = cliente.post(
        "/api/v1/limpieza-ruido/trabajos",
        data={"parametros": '{"intensidad": "media", "filtro": "afftdn"}'},
        files={"archivo": ("narracion.wav", generar_wav(), "audio/wav")},
    )
    assert creacion.status_code == 202
    cuerpo = creacion.json()
    assert cuerpo["estado"] == "pendiente"
    assert cuerpo["enlaces"]["resultado"].endswith("/resultado")

    estado = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{cuerpo['id']}")
    assert estado.status_code == 200
    assert estado.json()["estado"] in ("pendiente", "en_progreso", "completado")


def test_trabajo_lento_pasa_por_en_progreso_y_completado(ajustes: Ajustes) -> None:
    aplicacion = crear_app(ajustes=ajustes, servicio=ServicioFalso(demora=0.2))
    with TestClient(aplicacion) as cliente:
        id_trabajo = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "ligera"}'},
            files={"archivo": ("a.wav", generar_wav(), "audio/wav")},
        ).json()["id"]

        vistos: list[str] = []
        for _ in range(100):
            estado = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}").json()
            vistos.append(estado["estado"])
            if estado["estado"] == "completado":
                break
            time.sleep(0.02)
        assert "completado" in vistos

        resultado = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}/resultado")
        assert resultado.status_code == 200
        assert resultado.headers["content-type"].startswith("audio/wav")
        assert resultado.content == b"RIFF-falso"


def test_resultado_409_si_no_completado(ajustes: Ajustes) -> None:
    aplicacion = crear_app(ajustes=ajustes, servicio=ServicioFalso(demora=5.0))
    with TestClient(aplicacion) as cliente:
        id_trabajo = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "ligera"}'},
            files={"archivo": ("a.wav", generar_wav(), "audio/wav")},
        ).json()["id"]
        respuesta = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}/resultado")
        assert respuesta.status_code == 409
        assert respuesta.headers["content-type"] == "application/problem+json"
        cuerpo = respuesta.json()
        assert cuerpo["codigo"] == "RESULTADO_NO_LISTO"


def test_error_de_servicio_queda_tipificado_en_el_trabajo(ajustes: Ajustes) -> None:
    fallo = ErrorNegocio(
        500,
        "FFmpeg falló",
        "salida simulada",
        "FFMPEG_FALLO",
        "temporal",
        reintentable=True,
    )
    aplicacion = crear_app(ajustes=ajustes, servicio=ServicioFalso(fallo=fallo))
    with TestClient(aplicacion) as cliente:
        id_trabajo = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "media"}'},
            files={"archivo": ("a.wav", generar_wav(), "audio/wav")},
        ).json()["id"]
        for _ in range(100):
            estado = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}").json()
            if estado["estado"] in ("completado", "error"):
                break
            time.sleep(0.02)
        assert estado["estado"] == "error"
        assert estado["error"]["codigo"] == "FFMPEG_FALLO"
        assert estado["error"]["categoria"] == "temporal"


def test_cancelacion_deja_el_trabajo_en_cancelado(ajustes: Ajustes) -> None:
    aplicacion = crear_app(ajustes=ajustes, servicio=ServicioFalso(demora=5.0))
    with TestClient(aplicacion) as cliente:
        id_trabajo = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "media"}'},
            files={"archivo": ("a.wav", generar_wav(), "audio/wav")},
        ).json()["id"]
        borrado = cliente.delete(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}")
        assert borrado.status_code == 204
        for _ in range(100):
            estado = cliente.get(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}").json()
            if estado["estado"] == "cancelado":
                break
            time.sleep(0.02)
        assert estado["estado"] == "cancelado"
        # Cancelar dos veces es idempotente (204 sobre terminal).
        assert cliente.delete(f"/api/v1/limpieza-ruido/trabajos/{id_trabajo}").status_code == 204


# ------------------------------------------------------------ validación


def test_parametros_invalidos_dan_422_problem(cliente: TestClient) -> None:
    respuesta = cliente.post(
        "/api/v1/limpieza-ruido/trabajos",
        data={"parametros": "no-es-json"},
        files={"archivo": ("a.wav", generar_wav(), "audio/wav")},
    )
    assert respuesta.status_code == 422
    assert respuesta.headers["content-type"] == "application/problem+json"
    assert respuesta.json()["codigo"] == "PARAMETROS_INVALIDOS"

    respuesta = cliente.post(
        "/api/v1/limpieza-ruido/trabajos",
        data={"parametros": '{"intensidad": "brutal"}'},
        files={"archivo": ("a.wav", generar_wav(), "audio/wav")},
    )
    assert respuesta.status_code == 422
    assert respuesta.json()["codigo"] == "INTENSIDAD_INVALIDA"


def test_archivo_vacio_y_grande_dan_422_y_413(ajustes: Ajustes) -> None:
    ajustes.max_bytes_subida = 1024
    aplicacion = crear_app(ajustes=ajustes, servicio=ServicioFalso())
    with TestClient(aplicacion) as cliente:
        vacio = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "media"}'},
            files={"archivo": ("a.wav", b"", "audio/wav")},
        )
        assert vacio.status_code == 422
        assert vacio.json()["codigo"] == "ARCHIVO_VACIO"

        grande = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "media"}'},
            files={"archivo": ("a.wav", b"x" * 4096, "audio/wav")},
        )
        assert grande.status_code == 413
        assert grande.json()["codigo"] == "ARCHIVO_GRANDE"


def test_trabajo_inexistente_dan_404_problem(cliente: TestClient) -> None:
    respuesta = cliente.get("/api/v1/limpieza-ruido/trabajos/inexistente")
    assert respuesta.status_code == 404
    assert respuesta.json()["codigo"] == "TRABAJO_NO_ENCONTRADO"


# -------------------------------------------------------- límite de tasa


def test_limite_de_tasa_devuelve_429_con_retry_after(ajustes: Ajustes) -> None:
    ajustes.capacidad_tasa = 2
    ajustes.recarga_tasa_por_minuto = 0.001  # recarga despreciable en el test
    aplicacion = crear_app(ajustes=ajustes, servicio=ServicioFalso())
    with TestClient(aplicacion) as cliente:
        for _ in range(2):
            creacion = cliente.post(
                "/api/v1/limpieza-ruido/trabajos",
                data={"parametros": '{"intensidad": "media"}'},
                files={"archivo": ("a.wav", generar_wav(0.01), "audio/wav")},
            )
            assert creacion.status_code == 202
        tercera = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "media"}'},
            files={"archivo": ("a.wav", generar_wav(0.01), "audio/wav")},
        )
        assert tercera.status_code == 429
        assert tercera.json()["codigo"] == "LIMITE_TASA"
        assert "Retry-After" in tercera.headers


# ------------------------------------------------------------ paginación


def test_listado_pagina_con_cursor_estable(ajustes: Ajustes) -> None:
    aplicacion = crear_app(ajustes=ajustes, servicio=ServicioFalso())
    with TestClient(aplicacion) as cliente:
        for i in range(7):
            respuesta = cliente.post(
                "/api/v1/limpieza-ruido/trabajos",
                data={"parametros": '{"intensidad": "media"}'},
                files={"archivo": (f"a{i}.wav", generar_wav(0.01), "audio/wav")},
            )
            assert respuesta.status_code == 202

        ids_vistos: list[str] = []
        cursor: str | None = None
        while True:
            url = "/api/v1/limpieza-ruido/trabajos?limit=3"
            if cursor:
                url += f"&cursor={cursor}"
            pagina = cliente.get(url).json()
            ids_vistos.extend(item["id"] for item in pagina["items"])
            cursor = pagina.get("siguiente_cursor")
            if cursor is None:
                break
        assert len(ids_vistos) == 7
        assert len(set(ids_vistos)) == 7  # sin duplicados: cursor estable

        # El límite se acota al máximo configurado.
        pagina = cliente.get("/api/v1/limpieza-ruido/trabajos?limit=10000").json()
        assert len(pagina["items"]) <= ajustes.max_limite_pagina

        # Cursor corrupto: 422 problem.
        respuesta = cliente.get("/api/v1/limpieza-ruido/trabajos?cursor=@@@invalido@@@")
        assert respuesta.status_code == 422
        assert respuesta.json()["codigo"] == "CURSOR_INVALIDO"


# ------------------------------------------------------- transcodificar


class ServicioTranscodificarFalso:
    """Servicio de transcodificación determinista para pruebas sin FFmpeg."""

    nombre_salida = "salida.wav"

    def __init__(self, fallo: ErrorNegocio | None = None) -> None:
        self.fallo = fallo
        self.llamadas = 0

    async def procesar(self, entrada: Path, salida: Path, parametros, reportar, cancelado) -> None:  # noqa: ANN001
        self.llamadas += 1
        if self.fallo is not None:
            raise self.fallo
        reportar(0.3, "transcodificando (falso)")
        salida.write_bytes(b"RIFF-falso-transcodificado")


def cliente_transcodificar(ajustes: Ajustes, servicio=None) -> TestClient:
    aplicacion = crear_app(
        ajustes=ajustes,
        servicio=ServicioFalso(),
        servicio_transcodificar=servicio or ServicioTranscodificarFalso(),
    )
    return TestClient(aplicacion)


def test_transcodificar_crea_trabajo_y_devuelve_resultado(ajustes: Ajustes) -> None:
    with cliente_transcodificar(ajustes) as cliente:
        creacion = cliente.post(
            "/api/v1/transcodificar/trabajos",
            data={"parametros": "{}"},
            files={"archivo": ("grabacion.amr", b"\x00#!AMR", "audio/amr")},
        )
        assert creacion.status_code == 202, creacion.text
        cuerpo = creacion.json()
        assert cuerpo["estado"] == "pendiente"
        assert cuerpo["enlaces"]["resultado"].endswith(f"/trabajos/{cuerpo['id']}/resultado")

        estado_final = None
        for _ in range(120):
            estado = cliente.get(f"/api/v1/transcodificar/trabajos/{cuerpo['id']}").json()
            estado_final = estado
            if estado["estado"] in ("completado", "error"):
                break
            time.sleep(0.05)
        assert estado_final is not None and estado_final["estado"] == "completado", estado_final

        resultado = cliente.get(f"/api/v1/transcodificar/trabajos/{cuerpo['id']}/resultado")
        assert resultado.status_code == 200
        assert resultado.headers["content-type"].startswith("audio/wav")
        assert resultado.content == b"RIFF-falso-transcodificado"


def test_transcodificar_rechaza_parametros_desconocidos(ajustes: Ajustes) -> None:
    with cliente_transcodificar(ajustes) as cliente:
        respuesta = cliente.post(
            "/api/v1/transcodificar/trabajos",
            data={"parametros": '{"codec": "amr"}'},
            files={"archivo": ("grabacion.amr", b"\x00#!AMR", "audio/amr")},
        )
        assert respuesta.status_code == 422
        cuerpo = respuesta.json()
        assert cuerpo["codigo"] == "PARAMETROS_INVALIDOS"
        assert cuerpo["categoria"] == "validacion"


def test_transcodificar_aisla_sus_trabajos_de_limpieza(ajustes: Ajustes) -> None:
    """Cada capacidad tiene su propio gestor: los listados no se mezclan."""
    with cliente_transcodificar(ajustes) as cliente:
        creacion_ruido = cliente.post(
            "/api/v1/limpieza-ruido/trabajos",
            data={"parametros": '{"intensidad": "media"}'},
            files={"archivo": ("a.wav", generar_wav(0.01), "audio/wav")},
        )
        creacion_transcodificar = cliente.post(
            "/api/v1/transcodificar/trabajos",
            data={"parametros": "{}"},
            files={"archivo": ("b.amr", b"\x00#!AMR", "audio/amr")},
        )
        assert creacion_ruido.status_code == 202
        assert creacion_transcodificar.status_code == 202

        listado_ruido = cliente.get("/api/v1/limpieza-ruido/trabajos").json()
        listado_transcodificar = cliente.get("/api/v1/transcodificar/trabajos").json()
        ids_ruido = {item["id"] for item in listado_ruido["items"]}
        ids_transcodificar = {item["id"] for item in listado_transcodificar["items"]}
        assert ids_ruido.isdisjoint(ids_transcodificar)
