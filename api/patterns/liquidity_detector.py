class LiquiditySweepDetector:
    """Barrido de liquidez: la última vela perfora el extremo de las 20 previas."""

    name = "Liquidity Sweep"

    def analyze(self, candles):
        if len(candles) < 21:
            return {"signal": "NONE"}

        last = candles[-1]
        previous_high = max(c["high"] for c in candles[-20:-1])
        previous_low = min(c["low"] for c in candles[-20:-1])

        if last["high"] > previous_high:
            return {"signal": "LIQUIDITY_SWEEP_UP", "level": previous_high, "time": last.get("time")}

        if last["low"] < previous_low:
            return {"signal": "LIQUIDITY_SWEEP_DOWN", "level": previous_low, "time": last.get("time")}

        return {"signal": "NONE"}
