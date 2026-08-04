"""
train_xgb.py — features compartidas + fetch_polygon con CACHÉ SUPABASE (Fase 1)
==============================================================================
fetch_polygon ahora sigue esta prioridad:
  1) Lee precios desde la CACHÉ de Supabase (price_cache). Si están frescos
     (última fecha >= último día hábil), los usa SIN llamar a Polygon.
  2) Si la caché falta o está desactualizada, llama a Polygon, y ESCRIBE el
     resultado de vuelta en la caché (para que los demás usuarios ya no llamen).
  3) Añade la barra intradía de HOY si aún no fue publicada (fallback previo).

Beneficio: por muchos usuarios simultáneos, todos LEEN de Supabase; solo cuando
falta dato fresco se toca Polygon (idealmente, solo el workflow diario lo hace).

Control por entorno:
  USE_PRICE_CACHE = "1" (default) para activar la caché; "0" para el modo antiguo.
"""

import os
import sys
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_json, TTL_DAILY, TTL_INTRADAY  # noqa: E402

# Caché compartida en Supabase (Fase 1). Import defensivo: si falta, se desactiva.
try:
    import price_store  # noqa: E402
except Exception:
    price_store = None

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

USE_PRICE_CACHE = os.getenv("USE_PRICE_CACHE", "1") == "1"


def _last_business_day() -> dt.date:
    d = dt.date.today()
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d


def _fetch_daily_polygon(ticker: str, years: int) -> pd.DataFrame:
    """Barras diarias OHLCV directamente desde Polygon (fuente primaria)."""
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")
    end = dt.date.today()
    start = end - dt.timedelta(days=int(years * 365.25))
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/day/"
           f"{start.isoformat()}/{end.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}")
    results = get_json(url, ttl=TTL_DAILY).get("results", [])
    if not results:
        raise ValueError(f"Polygon no devolvió datos para {ticker}")
    df = pd.DataFrame(results).rename(columns={"o": "open", "h": "high", "l": "low",
                                               "c": "close", "v": "volume", "t": "timestamp"})
    df["date"] = pd.to_datetime(df["timestamp"], unit="ms")
    return df[["date", "open", "high", "low", "close", "volume"]].sort_values("date").reset_index(drop=True)


def _get_daily(ticker: str, years: int) -> pd.DataFrame:
    """
    Diario con prioridad de caché:
      caché fresca -> úsala (sin Polygon)
      caché vieja/ausente -> Polygon + escribe caché
    """
    cache_on = USE_PRICE_CACHE and price_store is not None and price_store.enabled()

    if cache_on:
        cached = price_store.read_prices(ticker, years=years)
        if cached is not None and not cached.empty:
            last = pd.to_datetime(cached["date"].iloc[-1]).date()
            if last >= _last_business_day():
                return cached          # caché fresca: NO llamamos a Polygon

    # Caché ausente/vieja -> Polygon (fuente) y actualiza caché
    df = _fetch_daily_polygon(ticker, years)
    if cache_on:
        try:
            price_store.write_prices(ticker, df)
        except Exception as e:
            print(f"[WARN] No se pudo escribir price_cache para {ticker}: {e}")
    return df


def _today_bar_from_intraday(ticker: str) -> dict | None:
    """Barra del día en curso a partir de minute-aggregates (fallback intradía)."""
    today = dt.date.today()
    if today.weekday() >= 5:
        return None
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/1/minute/"
           f"{today.isoformat()}/{today.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}")
    try:
        res = get_json(url, ttl=TTL_INTRADAY).get("results", [])
    except Exception:
        return None
    if not res:
        return None
    df = pd.DataFrame(res)
    return {"date": pd.Timestamp(today), "open": float(df["o"].iloc[0]),
            "high": float(df["h"].max()), "low": float(df["l"].min()),
            "close": float(df["c"].iloc[-1]), "volume": float(df["v"].sum())}


def fetch_polygon(ticker: str, years: int = 2) -> pd.DataFrame:
    """Diario (caché → Polygon) + fallback intradía para la barra de HOY."""
    if not POLYGON_API_KEY and not (USE_PRICE_CACHE and price_store and price_store.enabled()):
        raise RuntimeError("Falta POLYGON_API_KEY")

    df = _get_daily(ticker, years)

    # ¿Falta la barra de hoy y es día hábil? Intenta el intradía (solo si hay API key)
    today = pd.Timestamp(dt.date.today())
    last_daily = pd.Timestamp(df["date"].iloc[-1]).normalize()
    if POLYGON_API_KEY and today.weekday() < 5 and last_daily < today:
        bar = _today_bar_from_intraday(ticker)
        if bar is not None:
            df = pd.concat([df, pd.DataFrame([bar])], ignore_index=True)
            df = df.sort_values("date").reset_index(drop=True)

    return df


def add_features(df):
    out = df.copy(); out["log_ret"] = np.log(out["close"]/out["close"].shift(1))
    for w in (5, 10, 20, 50):
        out[f"sma_{w}"] = out["close"].rolling(w).mean(); out[f"sma_ratio_{w}"] = out["close"]/out[f"sma_{w}"]
    out["vol_10"] = out["log_ret"].rolling(10).std(); out["vol_20"] = out["log_ret"].rolling(20).std()
    delta = out["close"].diff(); gain = delta.clip(lower=0).rolling(14).mean(); loss = (-delta.clip(upper=0)).rolling(14).mean()
    out["rsi_14"] = 100-(100/(1+gain/(loss+1e-9)))
    e12 = out["close"].ewm(span=12, adjust=False).mean(); e26 = out["close"].ewm(span=26, adjust=False).mean()
    out["macd"] = e12-e26; out["macd_signal"] = out["macd"].ewm(span=9, adjust=False).mean()
    out["momentum_10"] = out["close"]/out["close"].shift(10)-1
    out["vol_change"] = out["volume"]/out["volume"].rolling(20).mean()
    for lag in (1, 2, 3, 5): out[f"ret_lag_{lag}"] = out["log_ret"].shift(lag)
    out["target"] = out["log_ret"].shift(-1); return out


FEATURE_COLS = ["sma_ratio_5", "sma_ratio_10", "sma_ratio_20", "sma_ratio_50", "vol_10", "vol_20",
                "rsi_14", "macd", "macd_signal", "momentum_10", "vol_change",
                "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_5"]
