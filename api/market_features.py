"""Technical feature generation for AI trading agent."""

from typing import List, Dict, Any
import pandas as pd


def generate_features(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not candles:
        return {}

    df = pd.DataFrame(candles)

    close = df["close"]
    volume = df["volume"]

    df["ema20"] = close.ewm(span=20).mean()
    df["ema50"] = close.ewm(span=50).mean()

    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = -delta.clip(upper=0).rolling(14).mean()
    rs = gain / loss.replace(0, 1)
    df["rsi"] = 100 - (100 / (1 + rs))

    df["volume_ratio"] = volume / volume.rolling(20).mean()
    df["momentum"] = close.pct_change(10)

    last = df.iloc[-1]

    trend = "bullish" if last.ema20 > last.ema50 else "bearish"

    return {
        "ema20": round(float(last.ema20), 4),
        "ema50": round(float(last.ema50), 4),
        "rsi": round(float(last.rsi), 2) if pd.notna(last.rsi) else 50,
        "volume_ratio": round(float(last.volume_ratio), 2) if pd.notna(last.volume_ratio) else 1,
        "momentum": round(float(last.momentum), 4) if pd.notna(last.momentum) else 0,
        "trend": trend,
    }
