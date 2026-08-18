"""AI Trading Lab API routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from polygon_market import fetch_minute_candles
from market_features import generate_features
from strategy_engine import recommend_strategy
from ai_simulation import run_ai_simulation
from live_trading_engine import LiveTradingEngine

router = APIRouter(prefix="/ai", tags=["AI Trading"])

live_engine = LiveTradingEngine()


class AISimulationRequest(BaseModel):
    ticker: str = Field(..., examples=["NVDA"])
    capital: float = Field(10000, gt=0)
    days: int = Field(30, ge=1, le=365)
    strategy: str = "AUTO"


class LiveMonitorRequest(BaseModel):
    ticker: str = Field(..., examples=["NVDA"])


@router.post("/simulate-trading-ai")
def simulate_trading_ai(request: AISimulationRequest):
    try:
        candles = fetch_minute_candles(ticker=request.ticker, days=request.days)
        features = generate_features(candles)
        recommendation = recommend_strategy(features)

        selected_strategy = recommendation["recommended_strategy"] if request.strategy == "AUTO" else request.strategy

        result = run_ai_simulation(
            ticker=request.ticker,
            capital=request.capital,
            days=request.days,
            candles=candles,
            features=features,
            strategy=selected_strategy,
        )

        return {
            **result,
            "strategy_recommendation": recommendation,
            "features": features,
            "candles_processed": len(candles),
        }

    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/live-monitor")
def live_monitor(request: LiveMonitorRequest):
    try:
        candles = fetch_minute_candles(ticker=request.ticker, days=1)
        latest = candles[-1]
        features = generate_features(candles)

        return live_engine.process_candle(
            ticker=request.ticker,
            candle=latest,
            features=features,
        )

    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
