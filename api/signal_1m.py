"""
signal_1m.py — Señal de DIRECCIÓN a 5/15/30 min (modelo de 1 minuto)
====================================================================
Calcula las features de la ÚLTIMA barra real con la misma función que el
entrenamiento (features_1m_dir.build_features) sobre HISTORY_SESSIONS sesiones
—la ventana mínima que reproduce exactamente la fila del entrenamiento, bajo
test— y devuelve p(sube) por horizonte, si el modelo está confiado y si ese
horizonte demostró ventaja fuera de muestra (`has_edge`).

`path_close` es un trazo indicativo, no un precio objetivo:
last_close·exp((2p−1)·E|r_h|).
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
from features_1m_dir import (  # noqa: E402
    FEATURE_COLS, TICKERS, CONTEXT_SYMBOLS, HISTORY_SESSIONS, BARS_PER_SESSION, build_features,
)
from data_1m import fetch_bars  # noqa: E402
from news_1m import fetch_news  # noqa: E402

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts" / "1m_dir"
_CACHE: dict = {}

NOTE = ("Dirección a 5/15/30 min con probabilidad. Datos con ~15 min de retraso "
        "(plan Starter). Solo los horizontes con has_edge superaron a los baselines "
        "fuera de muestra; aun así es contexto, no una señal de entrada.")


def load_models(artifact_dir: Path = ARTIFACT_DIR):
    key = str(artifact_dir)
    if key in _CACHE:
        return _CACHE[key]
    meta_path = artifact_dir / "meta.json"
    if not meta_path.exists():
        raise FileNotFoundError(
            "No hay modelo de dirección de 1 min. Corre el workflow "
            "'Train 1m direction model' o: python training/train_xgb_1m_dir.py")
    meta = json.loads(meta_path.read_text())
    # Mismo blindaje que load_1m_model: un orden de features distinto no falla
    # en XGBoost, solo sirve basura.
    if list(meta.get("feature_cols") or []) != list(FEATURE_COLS):
        raise FileNotFoundError(
            "El modelo de dirección de 1 min se entrenó con otras features; reentrena "
            "antes de servir señales: python training/train_xgb_1m_dir.py")
    models = {int(h): joblib.load(artifact_dir / f"xgb_h{h}.joblib") for h in meta["horizons"]}
    _CACHE[key] = (models, meta)
    return models, meta


def signal_from_features(models: dict, meta: dict, row: pd.DataFrame, ticker: str) -> dict:
    """Núcleo sin red: una fila de build_features → señal por horizonte."""
    t = ticker.upper()
    last_close = float(row["close"].iloc[0])
    sig = float(row["sig"].iloc[0])
    bars_left = BARS_PER_SESSION - 1 - int(row["bar_idx"].iloc[0])
    X = row[FEATURE_COLS]

    horizons = []
    for h in sorted(models):
        hm = meta["horizons"][str(h)]
        p = float(models[h].predict_proba(X)[0, 1])
        available = h <= bars_left
        abs_mean = hm["abs_ret_mean"].get(t) or float(np.median(list(hm["abs_ret_mean"].values())))
        horizons.append({
            "h": h, "p_up": round(p, 4), "direction": "up" if p >= 0.5 else "down",
            # Un horizonte que cae después del cierre no se puede resolver: nunca es confiado.
            "confident": bool(available and abs(p - 0.5) >= hm["tau"]),
            "available": bool(available), "tau": hm["tau"],
            "oos_precision": hm["holdout"]["precision"], "coverage": hm["holdout"]["coverage"],
            "has_edge": bool(hm["has_edge"]),
            "path_close": round(last_close * float(np.exp((2 * p - 1) * abs_mean)), 4),
            "dead_band": float(meta["dead_band"] * sig * np.sqrt(h)),
        })

    return {
        "ticker": t, "as_of": pd.Timestamp(row["dt_et"].iloc[0]).isoformat(),
        "last_close": round(last_close, 4), "sigma_1m": sig,
        "momentum_up": bool(row["ret_15_z"].iloc[0] >= 0),
        "horizons": horizons, "model_trained_at": meta.get("trained_at"), "note": NOTE,
    }


def predict_signal(ticker: str) -> dict:
    t = ticker.upper()
    models, meta = load_models()
    if t not in meta.get("tickers", TICKERS):
        raise FileNotFoundError(f"{t} no está entre los tickers del modelo de dirección de 1 min.")

    end = dt.date.today()
    start = end - dt.timedelta(days=int(HISTORY_SESSIONS * 1.6) + 7)
    bars = {s: fetch_bars(s, start, end) for s in {t, *CONTEXT_SYMBOLS}}
    news = fetch_news(t, start)

    feat = build_features(bars[t], t, bars, news)
    if feat.empty:
        raise ValueError(f"Sin historia suficiente de 1 min para {t}.")
    out = signal_from_features(models, meta, feat.iloc[[-1]], t)
    out["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    return out
