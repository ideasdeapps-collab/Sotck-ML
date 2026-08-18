"""AI trading decision layer.
Combines model predictions and technical context into explainable signals.
"""

from typing import Dict, Any


def generate_signal(features: Dict[str, Any]) -> Dict[str, Any]:
    score = 0
    reasons = []

    prediction = float(features.get("model_prediction", 0))
    if prediction > 0.6:
        score += 1
        reasons.append("ML bullish confirmation")
    elif prediction < -0.3:
        score -= 1
        reasons.append("ML bearish confirmation")

    trend = features.get("trend", "neutral")
    if trend == "bullish":
        score += 1
        reasons.append("Technical trend bullish")
    elif trend == "bearish":
        score -= 1
        reasons.append("Technical trend bearish")

    rsi = float(features.get("rsi", 50))
    if 45 <= rsi <= 70:
        score += 1
        reasons.append("RSI momentum healthy")

    volume = float(features.get("volume_ratio", 1))
    if volume >= 1.5:
        score += 1
        reasons.append("Volume confirmation")

    if score >= 3:
        action = "BUY"
    elif score <= -2:
        action = "SELL"
    else:
        action = "HOLD"

    confidence = min(abs(score) / 5 + 0.5, 0.95)

    return {
        "action": action,
        "confidence": round(confidence, 2),
        "score": score,
        "reason": reasons,
    }
