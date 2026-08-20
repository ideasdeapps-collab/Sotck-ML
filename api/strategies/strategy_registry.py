from .momentum_breakout import MomentumBreakout

STRATEGIES = {
    "Momentum Breakout": MomentumBreakout()
}


def get_strategy(name):
    return STRATEGIES.get(name)
