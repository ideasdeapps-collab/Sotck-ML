"""Multi strategy backtesting engine."""

from typing import Dict, Any, List

from ai_simulation import run_ai_simulation


STRATEGIES = [
    "AI_HYBRID",
    "EMA_CROSSOVER",
    "RSI_MOMENTUM",
    "BREAKOUT",
    "MEAN_REVERSION",
]


def run_strategy_backtest(
    ticker: str,
    capital: float,
    days: int,
    candles: List[Dict[str, Any]],
    features: Dict[str, Any],
):
    results = []

    for strategy in STRATEGIES:
        result = run_ai_simulation(
            ticker=ticker,
            capital=capital,
            days=days,
            candles=candles,
            features={**features, "strategy": strategy},
        )

        results.append({
            "strategy": strategy,
            "return_pct": round(
                ((result["final_equity"] - capital) / capital) * 100,
                2,
            ),
            "win_rate": result.get("win_rate", 0),
            "sharpe_ratio": result.get("sharpe_ratio", 0),
            "max_drawdown": result.get("max_drawdown", 0),
            "total_trades": result.get("total_trades", 0),
        })

    return sorted(
        results,
        key=lambda x: x["return_pct"],
        reverse=True,
    )
