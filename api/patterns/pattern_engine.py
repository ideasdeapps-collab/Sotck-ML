from .support_resistance import SupportResistanceDetector
from .fair_value_gap import FairValueGapDetector
from .order_blocks import OrderBlockDetector
from .liquidity_detector import LiquiditySweepDetector


class PatternEngine:
    def analyze(self, candles):
        return {
            "support_resistance": SupportResistanceDetector().analyze(candles),
            "fair_value_gaps": FairValueGapDetector().analyze(candles),
            "order_blocks": OrderBlockDetector().analyze(candles),
            "liquidity": LiquiditySweepDetector().analyze(candles),
        }
