import type { Candle } from '../marketData';
import { etParts } from '../chartTime';

/**
 * Session-anchored VWAP with standard-deviation bands.
 *
 * The previous `calculateVWAP` in `indicators.ts` accumulated across the whole
 * series. On the `1m` timeframe `marketData.ts` requests a 3-day lookback, so
 * the "VWAP" shown in IndicatorsPanel blended three sessions into one number
 * and drifted further from the real value with every bar of the day. VWAP is
 * by definition anchored to the session open, so the accumulator resets on
 * every new ET calendar date.
 *
 * Daily bars are the exception: one bar per session makes an anchored VWAP
 * equal to the bar's own typical price, which is useless. There we keep the
 * running cumulative value and say so via `anchored: false`.
 */

export type VwapBands = {
  vwap: number[];
  upper1: number[];
  lower1: number[];
  upper2: number[];
  lower2: number[];
  /** false when the series is daily or coarser and no session reset applies. */
  anchored: boolean;
};

const DAY_SECONDS = 86400;

/** Median spacing between bars, used to tell intraday series from daily ones. */
function medianBarSeconds(candles: Candle[]): number {
  if (candles.length < 3) return 0;
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const gap = candles[i].time - candles[i - 1].time;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export function calculateSessionVwap(candles: Candle[]): VwapBands {
  const empty: VwapBands = { vwap: [], upper1: [], lower1: [], upper2: [], lower2: [], anchored: false };
  if (candles.length === 0) return empty;

  const anchored = medianBarSeconds(candles) > 0 && medianBarSeconds(candles) < DAY_SECONDS;

  const vwap: number[] = [];
  const upper1: number[] = [];
  const lower1: number[] = [];
  const upper2: number[] = [];
  const lower2: number[] = [];

  let session = '';
  let cumVolume = 0;
  let cumValue = 0;
  let cumSquared = 0;

  for (const candle of candles) {
    if (anchored) {
      const date = etParts(candle.time).date;
      if (date !== session) {
        session = date;
        cumVolume = 0;
        cumValue = 0;
        cumSquared = 0;
      }
    }

    const typical = (candle.high + candle.low + candle.close) / 3;
    // A zero-volume bar would freeze the average; weight it as 1 so the curve
    // still advances (Polygon does emit empty bars outside regular hours).
    const volume = candle.volume > 0 ? candle.volume : 1;

    cumValue += typical * volume;
    cumSquared += typical * typical * volume;
    cumVolume += volume;

    const mean = cumValue / cumVolume;
    const variance = Math.max(cumSquared / cumVolume - mean * mean, 0);
    const sd = Math.sqrt(variance);

    vwap.push(mean);
    upper1.push(mean + sd);
    lower1.push(mean - sd);
    upper2.push(mean + 2 * sd);
    lower2.push(mean - 2 * sd);
  }

  return { vwap, upper1, lower1, upper2, lower2, anchored };
}
