"""
validate.py — Validación 1-paso: predicho vs real (XGBoost y MLP)
=================================================================
Para los últimos N días, reconstruye qué habría predicho CADA modelo un día
antes (predicción a 1 día) y lo compara con el precio REAL. Así se ve, sobre
datos reales recientes, el "acierto" de cada curva.

Método (1-step-ahead, el test más justo para un modelo de siguiente día):
  para cada día t en la ventana:
    ret_pred = modelo.predict(features[t-1])
    precio_pred[t] = close[t-1] * exp(ret_pred)
    se compara precio_pred[t] contra close[t] (real)

Devuelve serie {date, actual, xgb, mlp} + métricas por modelo
(MAPE del precio y precisión direccional).
"""

from __future__ import annotations
import json
from pathlib import Path

import numpy as np
import joblib

from train_xgb import fetch_polygon, add_features, FEATURE_COLS

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"


def _load(prefix: str, ticker: str):
    """Carga un modelo (xgb_ o mlp_) si existe; si no, None."""
    p = ARTIFACT_DIR / f"{prefix}_{ticker.upper()}.joblib"
    return joblib.load(p) if p.exists() else None


def validate_models(ticker: str, days: int = 60) -> dict:
    """Backtest 1-paso de XGBoost y MLP sobre los últimos 'days' días."""
    xgb = _load("xgb", ticker)
    mlp = _load("mlp", ticker)
    if xgb is None and mlp is None:
        raise FileNotFoundError(
            f"No hay modelos para {ticker.upper()}. Entrena XGBoost y/o MLP primero.")

    raw = fetch_polygon(ticker, years=1)
    df = add_features(raw).dropna().reset_index(drop=True)

    closes = df["close"].values
    dates = [d.date().isoformat() for d in df["date"]]
    n = len(df)
    start = max(1, n - days)

    series = []
    xgb_pred_r, mlp_pred_r, true_r = [], [], []
    for t in range(start, n):
        feats = df[FEATURE_COLS].iloc[[t - 1]].values      # features de ayer
        prev_close = float(closes[t - 1])
        real = float(closes[t])
        row = {"date": dates[t], "actual": round(real, 4)}

        real_ret = np.log(real / prev_close)
        true_r.append(real_ret)

        if xgb is not None:
            r = float(xgb.predict(feats)[0])
            row["xgb"] = round(prev_close * np.exp(r), 4)
            xgb_pred_r.append(r)
        if mlp is not None:
            r = float(mlp.predict(feats)[0])
            row["mlp"] = round(prev_close * np.exp(r), 4)
            mlp_pred_r.append(r)
        series.append(row)

    def metrics(pred_ret):
        if not pred_ret:
            return None
        pr = np.array(pred_ret)
        tr = np.array(true_r[:len(pr)])
        # MAPE sobre el precio reconstruido
        prev = closes[start - 1:start - 1 + len(pr)]
        pred_price = prev * np.exp(pr)
        real_price = prev * np.exp(tr)
        mape = float(np.mean(np.abs((pred_price - real_price) / real_price)))
        dir_acc = float(np.mean(np.sign(pr) == np.sign(tr)))
        return {"mape": round(mape, 4), "directional_accuracy": round(dir_acc, 4),
                "n": int(len(pr))}

    return {
        "ticker": ticker.upper(),
        "days": days,
        "series": series,
        "metrics": {
            "xgb": metrics(xgb_pred_r),
            "mlp": metrics(mlp_pred_r),
        },
        "note": "Validación 1-paso: cada punto es la predicción a 1 día vs. el precio real.",
    }
