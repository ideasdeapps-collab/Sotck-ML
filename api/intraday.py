"""
intraday.py — Curva intradía con chartismo + price action
==========================================================
Descarga barras por minuto de Polygon y detecta:

  CHARTISMO (estructura de mercado):
    - Pivotes fractales (swing highs / lows) de 5 velas
    - Niveles de soporte y resistencia (clustering de pivotes)
    - Estructura de tendencia (HH/HL alcista, LH/LL bajista)
    - Breakouts de soporte/resistencia con confirmación de volumen

  PRICE ACTION (patrones de vela):
    - Martillo / Shooting Star (pin bars)
    - Envolvente alcista / bajista (bullish/bearish engulfing)
    - Doji
    - Estrella de la mañana / del atardecer (3 velas)

Referencias de metodología: fractales para S/R y breakout con volumen.
"""

from __future__ import annotations
import os
import datetime as dt
from pathlib import Path

import numpy as np
import pandas as pd

from polygon_client import get_json, TTL_INTRADAY

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")


# --------------------------------------------------------------------------- #
# 1. Ingesta de barras por minuto (Polygon Aggregates)
# --------------------------------------------------------------------------- #
def fetch_intraday(ticker: str, minutes: int = 1, days: int = 1) -> pd.DataFrame:
    """
    Descarga barras intradía (OHLCV) desde Polygon.
    minutes = tamaño de la vela (1, 5, 15...). days = ventana hacia atrás.
    Endpoint: /v2/aggs/ticker/{t}/range/{mult}/minute/{from}/{to}
    """
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta la variable de entorno POLYGON_API_KEY")

    end = dt.date.today()
    start = end - dt.timedelta(days=max(days, 1))
    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/"
        f"{minutes}/minute/{start.isoformat()}/{end.isoformat()}"
        f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}"
    )
    # get_json respeta el límite de 5 llamadas/min y cachea 15 min (dato diferido).
    res = get_json(url, ttl=TTL_INTRADAY).get("results", [])
    if not res:
        raise ValueError(
            f"Polygon no devolvió barras intradía para {ticker}. "
            f"En plan gratuito el dato viene con 15 min de retraso y solo hay "
            f"histórico de 2 años; verifica que sea día/hora hábil de mercado.")

    df = pd.DataFrame(res).rename(columns={
        "o": "open", "h": "high", "l": "low", "c": "close",
        "v": "volume", "t": "timestamp", "vw": "vwap"})
    df["dt"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    # Convertir a hora de mercado (Eastern) para etiquetas legibles
    df["dt_et"] = df["dt"].dt.tz_convert("America/New_York")
    keep = ["dt_et", "open", "high", "low", "close", "volume"]
    if "vwap" in df.columns:
        keep.append("vwap")
    return df[keep].reset_index(drop=True)


# --------------------------------------------------------------------------- #
# 2. CHARTISMO: pivotes fractales -> soporte / resistencia
# --------------------------------------------------------------------------- #
def find_fractals(df: pd.DataFrame, left: int = 2, right: int = 2) -> dict:
    """
    Detecta swing highs/lows con el método fractal:
    una vela es pivote alto si su 'high' es el mayor de la ventana (left+right).
    """
    highs, lows = [], []
    n = len(df)
    for i in range(left, n - right):
        win_h = df["high"].iloc[i - left:i + right + 1]
        win_l = df["low"].iloc[i - left:i + right + 1]
        if df["high"].iloc[i] == win_h.max():
            highs.append({"idx": i, "time": df["dt_et"].iloc[i].isoformat(),
                          "price": round(float(df["high"].iloc[i]), 4)})
        if df["low"].iloc[i] == win_l.min():
            lows.append({"idx": i, "time": df["dt_et"].iloc[i].isoformat(),
                         "price": round(float(df["low"].iloc[i]), 4)})
    return {"swing_highs": highs, "swing_lows": lows}


def cluster_levels(pivots: list[dict], tol: float = 0.003) -> list[dict]:
    """
    Agrupa pivotes cercanos (dentro de 'tol' relativo) en niveles S/R,
    ponderando por cuántas veces se ha tocado el nivel (fuerza).
    """
    if not pivots:
        return []
    prices = sorted(p["price"] for p in pivots)
    clusters, cur = [], [prices[0]]
    for p in prices[1:]:
        if abs(p - cur[-1]) / cur[-1] <= tol:
            cur.append(p)
        else:
            clusters.append(cur)
            cur = [p]
    clusters.append(cur)
    return [{"level": round(float(np.mean(c)), 4), "touches": len(c)}
            for c in clusters]


def market_structure(fractals: dict) -> dict:
    """Determina la tendencia según secuencia de swings (HH/HL vs LH/LL)."""
    highs = [h["price"] for h in fractals["swing_highs"]][-3:]
    lows = [l["price"] for l in fractals["swing_lows"]][-3:]
    trend = "lateral"
    if len(highs) >= 2 and len(lows) >= 2:
        hh = highs[-1] > highs[-2]
        hl = lows[-1] > lows[-2]
        lh = highs[-1] < highs[-2]
        ll = lows[-1] < lows[-2]
        if hh and hl:
            trend = "alcista (HH/HL)"
        elif lh and ll:
            trend = "bajista (LH/LL)"
    return {"trend": trend,
            "last_highs": [round(x, 4) for x in highs],
            "last_lows": [round(x, 4) for x in lows]}


def detect_breakouts(df: pd.DataFrame, levels: dict, vol_mult: float = 1.5) -> list[dict]:
    """
    Marca velas que rompen un nivel de resistencia (al alza) o soporte (a la baja)
    con volumen >= vol_mult * volumen medio (confirmación).
    """
    if df.empty:
        return []
    avg_vol = df["volume"].rolling(20, min_periods=5).mean()
    res_levels = [l["level"] for l in levels.get("resistance", [])]
    sup_levels = [l["level"] for l in levels.get("support", [])]
    signals = []
    for i in range(1, len(df)):
        c0, c1 = df["close"].iloc[i - 1], df["close"].iloc[i]
        vol_ok = df["volume"].iloc[i] >= vol_mult * (avg_vol.iloc[i] or 1e9)
        for lvl in res_levels:
            if c0 <= lvl < c1 and vol_ok:
                signals.append({"time": df["dt_et"].iloc[i].isoformat(),
                                "type": "breakout_alcista", "level": lvl,
                                "price": round(float(c1), 4)})
        for lvl in sup_levels:
            if c0 >= lvl > c1 and vol_ok:
                signals.append({"time": df["dt_et"].iloc[i].isoformat(),
                                "type": "breakdown_bajista", "level": lvl,
                                "price": round(float(c1), 4)})
    return signals


# --------------------------------------------------------------------------- #
# 3. PRICE ACTION: patrones de vela
# --------------------------------------------------------------------------- #
def detect_candles(df: pd.DataFrame) -> list[dict]:
    """Reconoce patrones de vela clásicos (1, 2 y 3 velas)."""
    out = []
    o, h, l, c = (df["open"].values, df["high"].values,
                  df["low"].values, df["close"].values)
    n = len(df)

    def body(i): return abs(c[i] - o[i])
    def rng(i): return (h[i] - l[i]) or 1e-9
    def upper(i): return h[i] - max(c[i], o[i])
    def lower(i): return min(c[i], o[i]) - l[i]

    for i in range(n):
        t = df["dt_et"].iloc[i].isoformat()

        # --- 1 vela ---
        # Martillo: cuerpo pequeño arriba, mecha inferior larga
        if lower(i) > 2 * body(i) and upper(i) < body(i):
            out.append({"time": t, "pattern": "martillo", "bias": "alcista"})
        # Shooting star: mecha superior larga
        elif upper(i) > 2 * body(i) and lower(i) < body(i):
            out.append({"time": t, "pattern": "shooting_star", "bias": "bajista"})
        # Doji: cuerpo casi nulo
        elif body(i) <= 0.1 * rng(i):
            out.append({"time": t, "pattern": "doji", "bias": "indecision"})

        # --- 2 velas: envolvente ---
        if i >= 1:
            bull_engulf = (c[i - 1] < o[i - 1] and c[i] > o[i]
                           and c[i] >= o[i - 1] and o[i] <= c[i - 1])
            bear_engulf = (c[i - 1] > o[i - 1] and c[i] < o[i]
                           and o[i] >= c[i - 1] and c[i] <= o[i - 1])
            if bull_engulf:
                out.append({"time": t, "pattern": "envolvente_alcista", "bias": "alcista"})
            elif bear_engulf:
                out.append({"time": t, "pattern": "envolvente_bajista", "bias": "bajista"})

        # --- 3 velas: estrellas ---
        if i >= 2:
            # Morning star: bajista fuerte, cuerpo pequeño, alcista fuerte
            if (c[i - 2] < o[i - 2] and body(i - 1) < 0.4 * body(i - 2)
                    and c[i] > o[i] and c[i] > (o[i - 2] + c[i - 2]) / 2):
                out.append({"time": t, "pattern": "estrella_manana", "bias": "alcista"})
            # Evening star
            if (c[i - 2] > o[i - 2] and body(i - 1) < 0.4 * body(i - 2)
                    and c[i] < o[i] and c[i] < (o[i - 2] + c[i - 2]) / 2):
                out.append({"time": t, "pattern": "estrella_atardecer", "bias": "bajista"})
    return out


# --------------------------------------------------------------------------- #
# 4. Orquestador: devuelve todo listo para graficar
# --------------------------------------------------------------------------- #
def analyze_intraday(ticker: str, minutes: int = 5, days: int = 1,
                     max_levels: int = 4) -> dict:
    df = fetch_intraday(ticker, minutes=minutes, days=days)

    fractals = find_fractals(df, left=2, right=2)
    resistance = sorted(cluster_levels(fractals["swing_highs"]),
                        key=lambda x: x["touches"], reverse=True)[:max_levels]
    support = sorted(cluster_levels(fractals["swing_lows"]),
                    key=lambda x: x["touches"], reverse=True)[:max_levels]
    levels = {"support": support, "resistance": resistance}

    structure = market_structure(fractals)
    breakouts = detect_breakouts(df, levels)
    candles = detect_candles(df)

    last = df.iloc[-1]
    return {
        "ticker": ticker.upper(),
        "interval_min": minutes,
        "generated_at": dt.datetime.utcnow().isoformat() + "Z",
        "last_price": round(float(last["close"]), 4),
        "session_vwap": round(float(df.get("vwap", df["close"]).iloc[-1]), 4)
                        if "vwap" in df.columns else None,
        # Serie OHLC para el gráfico de velas (incluye vwap por vela si existe)
        "candles_ohlc": [
            {"time": row["dt_et"].isoformat(),
             "open": round(float(row["open"]), 4),
             "high": round(float(row["high"]), 4),
             "low": round(float(row["low"]), 4),
             "close": round(float(row["close"]), 4),
             "volume": int(row["volume"]),
             **({"vwap": round(float(row["vwap"]), 4)} if "vwap" in df.columns else {})}
            for _, row in df.iterrows()
        ],
        "chartism": {
            "support": support,
            "resistance": resistance,
            "structure": structure,
            "swing_highs": fractals["swing_highs"][-8:],
            "swing_lows": fractals["swing_lows"][-8:],
            "breakouts": breakouts,
        },
        "price_action": candles[-25:],  # patrones más recientes
    }
