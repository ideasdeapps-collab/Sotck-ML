from .base_strategy import BaseStrategy

class BollingerSqueeze(BaseStrategy):
    name = "Bollinger Squeeze"

    def analyze(self, candles, features):
        if features.get("bollinger_squeeze"):
            return {"signal":"BUY","confidence":86,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
