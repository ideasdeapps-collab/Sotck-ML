from .base_strategy import BaseStrategy

class MACDTrend(BaseStrategy):
    name = "MACD Trend"

    def analyze(self, candles, features):
        if features.get("macd",0) > features.get("macd_signal",0):
            return {"signal":"BUY","confidence":84,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
