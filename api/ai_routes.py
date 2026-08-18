"""AI Trading Lab API routes.

This module isolates AI simulation endpoints before wiring into main.py.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai_simulation import run_ai_simulation

router = APIRouter(prefix="/ai", tags=["AI Trading"])


class AISimulationRequest(BaseModel):
    ticker: str = Field(..., examples=["NVDA"])
    capital: float = Field(10000, gt=0)
    days: int = Field(30, ge=1, le=365)
    strategy: str = "AI_HYBRID"
    candles: list = []
    features: dict = {}


@router.post("/simulate-trading-ai")
def simulate_trading_ai(request: AISimulationRequest):
    try:
        return run_ai_simulation(
            ticker=request.ticker,
            capital=request.capital,
            days=request.days,
            candles=request.candles,
            features=request.features,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
