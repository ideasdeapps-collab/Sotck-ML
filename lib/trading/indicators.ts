import type { Candle } from './marketData';
import { calculateSessionVwap, type VwapBands } from './dayTrading/sessionVwap';

export function calculateEMA(candles: Candle[], period: number) {
  const k = 2 / (period + 1);
  const result: number[] = [];
  candles.forEach((c, i) => {
    if (i === 0) result.push(c.close);
    else result.push(c.close * k + result[i - 1] * (1 - k));
  });
  return result;
}

/**
 * Session-anchored VWAP. Delegates to `dayTrading/sessionVwap` — this used to
 * accumulate over the entire series, which on the 1m timeframe (3-day lookback)
 * blended three sessions into a single, meaningless average.
 */
export function calculateVWAP(candles: Candle[]) {
  return calculateSessionVwap(candles).vwap;
}

export function calculateBollinger(candles: Candle[], period = 20) {
  const middle = candles.map(c => c.close);
  const upper = middle.map((_, i) => {
    const slice = middle.slice(Math.max(0, i - period + 1), i + 1);
    const avg = slice.reduce((a,b)=>a+b,0)/slice.length;
    const sd = Math.sqrt(slice.reduce((s,v)=>s+(v-avg)**2,0)/slice.length);
    return avg + sd * 2;
  });
  const lower = upper.map((u,i)=>2*middle[i]-u);
  return { upper, middle, lower };
}

export type Indicators = {
  ema20: number[];
  ema50: number[];
  vwap: number[];
  vwapBands: VwapBands;
  bollinger: { upper: number[]; middle: number[]; lower: number[] };
};

export function calculateIndicators(candles: Candle[]): Indicators {
  const vwapBands = calculateSessionVwap(candles);
  return {
    ema20: calculateEMA(candles,20),
    ema50: calculateEMA(candles,50),
    vwap: vwapBands.vwap,
    vwapBands,
    bollinger: calculateBollinger(candles)
  };
}
