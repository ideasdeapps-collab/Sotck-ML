import { TradeSignal } from '@/types/trading';

export function evaluateStrategies(): TradeSignal[] {
  return [
    {
      name: 'Momentum Baseline',
      direction: 'WAIT',
      confidence: 0,
      reason: 'Strategy engine initialized',
    },
  ];
}
