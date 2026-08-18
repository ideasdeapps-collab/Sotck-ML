"""AI strategy recommendation routes."""

from fastapi import APIRouter

from strategy_engine import recommend_strategy

router = APIRouter(prefix="/ai", tags=["AI Trading"])


@router.post("/recommend-strategy")
def recommend(features: dict):
    return recommend_strategy(features)


@router.get("/strategies")
def strategies():
    return {
        "strategies": [
            "AI_HYBRID",
            "EMA_CROSSOVER",
            "RSI_MOMENTUM",
            "BREAKOUT",
            "MEAN_REVERSION",
        ]
    }
