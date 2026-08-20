from .base_strategy import BaseStrategy

class TrendFollowing(BaseStrategy):
    name = "Trend Following"

    def analyze(self, candles, features):
        if features.get("trend") == "uptrend":
            return {"signal":"BUY","confidence":85,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
