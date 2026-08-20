from fastapi import APIRouter
from pydantic import BaseModel

from decision.trade_decision_engine import AITradeDecisionEngine

router = APIRouter(prefix="", tags=["AI Trade Decision"])
engine = AITradeDecisionEngine()


class TradeDecisionRequest(BaseModel):
    ticker: str
    price: float
    market_regime: str
    patterns: dict = {}
    strategy: dict
    volatility: float = 1.0


@router.post("/trade-decision")
def trade_decision(request: TradeDecisionRequest):
    return engine.decide(
        request.ticker,
        request.market_regime,
        request.patterns,
        request.strategy,
        request.price,
        request.volatility,
    )
