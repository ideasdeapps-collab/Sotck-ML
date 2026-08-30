class OrderBlockDetector:
    """Velas de volumen institucional (>2x la media móvil de 20 barras).

    Antes comparaba contra `candle["avg_volume"]`, una clave que NINGÚN
    productor de velas del repo escribe: `candles_ohlc` de intraday.py no la
    tiene, así que el detector devolvía siempre [].  Ahora la media se calcula
    aquí a partir del propio volumen.
    """

    name = "Institutional Order Blocks"
    window = 20
    multiple = 2.0

    def analyze(self, candles, lookback=40):
        if len(candles) < self.window + 1:
            return []

        volumes = [float(c.get("volume", 0) or 0) for c in candles]
        blocks = []
        start = max(self.window, len(candles) - lookback)

        for i in range(start, len(candles)):
            window = volumes[i - self.window:i]
            avg = sum(window) / len(window) if window else 0.0
            if avg <= 0 or volumes[i] < avg * self.multiple:
                continue

            candle = candles[i]
            blocks.append({
                "type": "ORDER_BLOCK",
                "direction": "BULLISH" if candle["close"] >= candle["open"] else "BEARISH",
                "time": candle.get("time"),
                "high": candle["high"],
                "low": candle["low"],
                "volume": int(volumes[i]),
                "volume_ratio": round(volumes[i] / avg, 2),
            })

        return blocks
