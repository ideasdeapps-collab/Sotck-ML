"""Risk management rules for paper trading simulation."""

from typing import Dict, Any

MAX_RISK = 0.01
MIN_RR = 1.5


def validate_trade(entry_price: float, stop_loss: float, take_profit: float, capital: float) -> Dict[str, Any]:
    risk = abs(entry_price - stop_loss)
    reward = abs(take_profit - entry_price)

    rr = reward / risk if risk else 0
    approved = rr >= MIN_RR and risk > 0

    risk_amount = capital * MAX_RISK
    position_size = risk_amount / risk if risk else 0

    return {
        "approved": approved,
        "risk_reward": round(rr, 2),
        "position_size": round(position_size, 2),
        "max_risk": MAX_RISK,
        "stop_loss": stop_loss,
        "take_profit": take_profit,
    }
