"""
mlp.py — Predicción recursiva con la red neuronal (MLP)
=======================================================
Módulo autocontenido para servir la curva MLP desde la API, sin tocar la lógica
de XGBoost. Reutiliza las mismas features (train_xgb) para que ambas curvas sean
comparables punto a punto.

El modelo guardado es un Pipeline(StandardScaler + MLPRegressor), así que el
escalado va incluido: basta pipe.predict(X).
"""

from __future__ import annotations
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

from train_xgb import fetch_polygon, add_features, FEATURE_COLS

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
_MLP_CACHE: dict[str, tuple] = {}


def load_mlp(ticker: str):
    """Carga (con caché) el pipeline MLP y sus metadatos."""
    t = ticker.upper()
    if t in _MLP_CACHE:
        return _MLP_CACHE[t]
    mp = ARTIFACT_DIR / f"mlp_{t}.joblib"
    mm = ARTIFACT_DIR / f"meta_mlp_{t}.json"
    if not mp.exists():
        raise FileNotFoundError(
            f"No hay modelo MLP para {t}. Corre: python training/train_mlp.py --ticker {t}")
    pipe = joblib.load(mp)
    meta = json.load(open(mm)) if mm.exists() else {}
    _MLP_CACHE[t] = (pipe, meta)
    return pipe, meta


def predict_curve_mlp(ticker: str, horizon: int) -> dict:
    """
    Predicción recursiva con la red neuronal: predice el retorno log del día
    siguiente, lo aplica al precio y recalcula features, repitiendo 'horizon' veces.
    Devuelve el mismo formato que la curva XGBoost (history + prediction).
    """
    pipe, meta = load_mlp(ticker)
    raw = fetch_polygon(ticker, years=1)
    df = add_features(raw).dropna().reset_index(drop=True)
    hist = raw[["date", "close"]].tail(120).copy()
    work = df.copy()
    last_close = float(raw["close"].iloc[-1])

    pred_dates, pred_prices = [], []
    cur_date = pd.to_datetime(raw["date"].iloc[-1])
    price = last_close

    for _ in range(horizon):
        x = work[FEATURE_COLS].iloc[[-1]].values
        log_ret = float(pipe.predict(x)[0])
        price = price * np.exp(log_ret)
        cur_date += pd.Timedelta(days=1)
        while cur_date.weekday() >= 5:      # salta fin de semana
            cur_date += pd.Timedelta(days=1)
        pred_dates.append(cur_date.date().isoformat())
        pred_prices.append(round(price, 4))
        new_row = {"date": cur_date, "open": price, "high": price, "low": price,
                   "close": price, "volume": raw["volume"].tail(20).mean()}
        raw = pd.concat([raw, pd.DataFrame([new_row])], ignore_index=True)
        work = add_features(raw).reset_index(drop=True)

    return {
        "ticker": ticker.upper(),
        "model": "MLP",
        "last_close": last_close,
        "last_date": pd.to_datetime(hist["date"].iloc[-1]).date().isoformat(),
        "history": [{"date": pd.to_datetime(d).date().isoformat(), "close": round(float(c), 4)}
                    for d, c in zip(hist["date"], hist["close"])],
        "prediction": [{"date": d, "close": p} for d, p in zip(pred_dates, pred_prices)],
        "model_meta": meta.get("metrics", {}),
    }
