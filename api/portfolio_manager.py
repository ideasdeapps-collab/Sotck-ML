"""Portfolio and position management."""

from typing import Dict, Any


class PortfolioManager:
    def __init__(self, capital: float):
        self.cash = capital
        self.positions = {}

    def open_position(self, ticker: str, shares: float, price: float):
        value = shares * price

        if value > self.cash:
            return {"approved": False, "reason": "insufficient_cash"}

        self.cash -= value
        self.positions[ticker] = {
            "shares": shares,
            "entry_price": price,
            "value": value,
        }

        return {"approved": True}

    def close_position(self, ticker: str, price: float) -> Dict[str, Any]:
        position = self.positions.get(ticker)

        if not position:
            return {"closed": False}

        proceeds = position["shares"] * price
        pnl = proceeds - position["value"]

        self.cash += proceeds
        del self.positions[ticker]

        return {
            "closed": True,
            "pnl": round(pnl, 2),
            "cash": round(self.cash, 2),
        }

    def snapshot(self):
        return {
            "cash": round(self.cash, 2),
            "positions": self.positions,
        }
