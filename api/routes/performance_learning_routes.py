from fastapi import APIRouter
from pydantic import BaseModel

from learning.performance_learning_engine import PerformanceLearningEngine

router = APIRouter(tags=["AI Learning"])
engine = PerformanceLearningEngine()


class TradeResultRequest(BaseModel):
    trade: dict


class RankingRequest(BaseModel):
    ranking: list


@router.post("/learning/trade-result")
def trade_result(request: TradeResultRequest):
    return engine.record_trade(request.trade)


@router.post("/learning/reweight")
def reweight(request: RankingRequest):
    return engine.reweight_strategy(request.ranking)
