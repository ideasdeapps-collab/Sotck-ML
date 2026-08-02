"""
signals.py — Señales combinadas (XGBoost diario × estructura intradía)
======================================================================
Cruza dos horizontes para generar alertas más robustas por CONFLUENCIA:

  SESGO DIARIO (XGBoost):  dirección esperada del próximo día + confianza.
  ESTRUCTURA INTRADÍA:     tendencia (HH/HL), VWAP, breakouts con volumen,
                           patrones de price action.

Produce:
  - Una CURVA DE SEÑAL (score por vela) = suma de contribuciones alineadas.
  - ALERTAS de alta confianza cuando el intradía CONFIRMA el sesgo diario
    (ej. "predicción alcista + breakout de resistencia con volumen").
  - Un VEREDICTO actual: STRONG BUY / BUY / NEUTRAL / SELL / STRONG SELL.

Diseñado para el plan GRATUITO de Polygon:
  - Reusa el cliente con rate-limit (5/min) + caché.
  - 2 llamadas por ticker como máximo (1 diaria cacheada 1h, 1 intradía 15m).
  - Intervalo por defecto de 15 min (el dato viene diferido 15 min de todos modos).
"""

from __future__ import annotations
import json
from pathlib import Path

import numpy as np
import pandas as pd
import joblib

from intraday import analyze_intraday
from train_xgb import fetch_polygon, add_features, FEATURE_COLS

ARTIFACT_DIR = Path(__file__).resolve().parent / "artifacts"

# Pesos de las fuentes de confluencia (ajustables)
W_DAILY = 3.0        # sesgo diario XGBoost (escalado por confianza)
W_TREND = 1.5        # estructura de tendencia intradía
W_VWAP = 1.0         # posición respecto al VWAP
W_MOMENTUM = 1.0     # cierre vs SMA intradía
W_BREAKOUT = 3.0     # impulso por breakout con volumen (decae)
W_PATTERN = 1.5      # patrón de price action (decae)
DECAY_BARS = 6       # nº de velas en que decae el impulso de eventos


# --------------------------------------------------------------------------- #
# Sesgo diario desde el modelo XGBoost
# --------------------------------------------------------------------------- #
def _load_model(ticker: str):
    t = ticker.upper()
    mp = ARTIFACT_DIR / f"xgb_{t}.joblib"
    mm = ARTIFACT_DIR / f"meta_{t}.json"
    if not mp.exists() or not mm.exists():
        raise FileNotFoundError(
            f"No hay modelo para {t}. Corre: python training/train_xgb.py --ticker {t}")
    with open(mm) as f:
        meta = json.load(f)
    return joblib.load(mp), meta


def daily_bias(ticker: str) -> dict:
    """Predicción del retorno del próximo día + confianza (dir. accuracy)."""
    model, meta = _load_model(ticker)
    raw = fetch_polygon(ticker, years=1)                 # cacheado 1h
    df = add_features(raw).dropna().reset_index(drop=True)
    x = df[FEATURE_COLS].iloc[[-1]].values
    log_ret = float(model.predict(x)[0])
    conf = float(meta.get("metrics", {}).get("directional_accuracy", 0.5))

    if log_ret > 0.0005:
        label = "alcista"
    elif log_ret < -0.0005:
        label = "bajista"
    else:
        label = "neutral"
    return {
        "label": label,
        "predicted_next_return": round(log_ret, 5),
        "predicted_next_pct": round((np.exp(log_ret) - 1) * 100, 3),
        "confidence": round(conf, 4),
        "last_close": meta.get("last_close"),
        "sign": 1 if label == "alcista" else -1 if label == "bajista" else 0,
    }


