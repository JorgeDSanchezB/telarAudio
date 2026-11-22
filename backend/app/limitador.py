"""Limitador de tasa por cliente (cubo de fichas).

Alternativa descartada: slowapi (dependencia extra y dependencia de límites
decorados por ruta). Aquí el límite es global por IP, configurable y probado
unitariamente; en un backend local de un solo usuario es más que suficiente.
"""

from __future__ import annotations

import time


class LimitadorTasa:
    def __init__(self, capacidad: int, recarga_por_minuto: float) -> None:
        self.capacidad = float(capacidad)
        self.recarga_por_segundo = recarga_por_minuto / 60.0
        self._fichas: dict[str, float] = {}
        self._ultima_actualizacion: dict[str, float] = {}

    def permitir(self, clave: str) -> tuple[bool, float]:
        """Devuelve (permitido, segundos_estimados_para_reintentar)."""
        ahora = time.monotonic()
        ultima = self._ultima_actualizacion.get(clave, ahora)
        fichas = self._fichas.get(clave, self.capacidad)
        fichas = min(self.capacidad, fichas + (ahora - ultima) * self.recarga_por_segundo)
        if fichas >= 1.0:
            self._fichas[clave] = fichas - 1.0
            self._ultima_actualizacion[clave] = ahora
            return True, 0.0
        self._fichas[clave] = fichas
        self._ultima_actualizacion[clave] = ahora
        return False, (1.0 - fichas) / self.recarga_por_segundo
