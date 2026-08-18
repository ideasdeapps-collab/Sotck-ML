"""AI hybrid trading simulation engine."""

from typing import Dict, Any, List

from ai_trading_agent import generate_signal
from risk_manager import validate_trade
from performance_metrics import calculate_metrics
from trading_costs import apply_execution_costs


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

        signal = generate_signal(dict(features))

        if position is None and signal["action"] == "BUY":
            shares = equity / current_price
            execution = apply_execution_costs(current_price, shares)

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
                    "shares": shares,
                    "entry_cost": execution["total_cost"],
                    "stop": stop,
                    "target": target,
                }

        elif position:
            if current_price <= position["stop"] or current_price >= position["target"]:
                gross_pnl = (
                    (current_price - position["entry"])
                    * position["shares"]
                )

                exit_cost = apply_execution_costs(
                    current_price,
                    position["shares"],
                )["total_cost"]

                pnl = gross_pnl - position["entry_cost"] - exit_cost
                equity += pnl

                trades.append({
                    "entry": position["entry"],
                    "exit": current_price,
                    "shares": round(position["shares"], 4),
                    "result": "WIN" if pnl > 0 else "LOSS",
                    "pnl": round(pnl, 2),
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
