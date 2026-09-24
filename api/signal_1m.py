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
import time
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "training"))
from features_1m_dir import (  # noqa: E402
    FEATURE_COLS, TICKERS, CONTEXT_SYMBOLS, HISTORY_SESSIONS, BARS_PER_SESSION, build_features,
)
from data_1m import fetch_bars, merge_bars, last_sessions  # noqa: E402
from news_1m import fetch_news  # noqa: E402

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts" / "1m_dir"
_CACHE: dict = {}

# Las sesiones pasadas no cambian: cachearlas varias horas evita re-descargar
# ~HISTORY_SESSIONS días de 1 min en cada llamada a /signal-1m.
HISTORY_TTL = 6 * 3600

# C1: caché de proceso de los DataFrames YA PARSEADOS de historia (sesión
# regular), separada de polygon_client._cache. polygon_client cachea el JSON
# CRUDO por URL —~45 MB por ticker con ~150 días de 1 min— y sus claves
# cambian a diario, así que ese caché de proceso se llenaría sin límite y
# puede OOM-matar la instancia gratuita (512 MB). Aquí se pide con
# `store=False` (no entra al caché de polygon_client) y se guarda solo el
# DataFrame ya recortado a sesión regular (unos pocos MB), por (symbol,
# start, ayer), con el mismo TTL.
_HISTORY_CACHE: dict[tuple, tuple[float, pd.DataFrame]] = {}


def _evict_expired_history(now: float) -> None:
    expired = [k for k, (ts, _) in _HISTORY_CACHE.items() if now - ts > HISTORY_TTL]
    for k in expired:
        del _HISTORY_CACHE[k]

NOTE = ("Dirección a 5/15/30 min con probabilidad. Datos con ~15 min de retraso "
        "(plan Starter). Solo los horizontes con has_edge superaron a los baselines "
        "fuera de muestra; aun así es contexto, no una señal de entrada.")


def _recent_bars(symbol: str, today: dt.date) -> pd.DataFrame:
    """Últimas HISTORY_SESSIONS sesiones de `symbol`: historia con TTL largo
    (no cambia) + la sesión de hoy con TTL corto (sigue formándose).

    Ambos fetch piden con `store=False`: el JSON crudo de Polygon no se queda
    en polygon_client._cache (ver comentario de _HISTORY_CACHE). La historia
    ya parseada sí se cachea aquí, para no volver a pedir ~150 días de 1 min
    en cada llamada dentro de HISTORY_TTL.
    """
    start = today - dt.timedelta(days=int(HISTORY_SESSIONS * 1.6) + 7)
    yesterday = today - dt.timedelta(days=1)
    key = (symbol, start, yesterday)
    now = time.time()
    cached = _HISTORY_CACHE.get(key)
    if cached and now - cached[0] < HISTORY_TTL:
        history = cached[1]
    else:
        history = fetch_bars(symbol, start, yesterday, ttl=HISTORY_TTL, store=False)
        write_ts = time.time()
        _evict_expired_history(write_ts)
        _HISTORY_CACHE[key] = (write_ts, history)
    live = fetch_bars(symbol, today, today, ttl=60, store=False)
    return last_sessions(merge_bars(history, live), HISTORY_SESSIONS)


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
        raw_abs_mean = hm["abs_ret_mean"].get(t)
        abs_mean = (float(raw_abs_mean) if raw_abs_mean is not None
                    else float(np.median(list(hm["abs_ret_mean"].values()))))
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

    today = dt.date.today()
    start = today - dt.timedelta(days=int(HISTORY_SESSIONS * 1.6) + 7)
    bars = {s: _recent_bars(s, today) for s in {t, *CONTEXT_SYMBOLS}}
    news = fetch_news(t, start)

    feat = build_features(bars[t], t, bars, news)
    if feat.empty:
        raise ValueError(f"Sin historia suficiente de 1 min para {t}.")
    out = signal_from_features(models, meta, feat.iloc[[-1]], t)
    out["generated_at"] = dt.datetime.utcnow().isoformat() + "Z"
    return out
