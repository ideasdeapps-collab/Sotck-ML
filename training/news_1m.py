"""
news_1m.py — Historial de noticias de Polygon con sentimiento, por ticker
=======================================================================
/v2/reference/news trae `insights` con el sentimiento del artículo hacia cada
ticker que menciona. Aquí se reduce a una serie (id, ts UTC, sent ∈ {-1,0,1})
que features_1m_dir.py agrega por ventanas SOLO hacia atrás: una noticia cuenta
para la barra t si se publicó antes del cierre de esa barra.
"""

from __future__ import annotations
import os
import sys
import datetime as dt

import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_paginated  # noqa: E402
from sentiment import ticker_sentiment  # noqa: E402
from data_1m import CACHE_DIR  # noqa: E402

NEWS_COLS = ["id", "ts", "sent"]
SENT_VALUE = {"positive": 1, "negative": -1}


def news_to_frame(results: list[dict], ticker: str) -> pd.DataFrame:
    rows = [{"id": r.get("id"), "ts": r.get("published_utc"),
             "sent": SENT_VALUE.get(ticker_sentiment(r, ticker)[0], 0)}
            for r in results if r.get("published_utc")]
    if not rows:
        return pd.DataFrame({"id": pd.Series(dtype=str),
                             "ts": pd.Series(dtype="datetime64[ns, UTC]"),
                             "sent": pd.Series(dtype=int)})
    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return (df.drop_duplicates("id").sort_values("ts").reset_index(drop=True)[NEWS_COLS])


def fetch_news(ticker: str, since: dt.date, ttl: int = 300) -> pd.DataFrame:
    key = os.getenv("POLYGON_API_KEY")
    if not key:
        raise RuntimeError("Falta POLYGON_API_KEY")
    url = (f"https://api.polygon.io/v2/reference/news?ticker={ticker.upper()}"
           f"&published_utc.gte={since.isoformat()}&order=asc&sort=published_utc"
           f"&limit=1000&apiKey={key}")
    page = get_paginated(url, ttl=ttl, max_pages=40)
    if page["truncated"]:
        print(f"[aviso] noticias truncadas para {ticker}: faltan páginas")
    return news_to_frame(page["results"], ticker)


def load_news(ticker: str, since: dt.date) -> pd.DataFrame:
    """Noticias desde `since`, con la misma caché incremental que las barras."""
    path = CACHE_DIR / f"news_{ticker.upper()}.pkl"
    cache = pd.read_pickle(path) if path.exists() else None

    if cache and cache["since"] <= since and len(cache["df"]):
        cached = cache["df"]
        last = cached["ts"].max().date()
        df = pd.concat([cached, fetch_news(ticker, last)], ignore_index=True)
        df = df.drop_duplicates("id", keep="last").sort_values("ts").reset_index(drop=True)
        cache_since = cache["since"]
    else:
        df = fetch_news(ticker, since)
        cache_since = since

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    pd.to_pickle({"since": cache_since, "df": df}, path)
    return df[df["ts"].dt.date >= since].reset_index(drop=True)
