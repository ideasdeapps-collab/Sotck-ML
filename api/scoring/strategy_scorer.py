class StrategyScoringEngine:
    def score(self, strategies, market_regime, patterns, risk=None):
        results=[]
        for strategy in strategies:
            score=(strategy.regime_score(market_regime)+strategy.pattern_score(patterns)+strategy.risk_score(risk))/3
            results.append({'strategy':strategy.name,'score':round(score)})
        return sorted(results,key=lambda x:x['score'],reverse=True)
