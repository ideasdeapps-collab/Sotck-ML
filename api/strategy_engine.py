"""Trading strategy selection engine."""

from typing import Dict, Any


STRATEGIES = [
    "AI_HYBRID",
    "EMA_CROSSOVER",
    "RSI_MOMENTUM",
    "BREAKOUT",
    "MEAN_REVERSION",
]


def recommend_strategy(features: Dict[str, Any]) -> Dict[str, Any]:
    rsi = float(features.get("rsi", 50))
    trend = features.get("trend", "neutral")
    volume = float(features.get("volume_ratio", 1))
    momentum = float(features.get("momentum", 0))

    scores = {
        "AI_HYBRID": 0,
        "EMA_CROSSOVER": 0,
        "RSI_MOMENTUM": 0,
        "BREAKOUT": 0,
        "MEAN_REVERSION": 0,
    }

    if trend == "bullish":
        scores["EMA_CROSSOVER"] += 2
        scores["AI_HYBRID"] += 2

    if 45 <= rsi <= 70:
        scores["RSI_MOMENTUM"] += 2
        scores["AI_HYBRID"] += 1

    if volume >= 1.5 and momentum > 0:
        scores["BREAKOUT"] += 2
        scores["AI_HYBRID"] += 1

    if rsi > 70 or rsi < 30:
        scores["MEAN_REVERSION"] += 2

    best = max(scores, key=scores.get)

    return {
        "recommended_strategy": best,
        "confidence": round(scores[best] / 5, 2),
        "scores": scores,
    }
