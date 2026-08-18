"""Realtime AI paper trading engine."""

from typing import Dict, Any

from ai_trading_agent import generate_signal
from risk_manager import validate_trade


class LiveTradingEngine:
    def __init__(self, capital: float = 10000):
        self.portfolio = {
            "cash": capital,
            "positions": {},
            "trades": [],
        }

    def process_candle(self, ticker: str, candle: Dict[str, Any], features: Dict[str, Any]):
        price = float(candle["close"])
        signal = generate_signal(features)

        if signal["action"] == "BUY" and ticker not in self.portfolio["positions"]:
            shares = self.portfolio["cash"] / price

            self.portfolio["positions"][ticker] = {
                "entry": price,
                "shares": shares,
            }

            self.portfolio["trades"].append({
                "ticker": ticker,
                "action": "BUY",
                "price": price,
            })

        return {
            "ticker": ticker,
            "price": price,
            "signal": signal,
            "portfolio": self.portfolio,
        }
