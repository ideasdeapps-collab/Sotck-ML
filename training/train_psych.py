"""
train_psych.py — Entrena el modelo psicológico APRENDIDO (Opción B del IPM)
===========================================================================
Aprende la relación entre el estado psicológico y el retorno futuro a N días:

    r_{t+N} = f(IPM_t, ΔIPM_t, IPM_t²)

con un GradientBoostingRegressor ligero (sin deps nuevas: sklearn ya está).
Guarda psych_<TICKER>.joblib + meta_psych_<TICKER>.json en api/artifacts/.

Uso: python training/train_psych.py --ticker NVDA --years 2 --horizon 21
"""

import os
import sys
import json
import argparse
import datetime as dt
from pathlib import Path

import numpy as np
import joblib
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score

# Importa el motor de sensores/IPM desde api/
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "api"))
from psychology import compute_sensors, compute_ipm  # noqa: E402
from train_xgb import fetch_polygon                    # noqa: E402

ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


def train(ticker: str, years: int = 2, horizon: int = 21) -> dict:
    print(f"[1/4] Descargando {ticker}...")
    raw = fetch_polygon(ticker, years)

    print("[2/4] Calculando IPM y features psicológicas...")
    sensors = compute_sensors(raw, sentiment_score=0.0)   # técnico (sin noticias históricas)
    ipm = compute_ipm(sensors).reset_index(drop=True)
    close = raw["close"].reset_index(drop=True)

    # Features: [IPM, ΔIPM, IPM²]  | Target: retorno log acumulado a 'horizon' días
    dipm = ipm.diff().fillna(0.0)
    X, y = [], []
    n = len(close)
    for t in range(1, n - horizon):
        X.append([ipm.iloc[t], dipm.iloc[t], ipm.iloc[t] ** 2])
        y.append(float(np.log(close.iloc[t + horizon] / close.iloc[t])))
    X, y = np.array(X), np.array(y)
    if len(X) < 60:
        raise ValueError("Histórico insuficiente para entrenar el modelo psicológico.")

    split = int(len(X) * 0.8)
    print(f"[3/4] Entrenando GradientBoosting sobre {split} muestras...")
    model = GradientBoostingRegressor(
        n_estimators=200, max_depth=3, learning_rate=0.03,
        subsample=0.8, random_state=42)
    model.fit(X[:split], y[:split])

    pred = model.predict(X[split:])
    mae = float(mean_absolute_error(y[split:], pred))
    r2 = float(r2_score(y[split:], pred))
    dir_acc = float(np.mean(np.sign(pred) == np.sign(y[split:])))

    print("[4/4] Guardando artefactos...")
    joblib.dump(model, ARTIFACT_DIR / f"psych_{ticker.upper()}.joblib")
    meta = {"ticker": ticker.upper(), "model": "GradientBoosting(IPM,ΔIPM,IPM²)",
            "trained_at": dt.datetime.utcnow().isoformat() + "Z",
            "horizon": horizon, "n_samples": int(len(X)),
            "metrics": {"mae": mae, "r2": r2, "directional_accuracy": dir_acc}}
    with open(ARTIFACT_DIR / f"meta_psych_{ticker.upper()}.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\n[OK] {ticker.upper()} (psych) | MAE={mae:.5f} | R2={r2:.3f} | Dir.Acc={dir_acc:.1%}")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="NVDA")
    ap.add_argument("--years", type=int, default=2)
    ap.add_argument("--horizon", type=int, default=21)
    args = ap.parse_args()
    train(args.ticker, args.years, args.horizon)
