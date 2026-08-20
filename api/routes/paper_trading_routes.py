from fastapi import APIRouter
from pydantic import BaseModel

from paper_trading.paper_trading_agent import PaperTradingAgent

router = APIRouter(tags=["Paper Trading"])
agent = PaperTradingAgent()


class PaperTradeRequest(BaseModel):
    signal: dict


class MonitorRequest(BaseModel):
    price: float


@router.post("/paper-trade/execute")
def execute_trade(request: PaperTradeRequest):
    return agent.execute(request.signal)


@router.post("/paper-trade/monitor")
def monitor_trade(request: MonitorRequest):
    return agent.monitor(request.price)
