from .base_strategy import BaseStrategy

class MeanReversion(BaseStrategy):
    name = "Mean Reversion"

    def analyze(self, candles, features):
        if features.get("rsi",50) < 30:
            return {"signal":"BUY","confidence":75,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
