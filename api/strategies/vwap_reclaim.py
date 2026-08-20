from .base_strategy import BaseStrategy

class VWAPReclaim(BaseStrategy):
    name = "VWAP Reclaim"

    def analyze(self, candles, features):
        if features.get("close",0) > features.get("vwap",float("inf")):
            return {"signal":"BUY","confidence":78,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
