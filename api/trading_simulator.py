"""
Trading Simulator Engine v1
Paper trading engine for minute-by-minute Polygon candles.
"""

from dataclasses import dataclass, asdict
from typing import List, Dict, Any


@dataclass
class Position:
    ticker: str
    shares: float
    entry_price: float
    entry_time: str


@dataclass
class Trade:
    ticker: str
    action: str
    price: float
    timestamp: str
    shares: float
    pnl: float = 0.0
    reason: str = ""
    confidence: float = 0.0


def generate_signal(candle: Dict[str, Any], indicators: Dict[str, Any] | None = None):
    """Decision layer placeholder. AI agent replaces this in next iteration."""
    indicators = indicators or {}
    if indicators.get("trend") == "up" and indicators.get("volume_ratio", 0) > 1.5:
        return {"action": "BUY", "confidence": 0.75, "reason": "Trend and volume confirmation"}
    return {"action": "HOLD", "confidence": 0.5, "reason": "No setup"}


def simulate_trading(candles: List[Dict[str, Any]], ticker: str, capital: float = 10000):
    cash = capital
    position = None
    trades = []

    for candle in candles:
        price = float(candle["close"])
        signal = generate_signal(candle, candle.get("indicators"))

        if signal["action"] == "BUY" and position is None:
            shares = cash / price
            position = Position(ticker, shares, price, candle["timestamp"])
            cash = 0
            trades.append(Trade(ticker, "BUY", price, candle["timestamp"], shares,
                                reason=signal["reason"], confidence=signal["confidence"]))

    equity = cash
    if position and candles:
        equity = position.shares * float(candles[-1]["close"])

    return {
        "ticker": ticker.upper(),
        "initial_capital": capital,
        "final_equity": round(equity, 2),
        "return_pct": round((equity / capital - 1) * 100, 2),
        "trades": [asdict(t) for t in trades]
    }
