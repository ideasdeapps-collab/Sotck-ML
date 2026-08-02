"""
intraday.py — Chartismo + price action + ELLIOTT (ya integrado)
===============================================================
Descarga barras por minuto de Polygon y detecta:
  CHARTISMO: pivotes fractales, soporte/resistencia, estructura de tendencia,
             breakouts con volumen.
  PRICE ACTION: martillo, shooting star, doji, envolventes.
  ELLIOTT: ZigZag + ondas 0-1-2-3-4-5 (vía elliott.py) — clave "elliott".
"""

from __future__ import annotations
import os
import datetime as dt

import numpy as np
import pandas as pd

from polygon_client import get_json, TTL_INTRADAY
from elliott import elliott_from_candles   # ← Elliott sobre velas intradía

POLYGON_API_KEY = os.getenv("POLYGON_API_KEY")


def fetch_intraday(ticker: str, minutes: int = 1, days: int = 1) -> pd.DataFrame:
    if not POLYGON_API_KEY:
        raise RuntimeError("Falta la variable de entorno POLYGON_API_KEY")
    end = dt.date.today(); start = end - dt.timedelta(days=max(days, 1))
    url = (f"https://api.polygon.io/v2/aggs/ticker/{ticker.upper()}/range/"
           f"{minutes}/minute/{start.isoformat()}/{end.isoformat()}"
           f"?adjusted=true&sort=asc&limit=50000&apiKey={POLYGON_API_KEY}")
    res = get_json(url, ttl=TTL_INTRADAY).get("results", [])
    if not res:
        raise ValueError(f"Polygon no devolvió barras intradía para {ticker} "
                         f"(plan gratuito: 15 min de retraso; verifica día/hora hábil).")
    df = pd.DataFrame(res).rename(columns={"o": "open", "h": "high", "l": "low",
                                           "c": "close", "v": "volume", "t": "timestamp", "vw": "vwap"})
    df["dt"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df["dt_et"] = df["dt"].dt.tz_convert("America/New_York")
    keep = ["dt_et", "open", "high", "low", "close", "volume"] + (["vwap"] if "vwap" in df.columns else [])
    return df[keep].reset_index(drop=True)


def find_fractals(df, left=2, right=2):
    highs, lows = [], []
    for i in range(left, len(df) - right):
        if df["high"].iloc[i] == df["high"].iloc[i - left:i + right + 1].max():
            highs.append({"time": df["dt_et"].iloc[i].isoformat(), "price": round(float(df["high"].iloc[i]), 4)})
        if df["low"].iloc[i] == df["low"].iloc[i - left:i + right + 1].min():
            lows.append({"time": df["dt_et"].iloc[i].isoformat(), "price": round(float(df["low"].iloc[i]), 4)})
    return {"swing_highs": highs, "swing_lows": lows}


def cluster_levels(pivots, tol=0.003):
    if not pivots:
        return []
    prices = sorted(p["price"] for p in pivots)
    clusters, cur = [], [prices[0]]
    for p in prices[1:]:
        if abs(p - cur[-1]) / cur[-1] <= tol:
            cur.append(p)
        else:
            clusters.append(cur); cur = [p]
    clusters.append(cur)
    return [{"level": round(float(np.mean(c)), 4), "touches": len(c)} for c in clusters]


def market_structure(fr):
    highs = [h["price"] for h in fr["swing_highs"]][-3:]
    lows = [l["price"] for l in fr["swing_lows"]][-3:]
    trend = "lateral"
    if len(highs) >= 2 and len(lows) >= 2:
        if highs[-1] > highs[-2] and lows[-1] > lows[-2]:
            trend = "alcista (HH/HL)"
        elif highs[-1] < highs[-2] and lows[-1] < lows[-2]:
            trend = "bajista (LH/LL)"
    return {"trend": trend, "last_highs": [round(x, 4) for x in highs], "last_lows": [round(x, 4) for x in lows]}


def detect_breakouts(df, levels, vol_mult=1.5):
    if df.empty:
        return []
    avg = df["volume"].rolling(20, min_periods=5).mean()
    res_l = [l["level"] for l in levels.get("resistance", [])]
    sup_l = [l["level"] for l in levels.get("support", [])]
    out = []
    for i in range(1, len(df)):
        c0, c1 = df["close"].iloc[i - 1], df["close"].iloc[i]
        vok = df["volume"].iloc[i] >= vol_mult * (avg.iloc[i] or 1e9)
        for lvl in res_l:
            if c0 <= lvl < c1 and vok:
                out.append({"time": df["dt_et"].iloc[i].isoformat(), "type": "breakout_alcista", "level": lvl, "price": round(float(c1), 4)})
        for lvl in sup_l:
            if c0 >= lvl > c1 and vok:
                out.append({"time": df["dt_et"].iloc[i].isoformat(), "type": "breakdown_bajista", "level": lvl, "price": round(float(c1), 4)})
    return out


def detect_candles(df):
    out = []
    o, h, l, c = df["open"].values, df["high"].values, df["low"].values, df["close"].values
    def body(i): return abs(c[i] - o[i])
    def rng(i): return (h[i] - l[i]) or 1e-9
    def up(i): return h[i] - max(c[i], o[i])
    def lo(i): return min(c[i], o[i]) - l[i]
    for i in range(len(df)):
        t = df["dt_et"].iloc[i].isoformat()
        if lo(i) > 2 * body(i) and up(i) < body(i):
            out.append({"time": t, "pattern": "martillo", "bias": "alcista"})
        elif up(i) > 2 * body(i) and lo(i) < body(i):
            out.append({"time": t, "pattern": "shooting_star", "bias": "bajista"})
        elif body(i) <= 0.1 * rng(i):
            out.append({"time": t, "pattern": "doji", "bias": "indecision"})
        if i >= 1:
            if c[i - 1] < o[i - 1] and c[i] > o[i] and c[i] >= o[i - 1] and o[i] <= c[i - 1]:
                out.append({"time": t, "pattern": "envolvente_alcista", "bias": "alcista"})
            elif c[i - 1] > o[i - 1] and c[i] < o[i] and o[i] >= c[i - 1] and c[i] <= o[i - 1]:
                out.append({"time": t, "pattern": "envolvente_bajista", "bias": "bajista"})
    return out


def analyze_intraday(ticker: str, minutes: int = 15, days: int = 1, max_levels: int = 4) -> dict:
    df = fetch_intraday(ticker, minutes=minutes, days=days)
    fr = find_fractals(df)
    resistance = sorted(cluster_levels(fr["swing_highs"]), key=lambda x: x["touches"], reverse=True)[:max_levels]
    support = sorted(cluster_levels(fr["swing_lows"]), key=lambda x: x["touches"], reverse=True)[:max_levels]
    levels = {"support": support, "resistance": resistance}
    structure = market_structure(fr)
    breakouts = detect_breakouts(df, levels)
    candles = detect_candles(df)
    last = df.iloc[-1]

    # Velas OHLC para el gráfico
    candles_ohlc = [{"time": r["dt_et"].isoformat(), "open": round(float(r["open"]), 4),
                     "high": round(float(r["high"]), 4), "low": round(float(r["low"]), 4),
                     "close": round(float(r["close"]), 4), "volume": int(r["volume"]),
                     **({"vwap": round(float(r["vwap"]), 4)} if "vwap" in df.columns else {})}
                    for _, r in df.iterrows()]

    # ── ELLIOTT sobre las velas intradía (pct pequeño para intradía) ──
    elliott = elliott_from_candles(
        [{"time": c["time"], "close": c["close"]} for c in candles_ohlc],
        pct=0.004,
    )

    return {"ticker": ticker.upper(), "interval_min": minutes,
            "generated_at": dt.datetime.utcnow().isoformat() + "Z",
            "last_price": round(float(last["close"]), 4),
            "session_vwap": round(float(df["vwap"].iloc[-1]), 4) if "vwap" in df.columns else None,
            "candles_ohlc": candles_ohlc,
            "chartism": {"support": support, "resistance": resistance, "structure": structure,
                         "swing_highs": fr["swing_highs"][-8:], "swing_lows": fr["swing_lows"][-8:],
                         "breakouts": breakouts},
            "price_action": candles[-25:],
            "elliott": elliott}      # ← NUEVO: {zigzag, elliott, fibonacci}
