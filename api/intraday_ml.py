"""
intraday_ml.py — Predicción recursiva INTRADÍA + Elliott (barras de 15 min)
==========================================================================
Toma las barras REALES de la sesión en curso y proyecta, barra a barra, el
RESTO del día hasta el cierre (16:00 ET), con clamp anti-explosión. Además
calcula Elliott sobre (a) las barras reales y (b) la sesión completa
(real + predicha) — para superponerlas con estilos distintos (opción C).

CAMBIO: las barras REALES ahora incluyen OHLC (open/high/low/close/volume)
para poder dibujar VELAS con valores reales de Polygon en el frontend.
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

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "training"))
from train_xgb_intraday import (  # noqa: E402
    add_intraday_features, FEATURE_COLS, filter_regular_session, BARS_PER_SESSION,
)

from polygon_client import get_json, TTL_INTRADAY  # noqa: E402
from elliott import elliott_from_candles            # noqa: E402

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
_CACHE: dict = {}

# Umbral ZigZag para intradía (fino; ~0.15% por swing)
INTRADAY_ZIGZAG_PCT = 0.0015


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


def fetch_today_bars(ticker: str) -> pd.DataFrame:
    """Barras de 15 min de la última sesión regular disponible."""
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")
    end = dt.date.today()
    start = end - dt.timedelta(days=5)
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
    last_day = df["dt_et"].dt.date.max()
    return df[df["dt_et"].dt.date == last_day].reset_index(drop=True)


def _predict_session_from_bars(model, meta: dict, today: pd.DataFrame) -> dict:
    """Núcleo recursivo + Elliott (aislado para testear sin red)."""
    sigma = float(meta.get("sigma_15m", 0.0) or 0.0)
    if sigma <= 0 or not np.isfinite(sigma):
        r = np.log(today["close"] / today["close"].shift(1)).dropna()
        sigma = float(r.std()) if len(r) > 1 else 0.002
    cap = float(meta.get("clamp_k", 3.0)) * sigma
    vol_typ = float(today["volume"].tail(10).mean()) if len(today) else 1e5

    work = today.copy().reset_index(drop=True)
    n_real = len(work)
    price = float(work["close"].iloc[-1])
    last_time = pd.Timestamp(work["dt_et"].iloc[-1])

    pred_rows, clamped = [], 0
    for _ in range(n_real, BARS_PER_SESSION):
        feat = add_intraday_features(work)
        x = feat[FEATURE_COLS].iloc[[-1]].fillna(0.0).values
        raw = float(model.predict(x)[0])
        ret = float(np.clip(raw, -cap, cap))
        if ret != raw:
            clamped += 1
        price = price * np.exp(ret)
        last_time = last_time + pd.Timedelta(minutes=15)
        new = {"dt_et": last_time, "open": price, "high": price, "low": price,
               "close": round(price, 4), "volume": vol_typ}
        work = pd.concat([work, pd.DataFrame([new])], ignore_index=True)
        pred_rows.append({"time": last_time.isoformat(), "close": round(price, 4), "predicted": True})

    # ── Barras REALES con OHLC (para dibujar VELAS reales) ──
    real_rows = [{
        "time": pd.Timestamp(r["dt_et"]).isoformat(),
        "open": round(float(r["open"]), 4),
        "high": round(float(r["high"]), 4),
        "low": round(float(r["low"]), 4),
        "close": round(float(r["close"]), 4),
        "volume": int(r["volume"]),
    } for _, r in today.iterrows()]

    # 'full' = cierres (real+predicho) para Elliott y para la línea de continuidad
    full = [{"time": r["time"], "close": r["close"]} for r in real_rows] + \
           [{"time": r["time"], "close": r["close"]} for r in pred_rows]

    # ── Elliott (opción C): sobre reales y sobre la sesión completa ──
    real_closes = [{"time": r["time"], "close": r["close"]} for r in real_rows]
    elliott_real = elliott_from_candles(real_closes, pct=INTRADAY_ZIGZAG_PCT) if len(real_closes) >= 3 else {"zigzag": [], "elliott": {"found": False}, "abc": {"found": False}}
    elliott_full = elliott_from_candles(full, pct=INTRADAY_ZIGZAG_PCT) if len(full) >= 3 else {"zigzag": [], "elliott": {"found": False}, "abc": {"found": False}}

    return {
        "session_date": pd.Timestamp(today["dt_et"].iloc[0]).date().isoformat(),
        "bars_real": n_real, "bars_predicted": len(pred_rows),
        "last_real_close": round(float(today["close"].iloc[-1]), 4),
        "real": real_rows, "predicted": pred_rows, "full": full,
        "elliott_real": elliott_real, "elliott_full": elliott_full,
        "clamp": {"sigma_15m": round(sigma, 6), "cap_per_bar": round(cap, 6), "bars_clamped": clamped},
        "model_meta": meta.get("metrics", {}),
    }


def predict_session(ticker: str) -> dict:
    model, meta = load_intraday_model(ticker)
    today = fetch_today_bars(ticker)
    out = _predict_session_from_bars(model, meta, today)
    out["ticker"] = ticker.upper()
    out["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    out["note"] = ("Curva recursiva de 15 min hasta el cierre (16:00 ET), acotada por clamp. "
                   "Elliott experimental. Señal intradía débil (Dir.Acc ~50%); contexto, no certeza.")
    return out
