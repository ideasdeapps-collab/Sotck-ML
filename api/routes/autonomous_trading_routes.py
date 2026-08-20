from fastapi import APIRouter
from pydantic import BaseModel

from autonomous.trading_brain import AutonomousTradingBrain

from decision.trade_decision_engine import AITradeDecisionEngine
from paper_trading.paper_trading_agent import PaperTradingAgent
from learning.performance_learning_engine import PerformanceLearningEngine

router = APIRouter(tags=["Autonomous Trading AI"])

brain = AutonomousTradingBrain(
    decision_engine=AITradeDecisionEngine(),
    paper_agent=PaperTradingAgent(),
    learning_engine=PerformanceLearningEngine()
)


class MarketContext(BaseModel):
    ticker: str
    price: float
    market_regime: str
    patterns: dict = {}
    strategy: dict
    volatility: float = 1


@router.post("/ai/autonomous-cycle")
def autonomous_cycle(context: MarketContext):
    return brain.analyze_market(context.model_dump())
