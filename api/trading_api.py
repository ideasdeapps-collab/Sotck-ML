"""
Trading Simulator API routes.
Mount this router from main.py with:
from trading_api import router as trading_router
app.include_router(trading_router)
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from trading_simulator import simulate_trading

router = APIRouter()


class TradingSimulationRequest(BaseModel):
    ticker: str = Field(..., examples=["NVDA"])
    capital: float = Field(10000, gt=0)
    candles: list = Field(default_factory=list)


@router.post("/simulate-trading")
def simulate_trading_endpoint(req: TradingSimulationRequest):
    """Run a paper trading simulation over minute candles.

    Candles format:
    {
      "timestamp":"2026-08-17T09:31:00",
      "close":178.25,
      "indicators":{
          "trend":"up",
          "volume_ratio":1.8
      }
    }
    """
    if not req.candles:
        raise HTTPException(400, "candles array is required")

    return simulate_trading(
        candles=req.candles,
        ticker=req.ticker,
        capital=req.capital,
    )
