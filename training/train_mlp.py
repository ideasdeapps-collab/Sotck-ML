"""
train_mlp.py — Red neuronal (MLP) para predecir el retorno log del día siguiente
================================================================================
Modelo gemelo al de XGBoost pero con una RED NEURONAL (MLPRegressor de sklearn).
Usa las MISMAS features (train_xgb.add_features / FEATURE_COLS) para que ambas
curvas sean comparables.

Clave técnica: las redes neuronales necesitan features escaladas, así que el
modelo se guarda como un Pipeline(StandardScaler + MLPRegressor) — el escalado
queda "horneado" dentro, y en inferencia basta llamar pipeline.predict(X).

NO añade dependencias nuevas: scikit-learn ya está en requirements.txt.
Corre en el plan gratuito de Render (es ligero, entrena en segundos).

Uso: python training/train_mlp.py --ticker NVDA --years 2
Genera: api/artifacts/mlp_<TICKER>.joblib  +  meta_mlp_<TICKER>.json
"""

import json
import argparse
import datetime as dt
from pathlib import Path

import numpy as np
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

from train_xgb import fetch_polygon, add_features, FEATURE_COLS

ARTIFACT_DIR = Path(__file__).resolve().parent.parent / "api" / "artifacts"
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)


def train(ticker: str, years: int = 2) -> dict:
    print(f"[1/4] Descargando {ticker} desde Polygon...")
    raw = fetch_polygon(ticker, years)

    print("[2/4] Generando features...")
    df = add_features(raw).dropna().reset_index(drop=True)
    X = df[FEATURE_COLS].values
    y = df["target"].values

    # Split temporal (sin barajar): 80% train / 20% test
    split = int(len(X) * 0.8)
    X_tr, X_te, y_tr, y_te = X[:split], X[split:], y[:split], y[split:]

    print("[3/4] Entrenando red neuronal (MLP)...")
    # StandardScaler + MLP: 2 capas ocultas (64, 32) con regularización L2.
    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("mlp", MLPRegressor(
            hidden_layer_sizes=(64, 32),
            activation="relu",
            solver="adam",
            alpha=1e-3,                 # regularización L2 (evita overfit)
            learning_rate_init=0.005,
            max_iter=600,
            early_stopping=True,        # corta si deja de mejorar en validación
            validation_fraction=0.15,
            n_iter_no_change=25,
            random_state=42,
        )),
    ])
    pipe.fit(X_tr, y_tr)

    pred = pipe.predict(X_te)
    mae = float(mean_absolute_error(y_te, pred))
    r2 = float(r2_score(y_te, pred))
    dir_acc = float(np.mean(np.sign(pred) == np.sign(y_te)))

    print("[4/4] Guardando artefactos...")
    joblib.dump(pipe, ARTIFACT_DIR / f"mlp_{ticker.upper()}.joblib")
    meta = {
        "ticker": ticker.upper(),
        "model": "MLPRegressor(64,32)",
        "trained_at": dt.datetime.utcnow().isoformat() + "Z",
        "n_samples": int(len(X)),
        "last_close": float(raw["close"].iloc[-1]),
        "last_date": raw["date"].iloc[-1].date().isoformat(),
        "n_iter": int(pipe.named_steps["mlp"].n_iter_),
        "metrics": {"mae": mae, "r2": r2, "directional_accuracy": dir_acc},
    }
    with open(ARTIFACT_DIR / f"meta_mlp_{ticker.upper()}.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"\n[OK] {ticker.upper()} (MLP) | MAE={mae:.5f} | R2={r2:.3f} | "
          f"Dir.Acc={dir_acc:.1%} | iters={meta['n_iter']}")
    return meta


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", default="NVDA")
    ap.add_argument("--years", type=int, default=2)
    args = ap.parse_args()
    train(args.ticker, args.years)
