class OrderBlockDetector:
    name = "Institutional Order Blocks"

    def analyze(self, candles):
        blocks = []
        for candle in candles[-20:]:
            if candle.get("volume", 0) > candle.get("avg_volume", 0) * 2:
                blocks.append({
                    "type": "ORDER_BLOCK",
                    "high": candle["high"],
                    "low": candle["low"],
                    "volume": candle["volume"],
                })
        return blocks
