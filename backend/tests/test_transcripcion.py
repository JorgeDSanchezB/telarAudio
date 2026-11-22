"""Pruebas de la capacidad "transcripcion": protocolo de trabajos con
resultado JSON, validación de parámetros, fallos tipificados y salud con
modelos disponibles. La transcripción REAL con modelo descargado vive al
final y se salta si no hay modelo en backend/modelos/.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Ajustes
from app.main import crear_app
from app.problemas import ErrorNegocio
from app.whisper import ParametrosTranscripcion


class ServicioTranscripcionFalso:
    """Servicio determinista: devuelve una transcripcion/v1 mínima."""

    nombre_salida = "salida.json"

    def __init__(self, fallo: ErrorNegocio | None = None) -> None:
        self.fallo = fallo
        self.llamadas: list[ParametrosTranscripcion] = []

    def modelos_disponibles(self) -> list[str]:
        return []

    async def procesar(self, entrada: Path, salida: Path, parametros, reportar, cancelado) -> None:  # noqa: ANN001
        self.llamadas.append(parametros)
        if self.fallo is not None:
            raise self.fallo
        reportar(0.4, "transcribiendo (falso)")
        salida.write_text(
            json.dumps(
                {
                    "tipoDato": "transcripcion/v1",
                    "idioma": parametros.idioma,
                    "modelo": parametros.modelo,
                    "duracionMs": 1500,
                    "segmentos": [
                        {
                            "inicioMs": 0,
                            "finMs": 1500,
                            "texto": "La noche caía.",
                            "palabras": [
                                {"palabra": "La", "inicioMs": 0, "finMs": 300},
                                {"palabra": "noche", "inicioMs": 300, "finMs": 800},
                                {"palabra": "caía.", "inicioMs": 800, "finMs": 1500},
                            ],
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )


def cliente_transcripcion(ajustes: Ajustes, servicio=None) -> TestClient:
    aplicacion = crear_app(
        ajustes=ajustes,
        servicio_transcripcion=servicio or ServicioTranscripcionFalso(),
    )
    return TestClient(aplicacion)


def ajustes_prueba(tmp_path: Path) -> Ajustes:
    return Ajustes(dir_datos=tmp_path / "datos", dir_modelos_whisper=tmp_path / "modelos")


# ------------------------------------------------------------ parámetros


def test_parametros_validan_modelo_e_idioma() -> None:
    parametros = ParametrosTranscripcion.desde_dict({"modelo": "tiny", "idioma": "es"})
    assert parametros.a_dict() == {"modelo": "tiny", "idioma": "es"}
    assert ParametrosTranscripcion.desde_dict({}).a_dict() == {"modelo": "small", "idioma": "es"}
    with pytest.raises(ErrorNegocio) as error:
        ParametrosTranscripcion.desde_dict({"modelo": "gigante"})
    assert error.value.codigo == "PARAMETROS_INVALIDOS"
    with pytest.raises(ErrorNegocio):
        ParametrosTranscripcion.desde_dict({"idioma": "1x"})


# --------------------------------------------------------------- protocolo


def test_transcripcion_ciclo_completo(tmp_path: Path) -> None:
    cliente = cliente_transcripcion(ajustes_prueba(tmp_path))
    respuesta = cliente.post(
        "/api/v1/transcripcion/trabajos",
        files={"archivo": ("relato.wav", b"RIFF-falso", "audio/wav")},
        data={"parametros": json.dumps({"modelo": "tiny", "idioma": "es"})},
    )
    assert respuesta.status_code == 202
    id_trabajo = respuesta.json()["id"]

    estado = cliente.get(f"/api/v1/transcripcion/trabajos/{id_trabajo}").json()
    assert estado["estado"] in ("pendiente", "en_progreso", "completado")

    for _ in range(50):
        estado = cliente.get(f"/api/v1/transcripcion/trabajos/{id_trabajo}").json()
        if estado["estado"] == "completado":
            break
    assert estado["estado"] == "completado"

    resultado = cliente.get(f"/api/v1/transcripcion/trabajos/{id_trabajo}/resultado")
    assert resultado.status_code == 200
    assert resultado.headers["content-type"].startswith("application/json")
    documento = resultado.json()
    assert documento["tipoDato"] == "transcripcion/v1"
    assert documento["segmentos"][0]["palabras"][0]["palabra"] == "La"


def test_transcripcion_parametros_invalidos_rechazados(tmp_path: Path) -> None:
    cliente = cliente_transcripcion(ajustes_prueba(tmp_path))
    respuesta = cliente.post(
        "/api/v1/transcripcion/trabajos",
        files={"archivo": ("relato.wav", b"RIFF", "audio/wav")},
        data={"parametros": "no-json"},
    )
    assert respuesta.status_code == 422
    assert respuesta.json()["codigo"] == "PARAMETROS_INVALIDOS"


def test_transcripcion_error_de_servicio_tipificado(tmp_path: Path) -> None:
    servicio = ServicioTranscripcionFalso(
        fallo=ErrorNegocio(
            422, "Audio sin voz", "No se detectó voz.", "AUDIO_SIN_VOZ", "validacion"
        )
    )
    cliente = cliente_transcripcion(ajustes_prueba(tmp_path), servicio)
    respuesta = cliente.post(
        "/api/v1/transcripcion/trabajos",
        files={"archivo": ("silencio.wav", b"RIFF", "audio/wav")},
        data={"parametros": json.dumps({"modelo": "tiny"})},
    )
    id_trabajo = respuesta.json()["id"]
    for _ in range(50):
        estado = cliente.get(f"/api/v1/transcripcion/trabajos/{id_trabajo}").json()
        if estado["estado"] == "error":
            break
    assert estado["estado"] == "error"
    assert estado["error"]["codigo"] == "AUDIO_SIN_VOZ"
    assert estado["error"]["categoria"] == "validacion"


def test_salud_reporta_modelos_whisper(tmp_path: Path) -> None:
    cliente = cliente_transcripcion(ajustes_prueba(tmp_path))
    cuerpo = cliente.get("/api/v1/salud").json()
    assert "transcripcion" in cuerpo["capacidades"]
    assert cuerpo["modelos_whisper"] == []  # tmp_path no tiene modelos


# ------------------------------------------------- integración con modelo

RAIZ = Path(__file__).resolve().parent.parent
MODELOS_DIR = RAIZ / "modelos"
MODELO_REAL = next(
    (m for m in ("tiny", "base", "small") if (MODELOS_DIR / f"whisper-{m}" / "model.bin").is_file()),
    None,
)


@pytest.mark.skipif(MODELO_REAL is None, reason="sin modelos whisper descargados")
def test_transcripcion_real_con_voz(tmp_path: Path) -> None:
    """Genera voz sintética (espeak-ng si existe) y transcribe de verdad."""
    import shutil
    import subprocess

    if shutil.which("espeak-ng") is None:
        pytest.skip("espeak-ng no disponible")
    proceso = subprocess.run(
        [
            "espeak-ng", "-v", "es", "-s", "140", "-w", str(tmp_path / "voz.wav"),
            "La noche caía sobre el pueblo.",
        ],
        capture_output=True,
    )
    assert proceso.returncode == 0

    ajustes = ajustes_prueba(tmp_path)
    # El modelo real vive en el directorio del repo, no en tmp_path.
    ajustes.dir_modelos_whisper = MODELOS_DIR
    cliente = cliente_transcripcion(ajustes)
    respuesta = cliente.post(
        "/api/v1/transcripcion/trabajos",
        files={"archivo": ("voz.wav", (tmp_path / "voz.wav").read_bytes(), "audio/wav")},
        data={"parametros": json.dumps({"modelo": MODELO_REAL, "idioma": "es"})},
    )
    id_trabajo = respuesta.json()["id"]
    for _ in range(200):
        estado = cliente.get(f"/api/v1/transcripcion/trabajos/{id_trabajo}").json()
        if estado["estado"] in ("completado", "error"):
            break
        import time

        time.sleep(0.1)
    assert estado["estado"] == "completado", estado
    documento = cliente.get(f"/api/v1/transcripcion/trabajos/{id_trabajo}/resultado").json()
    assert documento["tipoDato"] == "transcripcion/v1"
    assert len(documento["segmentos"]) >= 1
    assert len(documento["segmentos"][0]["palabras"]) >= 3
