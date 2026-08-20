from .base_strategy import BaseStrategy

class OpeningRangeBreakout(BaseStrategy):
    name = "Opening Range Breakout"

    def analyze(self, candles, features):
        if features.get("close",0) > features.get("opening_range_high",float("inf")):
            return {"signal":"BUY","confidence":83,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
