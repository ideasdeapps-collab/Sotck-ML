"""AI parameter optimization engine."""

from typing import Dict, Any, List


PARAMETER_GRID = {
    "stop_loss": [0.005, 0.01, 0.015, 0.02],
    "take_profit": [0.01, 0.015, 0.025, 0.03],
    "position_size": [0.1, 0.15, 0.2],
}


def optimize_parameters(
    strategy: str,
    historical_results: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Selects parameters based on historical strategy performance."""

    if not historical_results:
        return {
            "strategy": strategy,
            "parameters": {
                "stop_loss": 0.01,
                "take_profit": 0.015,
                "position_size": 0.15,
            },
            "confidence": 0,
        }

    best = max(
        historical_results,
        key=lambda x: x.get("return_pct", 0),
    )

    return {
        "strategy": strategy,
        "parameters": best.get("parameters", {
            "stop_loss": 0.01,
            "take_profit": 0.015,
            "position_size": 0.15,
        }),
        "confidence": round(min(best.get("return_pct", 0) / 100, 1), 2),
    }
