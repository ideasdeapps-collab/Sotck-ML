class LiquiditySweepDetector:
    name = "Liquidity Sweep"

    def analyze(self, candles):
        last = candles[-1]
        previous_high = max(c["high"] for c in candles[-20:-1])
        previous_low = min(c["low"] for c in candles[-20:-1])

        if last["high"] > previous_high:
            return {"signal": "LIQUIDITY_SWEEP_UP", "level": previous_high}

        if last["low"] < previous_low:
            return {"signal": "LIQUIDITY_SWEEP_DOWN", "level": previous_low}

        return {"signal": "NONE"}
