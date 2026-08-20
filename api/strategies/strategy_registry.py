class BaseStrategy:
    name = "Base"
    def regime_score(self, regime): return 50
    def pattern_score(self, patterns): return 50
    def risk_score(self, risk): return 50

class MomentumBreakout(BaseStrategy):
    name="Momentum Breakout"
    def regime_score(self, regime): return 95 if regime=="TRENDING" else 60
    def pattern_score(self, patterns): return 95 if patterns.get("liquidity")=="SWEEP_UP" and patterns.get("fvg")=="BULLISH" else 70

class EMAPullback(BaseStrategy):
    name="EMA Pullback"
    def regime_score(self, regime): return 85 if regime=="TRENDING" else 60

class VWAPReclaim(BaseStrategy):
    name="VWAP Reclaim"
    def pattern_score(self, patterns): return 80 if patterns.get("fvg")=="BULLISH" else 65

class MeanReversion(BaseStrategy):
    name="Mean Reversion"
    def regime_score(self, regime): return 85 if regime=="RANGING" else 50