# --------------------------------------------------------------------------- #
# Curva de señal por vela (confluencia)
# --------------------------------------------------------------------------- #
def _signal_curve(candles: list[dict], chartism: dict, bias: dict) -> list[dict]:
    n = len(candles)
    closes = np.array([c["close"] for c in candles], dtype=float)

    # SMA intradía para el componente de momentum
    sma_win = min(20, max(3, n // 5))
    sma = pd.Series(closes).rolling(sma_win, min_periods=1).mean().values

    # VWAP por vela: usa el del feed si viene; si no, lo aproxima acumulado.
    if all("vwap" in c for c in candles):
        vwap = np.array([c["vwap"] for c in candles], dtype=float)
    else:
        tp = np.array([(c["high"] + c["low"] + c["close"]) / 3 for c in candles])
        vol = np.array([max(c["volume"], 1) for c in candles], dtype=float)
        vwap = np.cumsum(tp * vol) / np.cumsum(vol)

    # Contribución constante de estructura de tendencia
    trend = chartism["structure"]["trend"]
    trend_sign = 1 if "alcista" in trend else -1 if "bajista" in trend else 0

    # Índices temporales para eventos (breakouts / patrones)
    tindex = {c["time"]: i for i, c in enumerate(candles)}

    # Impulsos por breakout (decaen linealmente durante DECAY_BARS)
    breakout_impulse = np.zeros(n)
    for b in chartism.get("breakouts", []):
        i = tindex.get(b["time"])
        if i is None:
            continue
        s = 1 if "alcista" in b["type"] else -1
        for k in range(DECAY_BARS):
            if i + k < n:
                breakout_impulse[i + k] += s * W_BREAKOUT * (1 - k / DECAY_BARS)

    # Impulsos por price action (decaen)
    pattern_impulse = np.zeros(n)
    for p in chartism.get("_patterns", []):
        i = tindex.get(p["time"])
        if i is None:
            continue
        s = 1 if p["bias"] == "alcista" else -1 if p["bias"] == "bajista" else 0
        for k in range(DECAY_BARS):
            if i + k < n:
                pattern_impulse[i + k] += s * W_PATTERN * (1 - k / DECAY_BARS)

    # Sesgo diario escalado por confianza (base, presente en toda la sesión)
    daily_component = bias["sign"] * W_DAILY * (2 * bias["confidence"] - 1)

    curve = []
    ema = 0.0
    alpha = 0.3
    for i in range(n):
        vwap_sign = 1 if closes[i] > vwap[i] else -1
        mom_sign = 1 if closes[i] > sma[i] else -1
        score = (daily_component
                 + trend_sign * W_TREND
                 + vwap_sign * W_VWAP
                 + mom_sign * W_MOMENTUM
                 + breakout_impulse[i]
                 + pattern_impulse[i])
        ema = alpha * score + (1 - alpha) * ema if i > 0 else score
        curve.append({
            "time": candles[i]["time"],
            "close": round(closes[i], 4),
            "score": round(float(score), 3),
            "score_ema": round(float(ema), 3),
            "vwap": round(float(vwap[i]), 4),
        })
    return curve


# --------------------------------------------------------------------------- #
# Alertas de alta confianza (confluencia diario × intradía)
# --------------------------------------------------------------------------- #
def _alerts(chartism: dict, bias: dict) -> list[dict]:
    alerts = []
    db = bias["sign"]

    for b in chartism.get("breakouts", []):
        bull = "alcista" in b["type"]
        aligned = (bull and db > 0) or (not bull and db < 0)
        reasons = [
            f"Predicción diaria {bias['label']} "
            f"({bias['predicted_next_pct']:+.2f}%, conf. {bias['confidence']:.0%})",
            f"{'Breakout de resistencia' if bull else 'Ruptura de soporte'} "
            f"en {b['level']} con volumen",
            f"Estructura intradía: {chartism['structure']['trend']}",
        ]
        strength = "ALTA" if aligned else "media"
        direction = "COMPRA" if bull else "VENTA"
        alerts.append({
            "time": b["time"],
            "direction": direction,
            "strength": strength,
            "aligned_with_daily": aligned,
            "trigger": b["type"],
            "level": b["level"],
            "price": b["price"],
            "reasons": reasons,
        })

    # Ordena: primero las alineadas (alta confianza), luego por hora desc.
    alerts.sort(key=lambda a: (not a["aligned_with_daily"], a["time"]), reverse=False)
    return alerts


def _verdict(curve: list[dict], bias: dict) -> dict:
    if not curve:
        return {"label": "SIN DATOS", "score": 0.0}
    last = curve[-1]["score_ema"]
    if last >= 4:
        label = "STRONG BUY"
    elif last >= 1.5:
        label = "BUY"
    elif last <= -4:
        label = "STRONG SELL"
    elif last <= -1.5:
        label = "SELL"
    else:
        label = "NEUTRAL"
    return {"label": label, "score": round(float(last), 3)}


# --------------------------------------------------------------------------- #
# Orquestador principal
# --------------------------------------------------------------------------- #
def combined_signals(ticker: str, interval: int = 15, days: int = 2) -> dict:
    """Devuelve curva de señal + alertas + veredicto para un ticker."""
    bias = daily_bias(ticker)                                  # 1 llamada (cacheada)
    intr = analyze_intraday(ticker, minutes=interval, days=days)  # 1 llamada (cacheada)

    chartism = intr["chartism"]
    chartism["_patterns"] = intr.get("price_action", [])       # para el score

    curve = _signal_curve(intr["candles_ohlc"], chartism, bias)
    alerts = _alerts(chartism, bias)
    verdict = _verdict(curve, bias)

    return {
        "ticker": ticker.upper(),
        "interval_min": interval,
        "generated_at": intr["generated_at"],
        "last_price": intr["last_price"],
        "daily_bias": bias,
        "intraday_structure": chartism["structure"],
        "session_vwap": intr.get("session_vwap"),
        "verdict": verdict,
        "signal_curve": curve,
        "alerts": alerts,
        "candles_ohlc": intr["candles_ohlc"],
        "support": chartism["support"],
        "resistance": chartism["resistance"],
        "note": "Plan gratuito Polygon: datos con ~15 min de retraso. "
                "No refresques más rápido que cada 15 min.",
    }


def scan_watchlist(tickers: list[str], interval: int = 15, days: int = 2) -> dict:
    """
    Escaneo ligero de una lista: solo veredicto + mejor alerta por ticker.
    OJO free tier: 2 llamadas/ticker máx., estranguladas a 5/min por el cliente.
    Un escaneo de 18 tickers tarda varios minutos (por diseño, para no romper).
    """
    rows, errors = [], []
    for t in tickers:
        try:
            s = combined_signals(t, interval=interval, days=days)
            top = next((a for a in s["alerts"] if a["aligned_with_daily"]), None)
            rows.append({
                "ticker": t.upper(),
                "verdict": s["verdict"]["label"],
                "score": s["verdict"]["score"],
                "daily_bias": s["daily_bias"]["label"],
                "trend": s["intraday_structure"]["trend"],
                "top_alert": (f"{top['direction']} · {top['trigger']} @ {top['level']}"
                              if top else None),
            })
        except Exception as e:
            errors.append({"ticker": t.upper(), "error": str(e)})
    # Ordena por score absoluto (señales más fuertes primero)
    rows.sort(key=lambda r: abs(r["score"]), reverse=True)
    return {"count": len(rows), "rows": rows, "errors": errors}
