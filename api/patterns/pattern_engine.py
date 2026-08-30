from .support_resistance import SupportResistanceDetector
from .fair_value_gap import FairValueGapDetector
from .order_blocks import OrderBlockDetector
from .liquidity_detector import LiquiditySweepDetector


class PatternEngine:
    def analyze(self, candles, levels=None):
        """`levels` = chartism["support"]/["resistance"] de intraday.analyze_intraday.

        Se pasa desde fuera en lugar de recalcularlo aquí para no duplicar el
        clustering de pivotes que ya hace intraday.py.
        """
        return {
            "support_resistance": SupportResistanceDetector().analyze(candles, levels),
            "fair_value_gaps": FairValueGapDetector().analyze(candles),
            "order_blocks": OrderBlockDetector().analyze(candles),
            "liquidity": LiquiditySweepDetector().analyze(candles),
        }
