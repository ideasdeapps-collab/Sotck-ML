"""
train_xgb.py — features compartidas + fetch_polygon con FALLBACK INTRADÍA
========================================================================
fetch_polygon ahora, si la barra diaria de HOY aún no fue publicada por Polygon
(típico del plan gratuito: el diario se consolida al día siguiente), construye
la barra del día en curso a partir de los minute-aggregates de hoy
(open=primera, high=máx, low=mín, close=última, volume=suma) y la agrega.

Así Predicción / Validación / Psicología usan el precio de HOY el mismo día,
en cuanto Polygon publica el intradía (con ~15 min de retraso en el free tier),
sin esperar a la barra diaria del día siguiente.

Degrada con elegancia: si el intradía no está disponible (fin de semana, sin
sesión, o error), devuelve solo el histórico diario, como antes.
"""

import os
import sys
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from polygon_client import get_json, TTL_DAILY, TTL_INTRADAY  # noqa: E402

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


def _fetch_daily(ticker: str, years: int) -> pd.DataFrame:
    """Barras diarias OHLCV desde Polygon (agregado diario)."""
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


def _today_bar_from_intraday(ticker: str) -> dict | None:
    """
    Construye la barra diaria del día EN CURSO a partir de los minute-aggregates
    de hoy. Devuelve dict OHLCV o None si no hay datos intradía (fin de semana,
    sin sesión, plan sin acceso, etc.).
    """
    today = dt.date.today()
    if today.weekday() >= 5:            # sábado/domingo: no hay sesión
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
    # Consolida los minutos en una barra diaria sintética
    return {
        "date": pd.Timestamp(today),
        "open": float(df["o"].iloc[0]),
        "high": float(df["h"].max()),
        "low": float(df["l"].min()),
        "close": float(df["c"].iloc[-1]),   # último precio conocido de hoy
        "volume": float(df["v"].sum()),
    }


def fetch_polygon(ticker: str, years: int = 2) -> pd.DataFrame:
    """Diario + fallback intradía para la barra de HOY si aún no fue publicada."""
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")

    df = _fetch_daily(ticker, years)

    # ¿Falta la barra de hoy? (hoy es día hábil y el último diario es anterior)
    today = pd.Timestamp(dt.date.today())
    last_daily = pd.Timestamp(df["date"].iloc[-1]).normalize()
    if today.weekday() < 5 and last_daily < today:
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
