"""Procesamiento con FFmpeg (nodos pesados del backend).

Reutiliza el enfoque del proyecto `limpiadorAudio` (FFmpeg como motor de
procesamiento):
  - limpieza de ruido: afftdn (incluido en FFmpeg, sin modelo externo) o
    arnndn (red neuronal RNNoise; requiere un modelo .rnnn);
  - transcodificación de rescate: convierte a WAV PCM cualquier formato que
    el navegador no sabe decodificar (AMR, 3gp, WMA, ALAC…).

El audio de salida es WAV PCM 16 bits, 48 kHz (narración): decisión
documentada en docs/decisions/ADR-004-arquitectura-hibrida.md.
"""

from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from .config import Ajustes
from .problemas import ErrorNegocio


async def duracion_segundos(binario_ffprobe: str, ruta: Path) -> float | None:
    """Duración del archivo según ffprobe (None si no se puede saber)."""
    binario = shutil.which(binario_ffprobe)
    if not binario:
        return None
    try:
        proceso = await asyncio.create_subprocess_exec(
            binario,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(ruta),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        salida, _ = await proceso.communicate()
        datos = json.loads(salida.decode("utf-8", errors="replace"))
        return float(datos["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError, OSError):
        return None


# --------------------------------------------------------------- limpieza


@dataclass
class ParametrosLimpieza:
    intensidad: str
    filtro: str

    @staticmethod
    def desde_dict(valores: dict) -> "ParametrosLimpieza":
        intensidad = valores.get("intensidad")
        filtro = valores.get("filtro", "afftdn")
        if intensidad not in ("ligera", "media", "fuerte"):
            raise ErrorNegocio(
                422,
                "Parámetro inválido",
                "intensidad debe ser una de: ligera, media, fuerte.",
                "INTENSIDAD_INVALIDA",
                "validacion",
            )
        if filtro not in ("afftdn", "arnndn"):
            raise ErrorNegocio(
                422,
                "Parámetro inválido",
                "filtro debe ser affftn o arnndn.",
                "FILTRO_INVALIDO",
                "validacion",
            )
        return ParametrosLimpieza(intensidad=intensidad, filtro=filtro)


class ServicioLimpiezaRuido:
    nombre_salida = "salida.wav"

    def __init__(self, ajustes: Ajustes) -> None:
        self.ajustes = ajustes

    def disponible(self) -> bool:
        return shutil.which(self.ajustes.ffmpeg_binario) is not None

    def modelo_arnndn_disponible(self) -> bool:
        return self.ajustes.ruta_modelo_arnndn.is_file()

    async def procesar(
        self,
        ruta_entrada: Path,
        ruta_salida: Path,
        parametros: ParametrosLimpieza,
        reportar_progreso: "callable",  # noqa: F722 - (fraccion 0..1, mensaje)
        cancelado: asyncio.Event,
    ) -> None:
        if not self.disponible():
            raise ErrorNegocio(
                500,
                "FFmpeg no disponible",
                f"No se encontró el binario {self.ajustes.ffmpeg_binario} en el sistema.",
                "FFMPEG_AUSENTE",
                "configuracion",
            )

        if parametros.filtro == "arnndn":
            if not self.modelo_arnndn_disponible():
                raise ErrorNegocio(
                    409,
                    "Modelo RNNoise ausente",
                    f"El filtro arnndn necesita un modelo en {self.ajustes.ruta_modelo_arnndn}. "
                    "Descarga uno (p. ej. de github.com/GregorR/rnnoise-models) y colócalo ahí, o usa afftdn.",
                    "MODELO_RNNOISE_AUSENTE",
                    "configuracion",
                )
            modelo = self.ajustes.ruta_modelo_arnndn.resolve()
            cadena_filtro = f"arnndn=m={modelo}"
        else:
            configuracion = self.ajustes.afftdn_por_intensidad[parametros.intensidad]
            cadena_filtro = f"afftdn=nr={configuracion['nr']:g}:nf={configuracion['nf']:g}"

        await _ejecutar_ffmpeg_wav(
            ajustes=self.ajustes,
            ruta_entrada=ruta_entrada,
            ruta_salida=ruta_salida,
            cadena_filtro=cadena_filtro,
            forzar_mono=True,
            reportar_progreso=reportar_progreso,
            cancelado=cancelado,
            mensaje="Reduciendo ruido con FFmpeg…",
        )


# -------------------------------------------------------- transcodificación


@dataclass
class ParametrosTranscodificar:
    """Sin opciones: siempre a WAV PCM 16 bits a la tasa configurada,
    conservando los canales originales (el navegador ya remuestrea al decodificar)."""

    @staticmethod
    def desde_dict(valores: dict) -> "ParametrosTranscodificar":
        desconocidas = set(valores) - set()
        if desconocidas:
            raise ErrorNegocio(
                422,
                "Parámetros inválidos",
                f"transcodificar no admite parámetros; recibió: {sorted(desconocidas)}.",
                "PARAMETROS_INVALIDOS",
                "validacion",
            )
        return ParametrosTranscodificar()


class ServicioTranscodificacion:
    nombre_salida = "salida.wav"

    """Convierte a WAV cualquier formato de audio/vídeo que FFmpeg sepa leer.

    Es la ruta de rescate para grabaciones cuyo códec el navegador no
    decodifica (AMR de grabadoras, 3gp de mensajeros, WMA, ALAC…): el cliente
    la usa solo cuando decodeAudioData falla.
    """

    def __init__(self, ajustes: Ajustes) -> None:
        self.ajustes = ajustes

    def disponible(self) -> bool:
        return shutil.which(self.ajustes.ffmpeg_binario) is not None

    async def procesar(
        self,
        ruta_entrada: Path,
        ruta_salida: Path,
        _parametros: ParametrosTranscodificar,
        reportar_progreso: "callable",  # noqa: F722 - (fraccion 0..1, mensaje)
        cancelado: asyncio.Event,
    ) -> None:
        await _ejecutar_ffmpeg_wav(
            ajustes=self.ajustes,
            ruta_entrada=ruta_entrada,
            ruta_salida=ruta_salida,
            cadena_filtro=None,
            forzar_mono=False,
            reportar_progreso=reportar_progreso,
            cancelado=cancelado,
            mensaje="Transcodificando con FFmpeg…",
        )


# ------------------------------------------------------------- común


async def _ejecutar_ffmpeg_wav(
    ajustes: Ajustes,
    ruta_entrada: Path,
    ruta_salida: Path,
    cadena_filtro: str | None,
    forzar_mono: bool,
    reportar_progreso: "callable",  # noqa: F722
    cancelado: asyncio.Event,
    mensaje: str,
) -> None:
    """Ejecuta FFmpeg hacia WAV PCM 16 bits con progreso y cancelación."""
    if shutil.which(ajustes.ffmpeg_binario) is None:
        raise ErrorNegocio(
            500,
            "FFmpeg no disponible",
            f"No se encontró el binario {ajustes.ffmpeg_binario} en el sistema.",
            "FFMPEG_AUSENTE",
            "configuracion",
        )

    argumentos = [
        ajustes.ffmpeg_binario,
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i",
        str(ruta_entrada),
    ]
    if cadena_filtro:
        argumentos += ["-af", cadena_filtro]
    argumentos += [
        "-vn",
        "-ar",
        str(ajustes.tasa_salida_hz),
    ]
    if forzar_mono:
        argumentos += ["-ac", str(ajustes.canales_salida)]
    argumentos += [
        "-c:a",
        "pcm_s16le",
        "-progress",
        "pipe:1",
        "-nostats",
        str(ruta_salida),
    ]

    duracion = await duracion_segundos(ajustes.ffprobe_binario, ruta_entrada)
    proceso = await asyncio.create_subprocess_exec(
        *argumentos,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        assert proceso.stdout is not None
        while True:
            if cancelado.is_set():
                proceso.kill()
                raise asyncio.CancelledError()
            linea = await proceso.stdout.readline()
            if not linea:
                break
            texto = linea.decode("utf-8", errors="replace").strip()
            if texto.startswith("out_time_us=") and duracion:
                microsegundos = int(texto.split("=", 1)[1])
                reportar_progreso(
                    min(0.99, microsegundos / 1_000_000 / duracion),
                    mensaje,
                )
        stderr = await proceso.stderr.read() if proceso.stderr else b""
        codigo = await proceso.wait()
        if cancelado.is_set():
            raise asyncio.CancelledError()
        if codigo != 0:
            cola = stderr.decode("utf-8", errors="replace")[-400:].replace("\n", " | ")
            raise ErrorNegocio(
                500,
                "FFmpeg falló",
                f"FFmpeg terminó con código {codigo}. Cola de error: {cola}",
                "FFMPEG_FALLO",
                "temporal",
                reintentable=True,
            )
        reportar_progreso(1.0, "Listo")
    except asyncio.CancelledError:
        try:
            proceso.kill()
        except ProcessLookupError:
            pass
        raise
