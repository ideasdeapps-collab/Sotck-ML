"""Realtime AI paper trading engine.

Motor de paper-trading que mantiene estado entre llamadas a /ai/live-monitor:
procesa cada vela nueva, abre posición con la señal del agente (respetando
tamaño de posición + stop-loss/take-profit) y la CIERRA cuando toca SL/TP o
cuando la señal se invierte a SELL. Expone cash, posiciones, equity y PnL.
"""
from typing import Dict, Any

from ai_trading_agent import generate_signal
from risk_manager import validate_trade
from trading_costs import apply_execution_costs

POSITION_SIZE = 0.15   # fracción del equity por operación
STOP_LOSS = 0.01       # 1%
TAKE_PROFIT = 0.015    # 1.5%


class LiveTradingEngine:
    def __init__(self, capital: float = 10000):
        self.capital = capital
        self.portfolio: Dict[str, Any] = {
            "cash": capital,
            "positions": {},
            "trades": [],
            "realized_pnl": 0.0,
            "equity": capital,
        }

    def _equity(self, price: float, ticker: str) -> float:
        eq = self.portfolio["cash"]
        for tk, pos in self.portfolio["positions"].items():
            mark = price if tk == ticker else pos["entry"]
            eq += pos["shares"] * mark
        return round(eq, 2)

    def process_candle(self, ticker: str, candle: Dict[str, Any], features: Dict[str, Any]):
        price = float(candle["close"])
        signal = generate_signal(features)
        action = signal["action"]
        position = self.portfolio["positions"].get(ticker)
        event = "none"

        # 1) Gestión de la posición abierta: SL / TP / señal de salida
        if position is not None:
            hit_stop = price <= position["stop"]
            hit_target = price >= position["target"]
            exit_signal = action == "SELL"
            if hit_stop or hit_target or exit_signal:
                gross = (price - position["entry"]) * position["shares"]
                exit_cost = apply_execution_costs(price, position["shares"])["total_cost"]
                pnl = gross - position["entry_cost"] - exit_cost
                self.portfolio["cash"] += position["shares"] * price - exit_cost
                self.portfolio["realized_pnl"] = round(self.portfolio["realized_pnl"] + pnl, 2)
                self.portfolio["trades"].append({
                    "ticker": ticker, "action": "SELL", "price": round(price, 4),
                    "shares": position["shares"],
                    "pnl": round(pnl, 2),
                    "reason": "stop" if hit_stop else "target" if hit_target else "signal",
                })
                del self.portfolio["positions"][ticker]
                position = None
                event = "closed"

        # 2) Apertura: solo si no hay posición y la señal es BUY
        if position is None and action == "BUY":
            equity = self._equity(price, ticker)
            shares = (equity * POSITION_SIZE) / price if price > 0 else 0
            cost = shares * price
            if shares > 0 and cost <= self.portfolio["cash"]:
                stop = price * (1 - STOP_LOSS)
                target = price * (1 + TAKE_PROFIT)
                risk = validate_trade(entry_price=price, stop_loss=stop,
                                      take_profit=target, capital=equity)
                if risk["approved"]:
                    entry_cost = apply_execution_costs(price, shares)["total_cost"]
                    self.portfolio["cash"] -= cost + entry_cost
                    self.portfolio["positions"][ticker] = {
                        "entry": round(price, 4), "shares": shares,
                        "entry_cost": entry_cost, "stop": round(stop, 4),
                        "target": round(target, 4),
                    }
                    self.portfolio["trades"].append({
                        "ticker": ticker, "action": "BUY", "price": round(price, 4),
                        "shares": shares, "pnl": 0.0,
                        "confidence": signal["confidence"],
                    })
                    event = "opened"

        self.portfolio["cash"] = round(self.portfolio["cash"], 2)
        self.portfolio["equity"] = self._equity(price, ticker)

        return {
            "ticker": ticker,
            "price": round(price, 4),
            "signal": signal,
            "event": event,
            "portfolio": self.portfolio,
        }
