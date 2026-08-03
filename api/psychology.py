"""
psychology.py — Índice de Psicología de Mercado (IPM) + predicción conductual
=============================================================================
Implementa el algoritmo del documento IPM:

  7 SENSORES normalizados a [-1,+1]:
    S1 RSI (miedo/codicia) · S2 sentimiento · S3 manada(volumen) ·
    S4 momentum(racha) · S5 FOMO/capitulación(gap+vol) · S6 indecisión ·
    S7 anclaje a rango

  ÍNDICE:  IPM_t = 100 * tanh( Σ w_j · S_j )      (rango -100..+100)

  PREDICCIÓN:
    Opción A (directa, contrarian):
        r̂_{t+1} = -κ·sign(IPM)·max(0, (|IPM|-θ)/(100-θ))
    Opción B (aprendida, ML):
        r̂_{t+N} = f(IPM, ΔIPM, IPM²)   con GradientBoosting entrenado

El sentimiento (S2) es opcional: si se pasa un score externo (Polygon news),
se usa; si no, S2=0 y el resto de sensores siguen funcionando (todo técnico).
"""

from __future__ import annotations
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

from train_xgb import fetch_polygon

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"

# Pesos del IPM (del documento; suman 1)
W = {"S1": 0.20, "S2": 0.20, "S3": 0.15, "S4": 0.15, "S5": 0.15, "S6": 0.05, "S7": 0.10}

# Parámetros de la señal contrarian directa (Opción A)
KAPPA = 0.02      # escala de magnitud del retorno contrarian
THETA = 60.0      # umbral de "extremo" (|IPM|>θ dispara señal)


# --------------------------------------------------------------------------- #
# Utilidades técnicas
# --------------------------------------------------------------------------- #
def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(n).mean()
    loss = (-delta.clip(upper=0)).rolling(n).mean()
    rs = gain / (loss + 1e-9)
    return 100 - (100 / (1 + rs))


def compute_sensors(df: pd.DataFrame, sentiment_score: float = 0.0) -> pd.DataFrame:
    """Calcula los 7 sensores (columnas S1..S7) para cada fila de df (OHLCV)."""
    out = pd.DataFrame(index=df.index)
    c, o, h, l, v = df["close"], df["open"], df["high"], df["low"], df["volume"]
    ret = np.log(c / c.shift(1))

    # S1 — RSI (miedo/codicia)
    out["S1"] = (_rsi(c, 14) - 50) / 50

    # S2 — sentimiento (externo; constante en la ventana si se provee)
    out["S2"] = float(np.clip(sentiment_score, -1, 1))

    # S3 — manada (volumen anómalo en dirección del retorno)
    vmean = v.rolling(20).mean()
    vstd = v.rolling(20).std() + 1e-9
    out["S3"] = np.tanh((v - vmean) / vstd) * np.sign(ret)

    # S4 — momentum conductual (racha de velas mismo color)
    sign = np.sign(ret).fillna(0)
    racha = sign.rolling(5).sum()
    out["S4"] = np.tanh(racha / 5.0)

    # S5 — FOMO/capitulación (gap de apertura + volumen alto)
    gap = (o - c.shift(1)) / c.shift(1)
    vol_hi = (v > 1.5 * vmean).astype(float)
    out["S5"] = np.sign(gap) * np.minimum(np.abs(gap) / 0.03, 1.0) * vol_hi

    # S6 — indecisión (cuerpo pequeño vs rango) — resta convicción (negativo)
    out["S6"] = -(np.abs(c - o) / (h - l + 1e-9))

    # S7 — anclaje a máximos/mínimos (posición en rango de 20)
    hh = h.rolling(20).max()
    ll = l.rolling(20).min()
    out["S7"] = 2 * (c - ll) / (hh - ll + 1e-9) - 1

    return out.fillna(0.0)


def compute_ipm(sensors: pd.DataFrame) -> pd.Series:
    """IPM_t = 100 * tanh( Σ w_j S_j ), rango -100..+100."""
    z = sum(W[k] * sensors[k] for k in W)
    return 100.0 * np.tanh(z)


def _zone(ipm: float) -> str:
    if ipm >= 70:
        return "euforia extrema"
    if ipm >= 30:
        return "optimismo"
    if ipm > -30:
        return "neutral"
    if ipm > -70:
        return "pesimismo"
    return "pánico extremo"


