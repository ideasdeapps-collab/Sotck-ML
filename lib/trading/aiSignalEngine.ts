import { calculateIndicators } from './indicators';
import type { Candle } from './marketData';
import type { SeriesMarker, Time } from 'lightweight-charts';

export function generateAISignal(candles: Candle[]) {
  const indicators = calculateIndicators(candles);
  const last = candles[candles.length - 1];
  const ema20 = indicators.ema20.at(-1) || last.close;
  const ema50 = indicators.ema50.at(-1) || last.close;

  const bullish = last.close > ema20 && ema20 > ema50;

  return {
    signal: bullish ? 'BUY' : 'HOLD',
    confidence: bullish ? 91 : 55,
    strategy: bullish ? 'Momentum Breakout' : 'Trend Monitoring',
    entry: last.close,
    stop: last.close * 0.98,
    target: last.close * 1.04
  };
}

export function generateAIMarker(
  candle: Candle,
  signal: 'BUY' | 'SELL'
): SeriesMarker<Time> {
  return signal === 'BUY'
    ? {
        time: candle.time as Time,
        position: 'belowBar',
        color: '#22c55e',
        shape: 'arrowUp',
        text: 'BUY'
      }
    : {
        time: candle.time as Time,
        position: 'aboveBar',
        color: '#ef4444',
        shape: 'arrowDown',
        text: 'SELL'
      };
}

export function signalToMarker(
  candles: Candle[],
  signal: 'BUY' | 'SELL'
): SeriesMarker<Time>[] {
  const last = candles[candles.length - 1];

  if (!last) return [];

  return [generateAIMarker(last, signal)];
}
