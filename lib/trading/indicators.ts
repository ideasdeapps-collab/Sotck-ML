import type { Candle } from './marketData';

export function calculateEMA(candles: Candle[], period: number) {
  const k = 2 / (period + 1);
  const result: number[] = [];
  candles.forEach((c, i) => {
    if (i === 0) result.push(c.close);
    else result.push(c.close * k + result[i - 1] * (1 - k));
  });
  return result;
}

export function calculateVWAP(candles: Candle[]) {
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  return candles.map(c => {
    const typical = (c.high + c.low + c.close) / 3;
    cumulativeValue += typical * c.volume;
    cumulativeVolume += c.volume;
    return cumulativeValue / cumulativeVolume;
  });
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

export function calculateIndicators(candles: Candle[]) {
  return {
    ema20: calculateEMA(candles,20),
    ema50: calculateEMA(candles,50),
    vwap: calculateVWAP(candles),
    bollinger: calculateBollinger(candles)
  };
}
