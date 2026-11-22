"""Servicio de transcripción con faster-whisper (capacidad "transcripcion").

Migración del núcleo de `eliminaMuletillas/audio_processor.py` (Whisper con
word_timestamps) al protocolo de trabajos del backend: multipart → 202 →
sondeo → resultado JSON (no WAV).

Decisiones (docs/pending/transcripcion-whisper.md):
- El modelo se carga BAJO DEMANDA con caché LRU de 1 modelo (RAM acotada).
- El audio se decodifica UNA vez a float32 16 kHz y se transcribe por bloques
  reanudables (≤ transcripcion_bloque_s) con progreso por bloque; los
  timestamps de cada bloque se desplazan al tiempo absoluto del archivo.
- Idioma forzado (defecto "es") para velocidad y estabilidad.
- Fallos tipificados: MODELO_NO_DESCARGADO (config), AUDIO_SIN_VOZ (validacion),
  AUDIO_ILEGIBLE (validacion).
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from .config import Ajustes
from .problemas import ErrorNegocio

MODELOS_SOPORTADOS = ("tiny", "base", "small")
TASA_WHISPER_HZ = 16_000


class ParametrosTranscripcion:
    """Parámetros validados de la capacidad transcripcion (desde JSON del cliente)."""

    def __init__(self, modelo: str = "small", idioma: str = "es") -> None:
        self.modelo = modelo
        self.idioma = idioma

    @classmethod
    def desde_dict(cls, valores: dict) -> "ParametrosTranscripcion":
        modelo = valores.get("modelo", "small")
        idioma = valores.get("idioma", "es")
        if modelo not in MODELOS_SOPORTADOS:
            raise ErrorNegocio(
                422,
                "Modelo no soportado",
                f"modelo debe ser uno de {MODELOS_SOPORTADOS} (recibido: {modelo!r}).",
                "PARAMETROS_INVALIDOS",
                "validacion",
            )
        if not isinstance(idioma, str) or not (2 <= len(idioma) <= 5) or not idioma.isalpha():
            raise ErrorNegocio(
                422,
                "Idioma inválido",
                "idioma debe ser un código de 2 a 5 letras (p. ej. 'es').",
                "PARAMETROS_INVALIDOS",
                "validacion",
            )
        return cls(modelo=modelo, idioma=idioma.lower())

    def a_dict(self) -> dict:
        return {"modelo": self.modelo, "idioma": self.idioma}


class ServicioTranscripcion:
    """Transcribe audio a JSON transcripcion/v1 (segmentos con palabras)."""

    nombre_salida = "salida.json"

    def __init__(self, ajustes: Ajustes) -> None:
        self.ajustes = ajustes
        # Caché LRU de 1 modelo: cargar small tras tiny descarga el anterior.
        self._modelo_cargado: str | None = None
        self._instancia: object | None = None

    # ------------------------------------------------------------ modelos

    def ruta_modelo(self, modelo: str) -> Path:
        return self.ajustes.dir_modelos_whisper / f"whisper-{modelo}"

    def modelo_descargado(self, modelo: str) -> bool:
        ruta = self.ruta_modelo(modelo)
        return ruta.is_dir() and (ruta / "model.bin").is_file()

    def modelos_disponibles(self) -> list[str]:
        return [m for m in MODELOS_SOPORTADOS if self.modelo_descargado(m)]

    def _cargar_modelo(self, modelo: str):
        if self._instancia is not None and self._modelo_cargado == modelo:
            return self._instancia
        if not self.modelo_descargado(modelo):
            disponibles = self.modelos_disponibles() or ["ninguno"]
            raise ErrorNegocio(
                503,
                "Modelo no descargado",
                f"El modelo '{modelo}' no está en {self.ruta_modelo(modelo)}. "
                f"Descárgalo (ver README, sección Transcripción) o usa uno disponible: {', '.join(disponibles)}.",
                "MODELO_NO_DESCARGADO",
                "configuracion",
            )
        try:
            from faster_whisper import WhisperModel
        except ImportError as error:  # pragma: no cover - entorno sin dependencia
            raise ErrorNegocio(
                503,
                "faster-whisper no instalado",
                "El backend no tiene la dependencia faster-whisper. Instálala con: "
                "pip install -r requirements.txt",
                "WHISPER_NO_INSTALADO",
                "configuracion",
            ) from error
        try:
            instancia = WhisperModel(
                str(self.ruta_modelo(modelo)),
                device="cpu",
                compute_type=self.ajustes.whisper_compute_type,
            )
        except Exception as error:  # noqa: BLE001 - carga de modelo fallida, tipificada
            raise ErrorNegocio(
                500,
                "No se pudo cargar el modelo",
                f"El modelo '{modelo}' existe pero no se pudo cargar ({type(error).__name__}: {error}). "
                "Comprueba que los archivos del modelo estén completos.",
                "MODELO_CORRUPTO",
                "configuracion",
            ) from error
        self._instancia = instancia
        self._modelo_cargado = modelo
        return instancia

    # ------------------------------------------------------------ proceso

    async def procesar(self, entrada: Path, salida: Path, parametros, reportar, cancelado) -> None:  # noqa: ANN001
        """Transcribe `entrada` y escribe el JSON transcripcion/v1 en `salida`."""
        assert isinstance(parametros, ParametrosTranscripcion)
        modelo = self._cargar_modelo(parametros.modelo)
        reportar(0.05, f"Modelo {parametros.modelo} listo; decodificando audio…")

        bucle = asyncio.get_running_loop()
        try:
            audio = await bucle.run_in_executor(None, self._decodificar, str(entrada))
        except Exception as error:  # noqa: BLE001 - decodificación fallida, tipificada
            raise ErrorNegocio(
                422,
                "Audio ilegible",
                "El archivo enviado no es un audio/vídeo que FFmpeg sepa leer.",
                "AUDIO_ILEGIBLE",
                "validacion",
            ) from error

        if audio.ndim != 1 or audio.shape[0] < TASA_WHISPER_HZ:  # < 1 s de audio
            raise ErrorNegocio(
                422,
                "Audio sin voz",
                "El archivo dura menos de un segundo: no hay voz que transcribir.",
                "AUDIO_SIN_VOZ",
                "validacion",
            )

        duracion_s = audio.shape[0] / TASA_WHISPER_HZ
        bloque_s = self.ajustes.transcripcion_bloque_s
        bloques: list[tuple[float, float]] = []
        inicio = 0.0
        while inicio < duracion_s:
            fin = min(inicio + bloque_s, duracion_s)
            bloques.append((inicio, fin))
            inicio = fin

        segmentos_json: list[dict] = []
        palabras_totales = 0
        t0 = time.time()

        for indice, (desde_s, hasta_s) in enumerate(bloques):
            if cancelado.is_set():
                raise asyncio.CancelledError
            mensaje = (
                f"Transcribiendo bloque {indice + 1} de {len(bloques)} "
                f"(minuto {(desde_s / 60):.0f}–{(hasta_s / 60):.0f})…"
                if len(bloques) > 1
                else "Transcribiendo la voz…"
            )
            base = indice / len(bloques)
            reportar(0.1 + base * 0.85, mensaje)

            def progreso_segmento(fin_segmento: float, hasta: float = hasta_s, cota: float = base) -> None:
                dentro = max(0.0, min(1.0, fin_segmento / hasta)) if hasta > 0 else 1.0
                reportar(0.1 + (cota + dentro / len(bloques)) * 0.85, mensaje)

            rebanada = audio[int(desde_s * TASA_WHISPER_HZ) : int(hasta_s * TASA_WHISPER_HZ)]
            segmentos_bloque = await bucle.run_in_executor(
                None,
                lambda: self._transcribir_bloque(
                    modelo, rebanada, parametros.idioma, progreso_segmento
                ),
            )
            for segmento in segmentos_bloque:
                palabras = [
                    {
                        "palabra": palabra.word,
                        "inicioMs": round(desde_s * 1000 + palabra.start * 1000),
                        "finMs": round(desde_s * 1000 + palabra.end * 1000),
                    }
                    for palabra in (segmento.words or [])
                ]
                palabras_totales += len(palabras)
                segmentos_json.append(
                    {
                        "inicioMs": round(desde_s * 1000 + segmento.start * 1000),
                        "finMs": round(desde_s * 1000 + segmento.end * 1000),
                        "texto": segmento.text.strip(),
                        "palabras": palabras,
                    }
                )

        if palabras_totales == 0 or not segmentos_json:
            raise ErrorNegocio(
                422,
                "Audio sin voz",
                "No se detectó voz en el audio (solo silencio o ruido). La transcripción necesita voz.",
                "AUDIO_SIN_VOZ",
                "validacion",
            )

        documento = {
            "tipoDato": "transcripcion/v1",
            "idioma": parametros.idioma,
            "modelo": parametros.modelo,
            "duracionMs": round(duracion_s * 1000),
            "segmentos": segmentos_json,
            "estadisticas": {
                "segmentos": len(segmentos_json),
                "palabras": palabras_totales,
                "segundosProceso": round(time.time() - t0, 2),
            },
        }
        salida.write_text(json.dumps(documento, ensure_ascii=False), encoding="utf-8")
        reportar(1.0, f"Completado: {len(segmentos_json)} segmento(s), {palabras_totales} palabra(s)")

    def _decodificar(self, ruta: str):
        """Decodifica a float32 mono 16 kHz (hilo del executor)."""
        from faster_whisper.audio import decode_audio

        return decode_audio(ruta, sampling_rate=TASA_WHISPER_HZ)

    def _transcribir_bloque(self, modelo, rebanada, idioma: str, progreso):  # noqa: ANN001
        """Transcribe una rebanada float32 16 kHz. Timestamps relativos a la rebanada."""
        resultado = []
        segmentos, _info = modelo.transcribe(
            rebanada,
            language=idioma,
            word_timestamps=True,
            vad_filter=True,
        )
        for segmento in segmentos:
            resultado.append(segmento)
            progreso(segmento.end)
        return resultado
