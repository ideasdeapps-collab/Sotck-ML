class BaseStrategy:
    name = "Base"

    def analyze(self, candles, features):
        return {
            "signal": "WAIT",
            "confidence": 0,
            "entry": None,
            "stop": None,
            "target": None
        }

    def risk_management(self, entry):
        return {
            "stop_loss": entry * 0.98,
            "take_profit": entry * 1.05
        }
