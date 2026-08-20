from fastapi import APIRouter
from pydantic import BaseModel
from strategy_ranking import rank_strategies

router=APIRouter(tags=['Strategy Ranking'])
class StrategyRequest(BaseModel):
    ticker:str
    market_regime:str
    patterns:dict={}

@router.post('/strategy-ranking')
def strategy_ranking(request:StrategyRequest):
    return rank_strategies(request.model_dump())
