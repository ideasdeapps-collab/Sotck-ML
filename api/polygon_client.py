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
import re
import time
import threading
from collections import deque
from urllib.parse import urlparse, parse_qs

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


_APIKEY_RE = re.compile(r"apiKey=[^&\s\"']+")


def _scrub_api_key(text: str) -> str:
    """Sustituye cualquier `apiKey=...` de un texto por `apiKey=<oculta>`.

    `requests` mete la URL completa (clave incluida) en el mensaje de
    `HTTPError` (vía `raise_for_status`) y también en los errores de red
    (`ConnectionError`/`Timeout`, p. ej. "Max retries exceeded with url:
    ...&apiKey=..."). Ambos casos pasan por aquí antes de salir de este
    módulo.
    """
    return _APIKEY_RE.sub("apiKey=<oculta>", text)


def _sanitized(exc: Exception) -> Exception:
    """Reconstruye `exc` con la clave oculta en el mensaje, mismo tipo.

    Se propaga el mismo tipo de excepción (para que quien capture
    `requests.exceptions.HTTPError` o `RequestException` lo siga viendo) y se
    encadena la original como causa (`raise ... from exc`), sin silenciar
    nada: solo se cambia el texto.
    """
    scrubbed = _scrub_api_key(str(exc))
    try:
        return type(exc)(scrubbed)
    except Exception:
        # Algún tipo de excepción no acepta un único string en el
        # constructor; no perdemos el saneamiento por eso.
        return RuntimeError(scrubbed)


def get_json(url: str, ttl: int = TTL_INTRADAY, timeout: int = 30) -> dict:
    """GET con caché por TTL y respeto estricto del rate-limit."""
    now = time.time()
    hit = _cache.get(url)
    if hit and now - hit[0] < ttl:
        return hit[1]

    _throttle()
    try:
        r = requests.get(url, timeout=timeout)
        # Si Polygon responde 429 (too many requests), espera y reintenta una vez.
        if r.status_code == 429:
            time.sleep(WINDOW / MAX_CALLS + BUFFER)
            _throttle()
            r = requests.get(url, timeout=timeout)
        r.raise_for_status()
    except requests.exceptions.RequestException as e:
        # Cubre tanto el HTTPError de raise_for_status() como los errores de
        # red (ConnectionError, Timeout): todos llevan la URL —y la clave—
        # en su mensaje.
        raise _sanitized(e) from e
    data = r.json()
    _cache[url] = (time.time(), data)
    return data


def get_paginated(url: str, ttl: int = TTL_INTRADAY, max_pages: int = 20) -> dict:
    """
    GET siguiendo el `next_url` de Polygon hasta agotar los resultados.

    `get_json` sirve para una respuesta que cabe en una llamada. 60 días de
    barras de un minuto no caben: con `limit=50000` Polygon devuelve la primera
    página y un cursor, y quedarse solo con esa página es entrenar sobre un
    recorte arbitrario sin que nada lo indique.

    El tope de páginas evita que un cursor en bucle cuelgue un entrenamiento;
    si se alcanza, `truncated` lo dice en vez de callarlo.
    """
    # La clave viaja en la URL inicial (todas las llamadas la incluyen); si no
    # está ahí, se recurre a la variable de entorno como respaldo.
    api_key = parse_qs(urlparse(url).query).get("apiKey", [""])[0] \
        or os.getenv("POLYGON_API_KEY", "")
    results: list = []
    next_url = url
    pages = 0

    while next_url and pages < max_pages:
        data = get_json(next_url, ttl=ttl)
        results.extend(data.get("results") or [])
        pages += 1

        next_url = data.get("next_url")
        if next_url and "apiKey=" not in next_url:
            # Polygon no propaga la clave en el cursor.
            sep = "&" if "?" in next_url else "?"
            next_url = f"{next_url}{sep}apiKey={api_key}"

    truncated = bool(next_url) and pages >= max_pages
    if truncated:
        print(f"[polygon] AVISO: se alcanzó el tope de {max_pages} páginas; faltan datos.")

    return {"results": results, "pages": pages, "truncated": truncated}


def cache_stats() -> dict:
    """Diagnóstico rápido para depuración."""
    with _lock:
        recent = len([t for t in _calls if time.time() - t <= WINDOW])
    return {"cached_urls": len(_cache), "calls_last_60s": recent,
            "max_per_min": MAX_CALLS}
