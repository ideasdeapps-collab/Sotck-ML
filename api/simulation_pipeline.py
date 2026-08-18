"""Trading Lab AI simulation orchestration layer."""

from typing import Dict, Any

from polygon_market import fetch_minute_candles
from market_features import generate_features
from ai_trading_agent import generate_signal


def run_ai_simulation(ticker: str, days: int = 1) -> Dict[str, Any]:
    candles = fetch_minute_candles(ticker, days)

    features = generate_features(candles)

    signal = generate_signal(features)

    return {
        "ticker": ticker.upper(),
        "candles": len(candles),
        "features": features,
        "signal": signal,
    }
