"""AI optimizer API routes."""

from fastapi import APIRouter
from pydantic import BaseModel

from ai_optimizer import optimize_parameters

router = APIRouter(prefix="/ai", tags=["AI Optimization"])


class OptimizerRequest(BaseModel):
    strategy: str
    historical_results: list = []


@router.post("/optimize-strategy")
def optimize(request: OptimizerRequest):
    return optimize_parameters(
        request.strategy,
        request.historical_results,
    )
