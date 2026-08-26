class FairValueGapDetector:
    """Huecos de valor razonable: el rango de la vela i no solapa el de i-2."""

    name = "Fair Value Gap"

    def analyze(self, candles, lookback=60):
        gaps = []
        start = max(2, len(candles) - lookback)

        for i in range(start, len(candles)):
            prev = candles[i - 2]
            current = candles[i]

            if current["low"] > prev["high"]:
                gaps.append({"type": "BULLISH_FVG", "time": current.get("time"),
                             "top": current["low"], "bottom": prev["high"]})

            if current["high"] < prev["low"]:
                gaps.append({"type": "BEARISH_FVG", "time": current.get("time"),
                             "top": prev["low"], "bottom": current["high"]})

        return gaps
