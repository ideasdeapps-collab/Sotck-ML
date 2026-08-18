"""Polygon minute candle market adapter."""

import os
import datetime as dt
from typing import List, Dict, Any
from polygon_client import get_json


def fetch_minute_candles(ticker: str, days: int = 1) -> List[Dict[str, Any]]:
    key = os.getenv("POLYGON_API_KEY")
    if not key:
        raise RuntimeError("Missing POLYGON_API_KEY")

    # Polygon exige fechas YYYY-MM-DD (o timestamp ms); "now-1d/now" devuelve 400.
    # Se pide un colchón mínimo de 5 días para cubrir fines de semana/feriados
    # y el retraso ~15 min del plan gratuito, y luego se filtra a la última sesión.
    to_date = dt.date.today()
    from_date = to_date - dt.timedelta(days=max(days, 5))

    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}"
        f"/range/1/minute/{from_date.isoformat()}/{to_date.isoformat()}"
        f"?adjusted=true&sort=asc&limit=50000&apiKey={key}"
    )

    data = get_json(url)
    results = data.get("results", []) or []

    # Nos quedamos solo con las velas de la última sesión disponible.
    if results:
        last_day = dt.datetime.utcfromtimestamp(results[-1]["t"] / 1000).date()
        results = [
            row for row in results
            if dt.datetime.utcfromtimestamp(row["t"] / 1000).date() == last_day
        ]

    candles = []
    for row in results:
        candles.append({
            "timestamp": row["t"],
            "open": row["o"],
            "high": row["h"],
            "low": row["l"],
            "close": row["c"],
            "volume": row["v"],
        })

    return candles
