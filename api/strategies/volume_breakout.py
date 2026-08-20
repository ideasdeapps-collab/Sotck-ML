from .base_strategy import BaseStrategy

class VolumeBreakout(BaseStrategy):
    name = "Volume Breakout"

    def analyze(self, candles, features):
        if features.get("volume_ratio",0)>2:
            return {"signal":"BUY","confidence":81,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
