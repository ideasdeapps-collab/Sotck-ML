class SignalMonitor:
    def evaluate(self, ticker, decision):
        return {
            "ticker": ticker,
            "signal": decision.get("action"),
            "strategy": decision.get("strategy"),
            "confidence": decision.get("confidence"),
            "monitoring": True
        }
