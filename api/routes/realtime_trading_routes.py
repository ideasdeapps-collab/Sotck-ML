from fastapi import APIRouter
from pydantic import BaseModel
from realtime.realtime_agent import RealTimeTradingAgent

router = APIRouter()
agent = RealTimeTradingAgent()

class RealtimeRequest(BaseModel):
    ticker: str
    mode: str = "LIVE"

@router.post("/ai/realtime-monitor")
def realtime_monitor(request: RealtimeRequest):
    decision = agent.process_candle(
        request.ticker,
        {"open": 220, "close": 222}
    )
    return {
        "ticker": request.ticker.upper(),
        "market": "BULLISH TREND",
        **decision,
        "monitoring": True
    }
