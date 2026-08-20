from .base_strategy import BaseStrategy

class MomentumBreakout(BaseStrategy):
    name = "Momentum Breakout"

    def analyze(self, candles, features):
        if (
            features.get("close", 0) > features.get("resistance", float("inf"))
            and features.get("volume_ratio", 0) > 2
            and features.get("ema20", 0) > features.get("ema50", 0)
        ):
            return {
                "signal": "BUY",
                "confidence": 88,
                "strategy": self.name,
                "entry": features["close"],
                "stop": features["close"] * 0.97,
                "target": features["close"] * 1.06
            }
        return {"signal": "WAIT", "confidence": 0, "strategy": self.name}
