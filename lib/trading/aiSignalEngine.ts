import { calculateIndicators } from './indicators';
import type { Candle } from './marketData';
import type { SeriesMarker, Time } from 'lightweight-charts';

export type AISignal = {
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  strategy: string;
  entry: number;
  stop: number;
  target: number;
  reasons: string[];
};

export function generateAISignal(candles: Candle[] | undefined): AISignal {
  const series = Array.isArray(candles) ? candles : [];
  const last = series[series.length - 1];

  if (!last) {
    return {
      signal: 'HOLD',
      confidence: 0,
      strategy: 'No market data',
      entry: 0,
      stop: 0,
      target: 0,
      reasons: ['No candles available'],
    };
  }

  const indicators = calculateIndicators(series);
  const ema20 = indicators.ema20.at(-1) ?? last.close;
  const ema50 = indicators.ema50.at(-1) ?? last.close;
  const vwap = indicators.vwap.at(-1) ?? last.close;

  const bullish = last.close > ema20 && ema20 > ema50;
  const bearish = last.close < ema20 && ema20 < ema50;

  const reasons = [
    `Close ${last.close.toFixed(2)} vs EMA20 ${ema20.toFixed(2)}`,
    `EMA20 ${ema20 > ema50 ? 'above' : 'below'} EMA50`,
    `${last.close > vwap ? 'Above' : 'Below'} VWAP`,
  ];

  if (bullish) {
    return {
      signal: 'BUY',
      confidence: last.close > vwap ? 91 : 78,
      strategy: 'Momentum Breakout',
      entry: +last.close.toFixed(2),
      stop: +(last.close * 0.98).toFixed(2),
      target: +(last.close * 1.04).toFixed(2),
      reasons,
    };
  }

  if (bearish) {
    return {
      signal: 'SELL',
      confidence: last.close < vwap ? 84 : 70,
      strategy: 'Trend Breakdown',
      entry: +last.close.toFixed(2),
      stop: +(last.close * 1.02).toFixed(2),
      target: +(last.close * 0.96).toFixed(2),
      reasons,
    };
  }

  return {
    signal: 'HOLD',
    confidence: 55,
    strategy: 'Trend Monitoring',
    entry: +last.close.toFixed(2),
    stop: +(last.close * 0.98).toFixed(2),
    target: +(last.close * 1.04).toFixed(2),
    reasons,
  };
}

export function generateAIMarker(candle: Candle, signal: 'BUY' | 'SELL'): SeriesMarker<Time> {
  return signal === 'BUY'
    ? {
        time: candle.time as Time,
        position: 'belowBar',
        color: '#22c55e',
        shape: 'arrowUp',
        text: 'BUY',
      }
    : {
        time: candle.time as Time,
        position: 'aboveBar',
        color: '#ef4444',
        shape: 'arrowDown',
        text: 'SELL',
      };
}

export function signalToMarker(candles: Candle[], signal: 'BUY' | 'SELL'): SeriesMarker<Time>[] {
  const last = candles?.[candles.length - 1];
  if (!last) return [];
  return [generateAIMarker(last, signal)];
}
