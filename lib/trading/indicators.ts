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

/**
 * RSI with Wilder's smoothing — the same definition `api/signals.py` uses, so
 * a "RSI < 45" read in the Trading Lab agrees with the backend's.
 *
 * The first `period` entries have no defined value and come back as NaN;
 * `alignedLine` in the overlay painter already skips non-finite points.
 */
export function calculateRSI(candles: Candle[], period = 14): number[] {
  const rsi: number[] = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return rsi;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }

  avgGain /= period;
  avgLoss /= period;
  // A period with no losses is not a divide-by-zero, it is RSI 100.
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return rsi;
}

/**
 * Average True Range, Wilder-smoothed.
 *
 * The intraday plan uses it for level-band widths and the stop buffer: a fixed
 * percentage buffer is either noise on a quiet ticker or inside the spread on a
 * volatile one, while ATR scales with whatever the session is actually doing.
 */
export function calculateATR(candles: Candle[], period = 14): number[] {
  const atr: number[] = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return atr;

  const trueRanges: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    trueRanges.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  let value = 0;
  for (let i = 1; i <= period; i++) value += trueRanges[i];
  value /= period;
  atr[period] = value;

  for (let i = period + 1; i < candles.length; i++) {
    value = (value * (period - 1) + trueRanges[i]) / period;
    atr[i] = value;
  }

  return atr;
}

export type Indicators = {
  ema20: number[];
  ema50: number[];
  vwap: number[];
  vwapBands: VwapBands;
  bollinger: { upper: number[]; middle: number[]; lower: number[] };
  rsi14: number[];
  atr14: number[];
};

export function calculateIndicators(candles: Candle[]): Indicators {
  const vwapBands = calculateSessionVwap(candles);
  return {
    ema20: calculateEMA(candles,20),
    ema50: calculateEMA(candles,50),
    vwap: vwapBands.vwap,
    vwapBands,
    bollinger: calculateBollinger(candles),
    rsi14: calculateRSI(candles, 14),
    atr14: calculateATR(candles, 14)
  };
}
