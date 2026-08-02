"""
polygon_client.py — Cliente Polygon con rate-limit + caché (para plan GRATUITO)
==============================================================================
El plan Basic (gratuito) de Polygon/Massive permite:
    - 5 llamadas por minuto (límite duro)
    - datos con 15 minutos de retraso
    - minute aggregates incluidos (diferidos)

Este módulo centraliza TODAS las llamadas a Polygon para:
  1) Estrangular a <= 5 llamadas/min (ventana deslizante, thread-safe).
  2) Cachear respuestas por TTL, para no gastar llamadas de más
     (no sirve refrescar antes de 15 min: el dato viene diferido igual).

Variables de entorno:
    POLYGON_API_KEY
    POLYGON_MAX_CALLS_PER_MIN   (default 5)
"""

from __future__ import annotations
import os
import time
import threading
from collections import deque

import requests

MAX_CALLS = int(os.getenv("POLYGON_MAX_CALLS_PER_MIN", "5"))
WINDOW = 60.0          # segundos
BUFFER = 0.6           # margen de seguridad al esperar

# TTLs recomendados (segundos). El intradía se difiere 15 min => cachear 15 min.
TTL_INTRADAY = int(os.getenv("TTL_INTRADAY", "900"))    # 15 min
TTL_DAILY = int(os.getenv("TTL_DAILY", "3600"))         # 1 hora

_lock = threading.Lock()
_calls: deque[float] = deque()
_cache: dict[str, tuple[float, dict]] = {}


def _throttle() -> None:
    """Bloquea hasta que haya cupo dentro del límite de 5 llamadas/min."""
    with _lock:
        now = time.time()
        # descarta timestamps fuera de la ventana de 60s
        while _calls and now - _calls[0] > WINDOW:
            _calls.popleft()
        if len(_calls) >= MAX_CALLS:
            sleep_for = WINDOW - (now - _calls[0]) + BUFFER
            if sleep_for > 0:
                time.sleep(sleep_for)
            now = time.time()
            while _calls and now - _calls[0] > WINDOW:
                _calls.popleft()
        _calls.append(time.time())


def get_json(url: str, ttl: int = TTL_INTRADAY, timeout: int = 30) -> dict:
    """GET con caché por TTL y respeto estricto del rate-limit."""
    now = time.time()
    hit = _cache.get(url)
    if hit and now - hit[0] < ttl:
        return hit[1]

    _throttle()
    r = requests.get(url, timeout=timeout)
    # Si Polygon responde 429 (too many requests), espera y reintenta una vez.
    if r.status_code == 429:
        time.sleep(WINDOW / MAX_CALLS + BUFFER)
        _throttle()
        r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    _cache[url] = (time.time(), data)
    return data


def cache_stats() -> dict:
    """Diagnóstico rápido para depuración."""
    with _lock:
        recent = len([t for t in _calls if time.time() - t <= WINDOW])
    return {"cached_urls": len(_cache), "calls_last_60s": recent,
            "max_per_min": MAX_CALLS}
