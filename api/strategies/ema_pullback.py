from .base_strategy import BaseStrategy

class EMAPullback(BaseStrategy):
    name = "EMA Pullback"

    def analyze(self, candles, features):
        if features.get("ema20", 0) > features.get("ema50", 0) and features.get("close", 0) <= features.get("ema20", 0):
            return {"signal":"BUY","confidence":82,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
