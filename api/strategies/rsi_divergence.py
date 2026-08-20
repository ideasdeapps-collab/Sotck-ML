from .base_strategy import BaseStrategy

class RSIDivergence(BaseStrategy):
    name = "RSI Divergence"

    def analyze(self, candles, features):
        if features.get("rsi_divergence"):
            return {"signal":"BUY","confidence":80,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
