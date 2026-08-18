"""Performance analytics for AI paper trading simulations."""

from typing import List, Dict, Any
import math


def calculate_metrics(equity_curve: List[float], trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not equity_curve:
        return {
            "return_pct": 0,
            "max_drawdown": 0,
            "sharpe_ratio": 0,
            "total_trades": len(trades),
        }

    initial = equity_curve[0]
    final = equity_curve[-1]
    returns = [(equity_curve[i] / equity_curve[i - 1]) - 1
               for i in range(1, len(equity_curve)) if equity_curve[i - 1] != 0]

    peak = equity_curve[0]
    max_drawdown = 0
    for value in equity_curve:
        peak = max(peak, value)
        drawdown = (peak - value) / peak if peak else 0
        max_drawdown = max(max_drawdown, drawdown)

    avg = sum(returns) / len(returns) if returns else 0
    variance = sum((x - avg) ** 2 for x in returns) / len(returns) if returns else 0
    volatility = math.sqrt(variance)
    sharpe = avg / volatility * math.sqrt(252) if volatility else 0

    wins = [t for t in trades if t.get("result") == "WIN"]

    return {
        "return_pct": round(((final - initial) / initial) * 100, 2),
        "max_drawdown": round(max_drawdown * 100, 2),
        "sharpe_ratio": round(sharpe, 2),
        "total_trades": len(trades),
        "win_rate": round((len(wins) / len(trades)) * 100, 2) if trades else 0,
    }
