from .base_strategy import BaseStrategy

class LiquiditySweep(BaseStrategy):
    name = "Liquidity Sweep"

    def analyze(self, candles, features):
        if features.get("liquidity_sweep"):
            return {"signal":"BUY","confidence":87,"strategy":self.name,"entry":features.get("close")}
        return {"signal":"WAIT","confidence":0,"strategy":self.name}
