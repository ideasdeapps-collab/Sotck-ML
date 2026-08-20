class SupportResistanceDetector:
    name = "Support Resistance"

    def analyze(self, candles):
        highs = [c["high"] for c in candles]
        lows = [c["low"] for c in candles]

        resistance = max(highs[-50:])
        support = min(lows[-50:])

        return {
            "support": support,
            "resistance": resistance,
            "zones": [
                {"type": "SUPPORT", "price": support},
                {"type": "RESISTANCE", "price": resistance},
            ],
        }
