from .risk_reward import calculate_risk_reward


class AITradeDecisionEngine:
    def decide(
        self,
        ticker,
        market_regime,
        patterns,
        strategy_result,
        price,
        volatility=1.0,
    ):
        score = strategy_result.get("score", 0)
        action = "BUY" if score >= 75 and market_regime in ["TRENDING", "BULLISH"] else "HOLD"

        entry = round(price, 2)
        stop = round(price - (volatility * 1.25), 2)
        target = round(price + (volatility * 2.75), 2)

        return {
            "ticker": ticker.upper(),
            "market": {
                "regime": market_regime,
                "confidence": score,
            },
            "patterns": patterns,
            "strategy": strategy_result,
            "decision": {
                "action": action,
                "confidence": score,
            },
            "trade_plan": {
                "entry": entry,
                "stop_loss": stop,
                "target": target,
                **calculate_risk_reward(entry, stop, target),
            },
        }
