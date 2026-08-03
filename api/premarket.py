"""
premarket.py — Predicción del día anclada al PREMARKET (XGBoost + MLP)
=====================================================================
IMPORTANTE (honestidad del modelo):
Los modelos XGBoost/MLP son DIARIOS: entrenados con features de velas de día
completo para predecir el retorno del día siguiente. NO son modelos minuto-a-minuto.

Lo que hace este módulo, que SÍ es defendible:
  1) Obtiene el objetivo del día de cada modelo (target de cierre) a partir del
     último cierre diario y las features diarias.
  2) Trae las barras de PREMARKET de hoy (Polygon aggs minute, sesión < 09:30 ET).
  3) Ancla: compara el precio premarket en vivo con el target del modelo, calcula
     el GAP de apertura y si el premarket CONFIRMA o CONTRADICE cada modelo.
  4) Devuelve una trayectoria simple (premarket_last → target) solo para visual.

Plan gratuito Polygon: barras con ~15 min de retraso; el premarket es 04:00-09:30 ET.
"""

from __future__ import annotations
import os
import datetime as dt

import numpy as np
import pandas as pd
import joblib
from pathlib import Path

from polygon_client import get_json, TTL_INTRADAY
from train_xgb import fetch_polygon, add_features, FEATURE_COLS

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")
ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"


def _load(prefix: str, ticker: str):
    p = ARTIFACT_DIR / f"{prefix}_{ticker.upper()}.joblib"
    return joblib.load(p) if p.exists() else None


def _fetch_premarket_bars(ticker: str) -> pd.DataFrame:
    """Barras de 5 min de hoy; filtra la sesión premarket (04:00–09:30 ET)."""
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta POLYGON_API_KEY")
    today = dt.date.today()
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/5/minute/"
           f"{today.isoformat()}/{today.isoformat()}"
           f"?adjusted=true&sort=asc&limit=5000&apiKey={POLYGON_API_KEY}")
    res = get_json(url, ttl=TTL_INTRADAY).get("results", [])
    if not res:
        return pd.DataFrame()
    df = pd.DataFrame(res).rename(columns={"o": "open", "h": "high", "l": "low",
                                           "c": "close", "v": "volume", "t": "timestamp"})
    df["dt_et"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True).dt.tz_convert("America/New_York")
    # Premarket = antes de las 09:30 ET
    mask = (df["dt_et"].dt.hour < 9) | ((df["dt_et"].dt.hour == 9) & (df["dt_et"].dt.minute < 30))
    return df[mask].reset_index(drop=True)


def premarket_prediction(ticker: str) -> dict:
    """Objetivo del día (XGBoost + MLP) anclado al precio premarket en vivo."""
    xgb = _load("xgb", ticker)
    mlp = _load("mlp", ticker)
    if xgb is None and mlp is None:
        raise FileNotFoundError(f"No hay modelos para {ticker.upper()}. Entrena XGBoost/MLP primero.")

    # 1) Features diarias hasta el último cierre
    raw = fetch_polygon(ticker, years=1)
    df = add_features(raw).dropna().reset_index(drop=True)
    x = df[FEATURE_COLS].iloc[[-1]].values
    prev_close = float(raw["close"].iloc[-1])
    prev_date = raw["date"].iloc[-1].date().isoformat()

    def target(model):
        if model is None:
            return None
        r = float(model.predict(x)[0])
        return {"ret": round(r, 5), "pct": round((np.exp(r) - 1) * 100, 3),
                "target_price": round(prev_close * np.exp(r), 4)}

    xgb_t = target(xgb)
    mlp_t = target(mlp)

    # 2) Premarket de hoy
    pm = _fetch_premarket_bars(ticker)
    has_pm = not pm.empty
    pm_last = round(float(pm["close"].iloc[-1]), 4) if has_pm else None
    gap_pct = round((pm_last / prev_close - 1) * 100, 3) if has_pm else None

    # 3) Confirmación premarket vs modelo
    def confirm(t):
        if not t or not has_pm:
            return None
        model_dir = np.sign(t["ret"])
        pm_dir = np.sign(gap_pct)
        if model_dir == 0:
            return "neutral"
        return "confirma" if model_dir == pm_dir else "contradice"

    # 4) Trayectoria simple premarket_last -> target (solo visual)
    def path(t):
        if not t:
            return []
        base = pm_last if has_pm else prev_close
        return [{"t": "ahora", "price": round(base, 4)},
                {"t": "cierre_est", "price": t["target_price"]}]

    return {
        "ticker": ticker.upper(),
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "prev_close": prev_close,
        "prev_date": prev_date,
        "premarket_available": has_pm,
        "premarket_last": pm_last,
        "gap_pct": gap_pct,
        "premarket_bars": [
            {"time": r["dt_et"].isoformat(), "close": round(float(r["close"]), 4)}
            for _, r in pm.iterrows()
        ] if has_pm else [],
        "models": {
            "xgb": {**(xgb_t or {}), "confirmation": confirm(xgb_t), "path": path(xgb_t)} if xgb_t else None,
            "mlp": {**(mlp_t or {}), "confirmation": confirm(mlp_t), "path": path(mlp_t)} if mlp_t else None,
        },
        "note": ("Modelos DIARIOS anclados al premarket. El plan gratuito difiere el dato "
                 "~15 min. Sin sesión premarket activa, se muestra el objetivo desde el "
                 "último cierre."),
    }
