"""
extended_ml.py — Inferencia del modelo XGBoost EXTENDIDO (RTH+AH+PM)
===================================================================
Produce una curva de predicción con el MISMO formato que las demás del ensamble
(history + prediction), para superponerla junto a XGBoost/MLP/Sentimiento/etc.

Independiente del modelo original. Usa los artefactos xgb_ext_<T> / meta_ext_<T>.

HONESTIDAD DE DISEÑO:
  Las features de horario extendido (ah_return, pm_return, ...) solo se conocen
  para el PRÓXIMO día (con el after-hours de ayer + el premarket de hoy). En la
  proyección recursiva a N días, a partir del día 2 esas features se vuelven
  NEUTRALES (0), porque no existe AH/PM futuro. Por eso el aporte del modelo
  extendido se concentra en el día 1 (el gap de apertura), que es justo donde
  el modelo regular está ciego.
"""

from __future__ import annotations
import os
import sys
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "training"))
from train_xgb_extended import (  # noqa: E402
    fetch_extended_5min, classify_and_aggregate, add_features,
    ALL_FEATURES, EXT_FEATURES,
)

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
_CACHE: dict = {}


def load_extended(ticker: str):
    t = ticker.upper()
    if t in _CACHE:
        return _CACHE[t]
    mp = ARTIFACT_DIR / f"xgb_ext_{t}.joblib"
    mm = ARTIFACT_DIR / f"meta_ext_{t}.json"
    if not mp.exists():
        raise FileNotFoundError(
            f"No hay modelo extendido para {t}. Corre: "
            f"python training/train_xgb_extended.py --ticker {t}")
    model = joblib.load(mp)
    meta = json.load(open(mm)) if mm.exists() else {}
    _CACHE[t] = (model, meta)
    return model, meta


def predict_curve_extended(ticker: str, horizon: int = 30) -> dict:
    """Curva recursiva del modelo extendido. Mismo formato que /predict."""
    model, meta = load_extended(ticker)
    # ~1.2 años de 5-min bastan para features + histórico de la curva
    bars = fetch_extended_5min(ticker, years=1.2)
    daily = classify_and_aggregate(bars)
    feat = add_features(daily).dropna(subset=ALL_FEATURES).reset_index(drop=True)
    if feat.empty:
        raise ValueError("No hay suficientes datos extendidos para inferir.")

    hist = daily[["date", "close"]].tail(120).copy()
    last_close = float(daily["close"].iloc[-1])

    # Estado actual de TODAS las features (día 1 usa las extendidas reales)
    cur = feat[ALL_FEATURES].iloc[[-1]].copy()
    ext_idx = [ALL_FEATURES.index(k) for k in EXT_FEATURES]

    price = last_close
    cur_date = pd.to_datetime(daily["date"].iloc[-1])
    pred_dates, pred_prices = [], []

    # Para actualizar los lags de retorno de forma simple entre pasos
    ret_lags = [float(feat["ret_lag_1"].iloc[-1]), float(feat["ret_lag_2"].iloc[-1]),
                float(feat["ret_lag_3"].iloc[-1])]

    for step in range(horizon):
        x = cur[ALL_FEATURES].values.astype(float)
        log_ret = float(model.predict(x)[0])
        price *= np.exp(log_ret)
        cur_date += pd.Timedelta(days=1)
        while cur_date.weekday() >= 5:
            cur_date += pd.Timedelta(days=1)
        pred_dates.append(cur_date.date().isoformat())
        pred_prices.append(round(price, 4))

        # Preparar features del siguiente paso:
        # - lags de retorno se desplazan con el retorno recién predicho
        ret_lags = [log_ret, ret_lags[0], ret_lags[1]]
        cur.iloc[0, ALL_FEATURES.index("ret_lag_1")] = ret_lags[0]
        cur.iloc[0, ALL_FEATURES.index("ret_lag_2")] = ret_lags[1]
        cur.iloc[0, ALL_FEATURES.index("ret_lag_3")] = ret_lags[2]
        # - momentum aproximado
        cur.iloc[0, ALL_FEATURES.index("mom_5")] = float(np.expm1(sum(ret_lags)))
        # - a partir del día 2, las features EXTENDIDAS son neutrales (no hay AH/PM futuro)
        if step >= 0:
            for j in ext_idx:
                cur.iloc[0, j] = 0.0

    return {
        "ticker": ticker.upper(), "model": "XGBoost-extended", "last_close": last_close,
        "last_date": pd.to_datetime(hist["date"].iloc[-1]).date().isoformat(),
        "history": [{"date": pd.to_datetime(d).date().isoformat(), "close": round(float(c), 4)}
                    for d, c in zip(hist["date"], hist["close"])],
        "prediction": [{"date": d, "close": p} for d, p in zip(pred_dates, pred_prices)],
        "model_meta": meta.get("metrics", {}),
        "ext_importance": meta.get("ext_importance"),
        "note": ("Modelo con after-hours + premarket. Su ventaja se concentra en el "
                 "día 1 (gap de apertura); en días siguientes las features nocturnas "
                 "se vuelven neutrales."),
    }
