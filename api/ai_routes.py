"""AI Trading Lab API routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from polygon_market import fetch_minute_candles
from market_features import generate_features
from ai_simulation import run_ai_simulation

router = APIRouter(prefix="/ai", tags=["AI Trading"])


class AISimulationRequest(BaseModel):
    ticker: str = Field(..., examples=["NVDA"])
    capital: float = Field(10000, gt=0)
    days: int = Field(30, ge=1, le=365)
    strategy: str = "AI_HYBRID"


@router.post("/simulate-trading-ai")
def simulate_trading_ai(request: AISimulationRequest):
    try:
        candles = fetch_minute_candles(
            ticker=request.ticker,
            days=request.days,
        )

        features = generate_features(candles)

        result = run_ai_simulation(
            ticker=request.ticker,
            capital=request.capital,
            days=request.days,
            candles=candles,
            features=features,
        )

        return {
            **result,
            "strategy": request.strategy,
            "features": features,
            "candles_processed": len(candles),
        }

    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
