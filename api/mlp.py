"""
mlp.py — Predicción recursiva con la red neuronal (MLP) — CON PROTECCIONES
==========================================================================
FIX del colapso a cero (caso SNDK):

  Problema: las redes neuronales EXTRAPOLAN sin límite fuera del rango de
  entrenamiento. En la predicción recursiva, un retorno negativo genera features
  cada vez más extremas → retornos aún más negativos → espiral hacia $0.
  (XGBoost, al ser árboles, satura y no sufre tanto esto.)

  Solución (2 capas):
   1) CLAMP: cada retorno log diario se acota a ±K·σ (σ = volatilidad diaria
      histórica del ticker). Impide la explosión/implosión recursiva.
   2) RELIABILITY: si el modelo tiene R² < 0 o accuracy direccional < 0.5, se
      marca como poco confiable y se avisa (para que el frontend lo advierta o
      lo oculte). Un modelo así no debería usarse a ciegas.
"""

from __future__ import annotations
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

from train_xgb import fetch_polygon, add_features, FEATURE_COLS

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"
_CACHE: dict = {}

# Cuántas desviaciones estándar diarias como tope por paso (anti-explosión)
CLAMP_K = 3.5


def load_mlp(ticker: str):
    t = ticker.upper()
    if t in _CACHE:
        return _CACHE[t]
    mp = ARTIFACT_DIR / f"mlp_{t}.joblib"
    mm = ARTIFACT_DIR / f"meta_mlp_{t}.json"
    if not mp.exists():
        raise FileNotFoundError(f"No hay modelo MLP para {t}. Corre train_mlp.py --ticker {t}")
    pipe = joblib.load(mp)
    meta = json.load(open(mm)) if mm.exists() else {}
    _CACHE[t] = (pipe, meta)
    return pipe, meta


def _reliability(meta: dict) -> dict:
    """Evalúa si el modelo es confiable a partir de sus métricas de test."""
    m = meta.get("metrics", {})
    r2 = m.get("r2")
    dacc = m.get("directional_accuracy")
    reliable = True
    reasons = []
    if r2 is not None and r2 < 0:
        reliable = False
        reasons.append(f"R² negativo ({r2:.2f}): peor que predecir la media.")
    if dacc is not None and dacc < 0.5:
        reliable = False
        reasons.append(f"Precisión direccional baja ({dacc:.0%}).")
    return {"reliable": reliable, "r2": r2, "directional_accuracy": dacc,
            "warning": None if reliable else " ".join(reasons)}


def predict_curve_mlp(ticker: str, horizon: int) -> dict:
    pipe, meta = load_mlp(ticker)
    raw = fetch_polygon(ticker, years=1)
    df = add_features(raw).dropna().reset_index(drop=True)

    # Volatilidad diaria histórica para el clamp (fallback razonable si falta)
    sigma_daily = float(df["log_ret"].std()) if "log_ret" in df.columns else 0.03
    if not np.isfinite(sigma_daily) or sigma_daily <= 0:
        sigma_daily = 0.03
    cap = CLAMP_K * sigma_daily

    hist = raw[["date", "close"]].tail(120).copy()
    work = df.copy()
    last_close = float(raw["close"].iloc[-1])
    pred_dates, pred_prices = [], []
    cur = pd.to_datetime(raw["date"].iloc[-1])
    price = last_close
    clamped_count = 0

    for _ in range(horizon):
        x = work[FEATURE_COLS].iloc[[-1]].values
        raw_ret = float(pipe.predict(x)[0])
        # --- CLAMP anti-explosión ---
        ret = float(np.clip(raw_ret, -cap, cap))
        if ret != raw_ret:
            clamped_count += 1
        price = price * np.exp(ret)
        cur += pd.Timedelta(days=1)
        while cur.weekday() >= 5:
            cur += pd.Timedelta(days=1)
        pred_dates.append(cur.date().isoformat())
        pred_prices.append(round(price, 4))
        new = {"date": cur, "open": price, "high": price, "low": price, "close": price,
               "volume": raw["volume"].tail(20).mean()}
        raw = pd.concat([raw, pd.DataFrame([new])], ignore_index=True)
        work = add_features(raw).reset_index(drop=True)

    rel = _reliability(meta)
    return {
        "ticker": ticker.upper(), "model": "MLP", "last_close": last_close,
        "last_date": pd.to_datetime(hist["date"].iloc[-1]).date().isoformat(),
        "history": [{"date": pd.to_datetime(d).date().isoformat(), "close": round(float(c), 4)}
                    for d, c in zip(hist["date"], hist["close"])],
        "prediction": [{"date": d, "close": p} for d, p in zip(pred_dates, pred_prices)],
        "model_meta": meta.get("metrics", {}),
        "reliability": rel,                       # {reliable, r2, dir_acc, warning}
        "clamp": {"sigma_daily": round(sigma_daily, 5),
                  "cap_per_day": round(cap, 5),
                  "steps_clamped": clamped_count},
    }
