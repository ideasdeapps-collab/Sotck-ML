import os

class MarketStream:
    """Polygon websocket abstraction for minute candle streaming."""

    def __init__(self):
        self.api_key = os.getenv("POLYGON_API_KEY")

    def subscribe(self, ticker):
        return {
            "ticker": ticker.upper(),
            "status": "SUBSCRIBED",
            "source": "polygon_websocket",
            "interval": "1m"
        }

    def normalize_candle(self, event):
        return {
            "ticker": event.get("sym"),
            "open": event.get("o"),
            "high": event.get("h"),
            "low": event.get("l"),
            "close": event.get("c"),
            "volume": event.get("v"),
        }
