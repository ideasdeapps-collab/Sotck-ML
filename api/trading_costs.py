"""Trading execution cost model."""

from typing import Dict


def apply_execution_costs(
    price: float,
    shares: float,
    commission_rate: float = 0.001,
    slippage_rate: float = 0.0005,
) -> Dict[str, float]:
    gross_value = price * shares
    commission = gross_value * commission_rate
    slippage = gross_value * slippage_rate

    return {
        "gross_value": round(gross_value, 4),
        "commission": round(commission, 4),
        "slippage": round(slippage, 4),
        "total_cost": round(commission + slippage, 4),
        "net_value": round(gross_value - commission - slippage, 4),
    }
