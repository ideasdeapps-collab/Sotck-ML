"""Backtest comparison routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from polygon_market import fetch_minute_candles
from market_features import generate_features
from backtest_engine import run_strategy_backtest

router = APIRouter(prefix="/ai", tags=["AI Backtesting"])


class BacktestRequest(BaseModel):
    ticker: str
    capital: float = Field(10000, gt=0)
    days: int = Field(90, ge=1, le=365)


@router.post("/backtest-compare")
def compare(request: BacktestRequest):
    try:
        candles = fetch_minute_candles(
            request.ticker,
            request.days,
        )

        features = generate_features(candles)

        ranking = run_strategy_backtest(
            request.ticker,
            request.capital,
            request.days,
            candles,
            features,
        )

        return {
            "ticker": request.ticker,
            "period_days": request.days,
            "ranking": ranking,
        }

    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
