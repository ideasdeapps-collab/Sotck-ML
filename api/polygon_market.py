"""Polygon minute candle market adapter."""

import os
from typing import List, Dict, Any
from polygon_client import get_json


def fetch_minute_candles(ticker: str, days: int = 1) -> List[Dict[str, Any]]:
    key = os.getenv("POLYGON_API_KEY")
    if not key:
        raise RuntimeError("Missing POLYGON_API_KEY")

    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}"
        f"/range/1/minute/now-{days}d/now"
        f"?adjusted=true&sort=asc&limit=50000&apiKey={key}"
    )

    data = get_json(url)

    candles = []
    for row in data.get("results", []):
        candles.append({
            "timestamp": row["t"],
            "open": row["o"],
            "high": row["h"],
            "low": row["l"],
            "close": row["c"],
            "volume": row["v"],
        })

    return candles
