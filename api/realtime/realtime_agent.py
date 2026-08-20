class RealTimeTradingAgent:
    def process_candle(self, ticker, candle):
        features = self.extract_features(candle)
        regime = self.detect_regime(features)
        patterns = self.detect_patterns(features)
        strategy = self.rank_strategy(regime, patterns)
        return self.make_decision(strategy)

    def extract_features(self, candle):
        return candle

    def detect_regime(self, features):
        return "BULLISH TREND" if features.get("close",0) >= features.get("open",0) else "BEARISH"

    def detect_patterns(self, features):
        return ["momentum"]

    def rank_strategy(self, regime, patterns):
        return "Momentum Breakout" if regime == "BULLISH TREND" else "Mean Reversion"

    def make_decision(self, strategy):
        return {
            "strategy": strategy,
            "action": "BUY" if strategy == "Momentum Breakout" else "WAIT",
            "confidence": 90
        }