# --------------------------------------------------------------------------- #
# Opción A — Señal contrarian directa
# --------------------------------------------------------------------------- #
def contrarian_direct(ipm_last: float, last_close: float, dates: list[str],
                      kappa: float = KAPPA, theta: float = THETA):
    """
    Proyecta una curva desde last_close aplicando el retorno contrarian directo.
    Solo hay señal si |IPM|>θ; si no, la curva queda plana (psicología 'calla').
    """
    excess = max(0.0, (abs(ipm_last) - theta) / (100.0 - theta))
    daily_ret = -kappa * np.sign(ipm_last) * excess     # contrarian: euforia->baja
    out, price = [], float(last_close)
    for d in dates:
        price *= float(np.exp(daily_ret))
        out.append({"date": d, "close": round(price, 4)})
    return out, float(daily_ret)


# --------------------------------------------------------------------------- #
# Opción B — Modelo aprendido (ML)
# --------------------------------------------------------------------------- #
def load_psych_model(ticker: str):
    p = ARTIFACT_DIR / f"psych_{ticker.upper()}.joblib"
    return joblib.load(p) if p.exists() else None


def learned_curve(ticker: str, ipm_series: pd.Series, last_close: float,
                  dates: list[str]):
    """
    Usa el modelo psych_<TICKER> (si existe) para proyectar el retorno a N días
    con features [IPM, ΔIPM, IPM²]. Aplica el retorno diariamente (suavizado).
    """
    model = load_psych_model(ticker)
    if model is None:
        return None, None
    ipm = float(ipm_series.iloc[-1])
    dipm = float(ipm_series.iloc[-1] - ipm_series.iloc[-2]) if len(ipm_series) > 1 else 0.0
    X = np.array([[ipm, dipm, ipm * ipm]])
    total_ret = float(model.predict(X)[0])          # retorno acumulado previsto a N días
    n = max(1, len(dates))
    daily = total_ret / n                            # repartido linealmente
    out, price = [], float(last_close)
    for d in dates:
        price *= float(np.exp(daily))
        out.append({"date": d, "close": round(price, 4)})
    # FIX: el nombre de metadatos coincide con el que guarda train_psych.py
    meta_path = ARTIFACT_DIR / f"meta_psych_{ticker.upper()}.json"
    meta = json.load(open(meta_path)) if meta_path.exists() else {}
    return out, {"predicted_total_return": round(total_ret, 5), "meta": meta.get("metrics", {})}


# --------------------------------------------------------------------------- #
# Orquestador principal
# --------------------------------------------------------------------------- #
def psychology_analysis(ticker: str, horizon: int = 21, sentiment_score: float = 0.0,
                        history_days: int = 120) -> dict:
    """
    Devuelve:
      - ipm_history: serie IPM histórica (para el panel oscilador)
      - contrarian:  curva Opción A (directa)
      - learned:     curva Opción B (ML) si hay modelo
      - sensors_last: valores actuales de los 7 sensores
      - zone / verdict
    """
    raw = fetch_polygon(ticker, years=1)
    sensors = compute_sensors(raw, sentiment_score=sentiment_score)
    ipm = compute_ipm(sensors)

    last_close = float(raw["close"].iloc[-1])
    ipm_last = float(ipm.iloc[-1])

    # Fechas futuras (días hábiles)
    cur = pd.to_datetime(raw["date"].iloc[-1]); fdates = []
    for _ in range(horizon):
        cur += pd.Timedelta(days=1)
        while cur.weekday() >= 5:
            cur += pd.Timedelta(days=1)
        fdates.append(cur.date().isoformat())

    contrarian, cdaily = contrarian_direct(ipm_last, last_close, fdates)
    learned, lmeta = learned_curve(ticker, ipm, last_close, fdates)

    # Historia del IPM para el oscilador
    tail = raw.tail(history_days)
    ipm_hist = [{"date": d.date().isoformat(), "ipm": round(float(x), 2)}
                for d, x in zip(tail["date"], ipm.tail(history_days))]

    s_last = sensors.iloc[-1]
    sensors_last = {k: round(float(s_last[k]), 3) for k in W}

    return {
        "ticker": ticker.upper(),
        "last_close": last_close,
        "ipm_now": round(ipm_last, 2),
        "zone": _zone(ipm_last),
        "delta_ipm": round(float(ipm.iloc[-1] - ipm.iloc[-2]) if len(ipm) > 1 else 0.0, 2),
        "weights": W,
        "sensors_last": sensors_last,
        "ipm_history": ipm_hist,
        "contrarian": {"curve": contrarian, "daily_ret": round(cdaily, 6),
                       "active": abs(ipm_last) > THETA, "theta": THETA, "kappa": KAPPA},
        "learned": ({"curve": learned, **lmeta} if learned is not None else None),
        "note": ("IPM contrarian: valores extremos (>|60|) anticipan reversión. "
                 "La curva 'aprendida' requiere entrenar psych_<TICKER> (train_psych.py)."),
    }
