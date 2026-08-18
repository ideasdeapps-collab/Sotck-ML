"""AI hybrid trading simulation orchestrator."""

from typing import Dict, Any, List

from ai_trading_agent import generate_signal
from risk_manager import validate_trade
from simulate import monte_carlo_gbm


def run_ai_simulation(
    ticker: str,
    capital: float,
    days: int,
    candles: List[Dict[str, Any]],
    features: Dict[str, Any],
) -> Dict[str, Any]:
    """Runs a paper trading simulation using AI signals.

    This first version provides the orchestration layer. Market data adapters
    and detailed trade execution are connected through existing modules.
    """

    signal = generate_signal(features)

    trades = []
    equity = capital

    if signal["action"] == "BUY" and candles:
        entry = float(candles[-1]["close"])
        stop = entry * 0.99
        target = entry * 1.015

        risk = validate_trade(
            entry_price=entry,
            stop_loss=stop,
            take_profit=target,
            capital=capital,
        )

        if risk["approved"]:
            trades.append({
                "action": "BUY",
                "entry": entry,
                "stop_loss": stop,
                "take_profit": target,
            })

    return {
        "ticker": ticker.upper(),
        "strategy": "AI_HYBRID",
        "initial_capital": capital,
        "final_equity": round(equity, 2),
        "return_pct": 0,
        "signal": signal,
        "trades": trades,
        "days": days,
    }
