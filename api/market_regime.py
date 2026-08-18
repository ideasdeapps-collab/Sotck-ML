"""Market regime classification engine."""

from typing import Dict, Any


def detect_market_regime(features: Dict[str, Any]) -> Dict[str, Any]:
    rsi = float(features.get("rsi", 50))
    momentum = float(features.get("momentum", 0))
    volume = float(features.get("volume_ratio", 1))
    trend = features.get("trend", "neutral")

    if volume > 2 and abs(momentum) > 0.02:
        regime = "HIGH_VOLATILITY"
    elif trend == "bullish" and momentum > 0:
        regime = "BULLISH"
    elif trend == "bearish" and momentum < 0:
        regime = "BEARISH"
    elif 45 <= rsi <= 55:
        regime = "SIDEWAYS"
    else:
        regime = "TRANSITION"

    return {
        "regime": regime,
        "confidence": round(min(abs(momentum) * 20 + volume / 10, 1), 2),
    }
