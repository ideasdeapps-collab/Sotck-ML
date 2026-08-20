from strategies.strategy_registry import get_strategies
from scoring.strategy_scorer import StrategyScoringEngine


def rank_strategies(payload):
    ranking=StrategyScoringEngine().score(get_strategies(),payload.get('market_regime'),payload.get('patterns',{}),{})
    return {'best_strategy':{'name':ranking[0]['strategy'],'confidence':ranking[0]['score']},'ranking':ranking}
