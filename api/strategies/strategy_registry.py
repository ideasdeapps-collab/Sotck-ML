from .momentum_breakout import MomentumBreakout
from .ema_pullback import EMAPullback
from .vwap_reclaim import VWAPReclaim
from .mean_reversion import MeanReversion
from .rsi_divergence import RSIDivergence
from .macd_trend import MACDTrend
from .bollinger_squeeze import BollingerSqueeze
from .opening_range_breakout import OpeningRangeBreakout
from .volume_breakout import VolumeBreakout
from .trend_following import TrendFollowing
from .liquidity_sweep import LiquiditySweep

STRATEGIES = {
    "Momentum Breakout": MomentumBreakout(),
    "EMA Pullback": EMAPullback(),
    "VWAP Reclaim": VWAPReclaim(),
    "Mean Reversion": MeanReversion(),
    "RSI Divergence": RSIDivergence(),
    "MACD Trend": MACDTrend(),
    "Bollinger Squeeze": BollingerSqueeze(),
    "Opening Range Breakout": OpeningRangeBreakout(),
    "Volume Breakout": VolumeBreakout(),
    "Trend Following": TrendFollowing(),
    "Liquidity Sweep": LiquiditySweep(),
}


def get_strategy(name):
    return STRATEGIES.get(name)
