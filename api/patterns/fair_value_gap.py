class FairValueGapDetector:
    name = "Fair Value Gap"

    def analyze(self, candles):
        gaps = []
        for i in range(2, len(candles)):
            prev = candles[i-2]
            current = candles[i]

            if current["low"] > prev["high"]:
                gaps.append({"type": "BULLISH_FVG", "top": current["low"], "bottom": prev["high"]})

            if current["high"] < prev["low"]:
                gaps.append({"type": "BEARISH_FVG", "top": prev["low"], "bottom": current["high"]})

        return gaps
