"""
intraday_ml.py — Predicción recursiva INTRADÍA de la sesión (barras de 15 min)
=============================================================================
Toma las barras REALES de la sesión en curso y proyecta, barra a barra, el
RESTO del día hasta el cierre (16:00 ET), aplicando el clamp anti-explosión.

Salida (para la pestaña):
  - session_date: fecha de la sesión
  - real:        barras reales ya ocurridas hoy  [{time, close}]
  - predicted:   curva predicha del resto del día [{time, close, predicted:true}]
  - full:        real + predicted concatenadas (para superponer Elliott)
  - meta:        métricas del modelo + info de clamp

Reutiliza add_intraday_features / FEATURE_COLS de train_xgb_intraday (misma
ingeniería que en entrenamiento, para que inferencia y training sean coherentes).
"""

from __future__ import annotations
import os
import sys
import json
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

# Reutiliza el módulo de entrenamiento intradía (features + descarga)
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "training"))
from train_xgb_intraday import (  # noqa: E402
    add_intraday_features, FEATURE_COLS, fetch_intraday_polygon,
    filter_regular_session, BARS_PER_SESSION, SESSION_START_MIN,
)

from polygon_client import get_json, TTL_INTRADAY  # noqa: E402

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
_CACHE: dict = {}


# --------------------------------------------------------------------------- #
# Carga del modelo intradía
# --------------------------------------------------------------------------- #
def load_intraday_model(ticker: str):
    t = ticker.upper()
    if t in _CACHE:
        return _CACHE[t]
    mp = ARTIFACT_DIR / f"xgb_intraday_{t}.joblib"
    mm = ARTIFACT_DIR / f"meta_intraday_{t}.json"
    if not mp.exists():
        raise FileNotFoundError(
            f"No hay modelo intradía para {t}. Corre: "
            f"python training/train_xgb_intraday.py --ticker {t}")
    model = joblib.load(mp)
    meta = json.load(open(mm)) if mm.exists() else {}
    _CACHE[t] = (model, meta)
    return model, meta


# --------------------------------------------------------------------------- #
# Barras de la sesión en curso (o la última sesión si el mercado está cerrado)
# --------------------------------------------------------------------------- #
def fetch_today_bars(ticker: str) -> pd.DataFrame:
    """
    Barras de 15 min de la sesión más reciente (regular). Si el mercado está
    abierto, son las de HOY hasta ahora; si está cerrado, la última sesión.
    """
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")
    end = dt.date.today()
    start = end - dt.timedelta(days=5)   # margen para caer en la última sesión hábil
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/15/minute/"
           f"{start.isoformat()}/{end.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}")
    res = get_json(url, ttl=TTL_INTRADAY).get("results", [])
    if not res:
        raise ValueError(f"Polygon no devolvió barras intradía para {ticker}.")
    df = pd.DataFrame(res).rename(columns={"o": "open", "h": "high", "l": "low",
                                           "c": "close", "v": "volume", "t": "timestamp"})
    df["dt_et"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True).dt.tz_convert("America/New_York")
    df = filter_regular_session(df)
    # Quedarnos solo con la ÚLTIMA sesión disponible
    last_day = df["dt_et"].dt.date.max()
    df = df[df["dt_et"].dt.date == last_day].reset_index(drop=True)
    return df


# --------------------------------------------------------------------------- #
# Predicción recursiva de la sesión
# --------------------------------------------------------------------------- #
def _predict_session_from_bars(model, meta: dict, today: pd.DataFrame) -> dict:
    """
    Núcleo recursivo (aislado para poder testear con datos sintéticos).
    today: barras reales de la sesión (columnas dt_et, open, high, low, close, volume).
    """
    sigma = float(meta.get("sigma_15m", 0.0) or 0.0)
    if sigma <= 0 or not np.isfinite(sigma):
        # fallback: estima σ de las barras disponibles
        r = np.log(today["close"] / today["close"].shift(1)).dropna()
        sigma = float(r.std()) if len(r) > 1 else 0.002
    cap = float(meta.get("clamp_k", 3.0)) * sigma

    # Volumen típico de la sesión para las barras sintéticas futuras
    vol_typ = float(today["volume"].tail(10).mean()) if len(today) else 1e5

    work = today.copy().reset_index(drop=True)
    n_real = len(work)
    last_bar_idx = n_real - 1                       # índice de la última barra real (0-based)
    price = float(work["close"].iloc[-1])
    last_time = pd.Timestamp(work["dt_et"].iloc[-1])

    pred_rows = []
    clamped = 0
    # Predecir desde la siguiente barra hasta la última de la sesión (idx 25)
    for idx in range(last_bar_idx + 1, BARS_PER_SESSION):
        feat = add_intraday_features(work)
        x = feat[FEATURE_COLS].iloc[[-1]].fillna(0.0).values   # última fila = estado actual
        raw = float(model.predict(x)[0])
        ret = float(np.clip(raw, -cap, cap))
        if ret != raw:
            clamped += 1
        price = price * np.exp(ret)
        last_time = last_time + pd.Timedelta(minutes=15)
        # Barra sintética futura (O=H=L=C=price; volumen típico)
        new = {"dt_et": last_time, "open": price, "high": price, "low": price,
               "close": round(price, 4), "volume": vol_typ}
        work = pd.concat([work, pd.DataFrame([new])], ignore_index=True)
        pred_rows.append({"time": last_time.isoformat(), "close": round(price, 4), "predicted": True})

    real_rows = [{"time": pd.Timestamp(r["dt_et"]).isoformat(), "close": round(float(r["close"]), 4)}
                 for _, r in today.iterrows()]

    full = [{"time": r["time"], "close": r["close"]} for r in real_rows] + \
           [{"time": r["time"], "close": r["close"]} for r in pred_rows]

    return {
        "session_date": pd.Timestamp(today["dt_et"].iloc[0]).date().isoformat(),
        "bars_real": n_real,
        "bars_predicted": len(pred_rows),
        "last_real_close": round(float(today["close"].iloc[-1]), 4),
        "real": real_rows,
        "predicted": pred_rows,
        "full": full,
        "clamp": {"sigma_15m": round(sigma, 6), "cap_per_bar": round(cap, 6), "bars_clamped": clamped},
        "model_meta": meta.get("metrics", {}),
    }


def predict_session(ticker: str) -> dict:
    """Descarga la sesión en curso y predice el resto del día (recursivo + clamp)."""
    model, meta = load_intraday_model(ticker)
    today = fetch_today_bars(ticker)
    out = _predict_session_from_bars(model, meta, today)
    out["ticker"] = ticker.upper()
    out["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    out["note"] = ("Curva recursiva de 15 min hasta el cierre (16:00 ET), acotada por clamp. "
                   "Señal intradía débil por naturaleza; úsese como contexto de sesión, no certeza.")
    return out
