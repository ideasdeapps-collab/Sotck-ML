"""
data_1m.py — Barras de 1 minuto de varios tickers, con caché en disco
====================================================================
Base del modelo de dirección (train_xgb_1m_dir.py) y de su inferencia
(api/signal_1m.py). A diferencia de train_xgb_1m.fetch_1m_polygon, conserva
`vw` (VWAP de la barra) y `n` (nº de transacciones): Polygon ya los devuelve y
son la única microestructura que el plan Starter deja ver.

Un año de 1 min son ~5 páginas de 50 000 barras por ticker (Polygon incluye el
horario extendido, que aquí se descarta). La caché evita bajarlo entero en cada
reentreno: se guarda {"start", "df"} y solo se re-descarga desde el último día
cacheado, que pudo quedar a medias.
"""

from __future__ import annotations
import os
import sys
import datetime as dt
from pathlib import Path

import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_paginated  # noqa: E402
from train_xgb_1m import SESSION_START_MIN, SESSION_END_MIN  # noqa: E402

CACHE_DIR = Path(__file__).resolve().parent / ".cache_1m"
BAR_COLS = ["dt_et", "open", "high", "low", "close", "volume", "vw", "n"]


def aggs_to_frame(results: list[dict]) -> pd.DataFrame:
    """Respuesta cruda de /v2/aggs → barras de sesión regular, ordenadas y únicas."""
    if not results:
        return pd.DataFrame(columns=BAR_COLS)
    df = pd.DataFrame(results).rename(columns={"o": "open", "h": "high", "l": "low",
                                               "c": "close", "v": "volume", "t": "timestamp"})
    for col in ("vw", "n"):
        if col not in df:
            df[col] = float("nan")
    df["dt_et"] = (pd.to_datetime(df["timestamp"], unit="ms", utc=True)
                   .dt.tz_convert("America/New_York"))
    mins = df["dt_et"].dt.hour * 60 + df["dt_et"].dt.minute
    df = df[(mins >= SESSION_START_MIN) & (mins < SESSION_END_MIN)]
    return (df[BAR_COLS].sort_values("dt_et").drop_duplicates("dt_et", keep="last")
            .reset_index(drop=True))


def fetch_bars(ticker: str, start: dt.date, end: dt.date, ttl: int = 60,
               store: bool = True) -> pd.DataFrame:
    key = os.getenv("POLYGON_API_KEY")
    if not key:
        raise RuntimeError("Falta POLYGON_API_KEY")
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/minute/"
           f"{start.isoformat()}/{end.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={key}")
    page = get_paginated(url, ttl=ttl, max_pages=40, store=store)
    if page["truncated"]:
        # Entrenar con un recorte arbitrario sin saberlo es peor que fallar.
        raise RuntimeError(f"Descarga de 1 min truncada para {ticker}: faltan páginas")
    return aggs_to_frame(page["results"])


def merge_bars(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    """Une dos tramos; en un solape gana la barra nueva (la vieja pudo estar a medias)."""
    df = pd.concat([old, new], ignore_index=True)
    return (df.sort_values("dt_et", kind="stable").drop_duplicates("dt_et", keep="last")
            .reset_index(drop=True))


def last_sessions(df: pd.DataFrame, sessions: int) -> pd.DataFrame:
    days = sorted(df["dt_et"].dt.date.unique())[-sessions:]
    return df[df["dt_et"].dt.date.isin(days)].reset_index(drop=True)


def load_bars(ticker: str, sessions: int, today: dt.date | None = None) -> pd.DataFrame:
    """Últimas `sessions` sesiones de `ticker`, usando y actualizando la caché."""
    today = today or dt.date.today()
    # ×1.6 + 7: fines de semana y festivos, con margen.
    start = today - dt.timedelta(days=int(sessions * 1.6) + 7)
    path = CACHE_DIR / f"{ticker.upper()}.pkl"
    cache = pd.read_pickle(path) if path.exists() else None

    if cache and cache["start"] <= start and len(cache["df"]):
        cached = cache["df"]
        last = cached["dt_et"].dt.date.max()
        df = merge_bars(cached[cached["dt_et"].dt.date < last], fetch_bars(ticker, last, today))
        cache_start = cache["start"]
    else:
        df = fetch_bars(ticker, start, today)
        cache_start = start

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pd.to_pickle({"start": cache_start, "df": df}, path)
    return last_sessions(df, sessions)
