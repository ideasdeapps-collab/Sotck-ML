"""AI strategy performance memory."""

from typing import Dict, Any, List


class AILearningMemory:
    def __init__(self):
        self.history: List[Dict[str, Any]] = []

    def record_result(self, ticker: str, regime: str, strategy: str, metrics: Dict[str, Any]):
        self.history.append({
            "ticker": ticker,
            "regime": regime,
            "strategy": strategy,
            "metrics": metrics,
        })

    def best_strategy(self, ticker: str, regime: str):
        records = [
            x for x in self.history
            if x["ticker"] == ticker and x["regime"] == regime
        ]

        if not records:
            return None

        return max(
            records,
            key=lambda x: x["metrics"].get("return_pct", 0),
        )


memory = AILearningMemory()
