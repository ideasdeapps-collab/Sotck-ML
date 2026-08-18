"""AI hybrid trading simulation engine."""

from typing import Dict, Any, List

from ai_trading_agent import generate_signal
from risk_manager import validate_trade
from performance_metrics import calculate_metrics


def run_ai_simulation(
    ticker: str,
    capital: float,
    days: int,
    candles: List[Dict[str, Any]],
    features: Dict[str, Any],
) -> Dict[str, Any]:
    """Runs candle-by-candle AI paper trading simulation."""

    equity = capital
    equity_curve = [capital]
    trades = []
    position = None

    for candle in candles:
        current_price = float(candle["close"])

        signal_features = dict(features)
        signal = generate_signal(signal_features)

        if position is None and signal["action"] == "BUY":
            stop = current_price * 0.99
            target = current_price * 1.015

            risk = validate_trade(
                entry_price=current_price,
                stop_loss=stop,
                take_profit=target,
                capital=equity,
            )

            if risk["approved"]:
                position = {
                    "entry": current_price,
                    "stop": stop,
                    "target": target,
                }

        elif position:
            if current_price <= position["stop"] or current_price >= position["target"]:
                pnl = (current_price - position["entry"]) / position["entry"]
                equity *= (1 + pnl)

                trades.append({
                    "entry": position["entry"],
                    "exit": current_price,
                    "result": "WIN" if pnl > 0 else "LOSS",
                    "pnl_pct": round(pnl * 100, 2),
                })

                position = None

        equity_curve.append(round(equity, 2))

    metrics = calculate_metrics(equity_curve, trades)

    return {
        "ticker": ticker.upper(),
        "strategy": "AI_HYBRID",
        "initial_capital": capital,
        "final_equity": round(equity, 2),
        "days": days,
        **metrics,
        "signal": generate_signal(features),
        "trades": trades,
    }
