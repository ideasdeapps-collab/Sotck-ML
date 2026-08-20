class PerformanceLearningEngine:
    def __init__(self):
        self.trades = []
        self.strategy_memory = {}

    def record_trade(self, trade):
        self.trades.append(trade)
        strategy = trade.get("strategy", "unknown")

        if strategy not in self.strategy_memory:
            self.strategy_memory[strategy] = {
                "wins": 0,
                "losses": 0,
                "total": 0
            }

        result = trade.get("result")
        self.strategy_memory[strategy]["total"] += 1

        if result == "WIN":
            self.strategy_memory[strategy]["wins"] += 1
        elif result == "LOSS":
            self.strategy_memory[strategy]["losses"] += 1

        return self.analyze(strategy)

    def analyze(self, strategy):
        data = self.strategy_memory.get(strategy, {})
        total = data.get("total", 0)
        wins = data.get("wins", 0)

        win_rate = round((wins / total) * 100, 2) if total else 0

        return {
            "strategy": strategy,
            "win_rate": win_rate,
            "trades": total
        }

    def reweight_strategy(self, ranking):
        for item in ranking:
            memory = self.strategy_memory.get(item["strategy"])
            if memory and memory["total"]:
                item["score"] = round(
                    item["score"] * (memory["wins"] / memory["total"]),
                    2
                )

        return sorted(ranking, key=lambda x: x["score"], reverse=True)
