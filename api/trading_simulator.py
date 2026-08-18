"""
Trading Simulator Engine v1
Paper trading engine for minute-by-minute Polygon candles.

This module is intentionally deterministic in v1. The AI agent layer can replace
`generate_signal` in future iterations.
"""

from dataclasses import dataclass, asdict
from typing import List, Dict, Any


@dataclass
class Position:
    ticker: str
    shares: float
    entry_price: float
    entry_time: str


@dataclass
class Trade:
    ticker: str
    action: str
    price: float
    timestamp: str
    shares: float
    pnl: float = 0