import type { Candle } from '../marketData';
import { MARKET_OPEN_MINUTES, etParts } from '../chartTime';

/**
 * Opening Range Breakout for the most recent session in the series.
 *
 * `api/strategies/opening_range_breakout.py` already branches on an
 * `opening_range_high` feature — but nothing in the repo ever computed it.
 * This is the producer of that value, kept client-side because it only needs
 * the candles the chart already holds.
 */

export type OpeningRange = {
  sessionDate: string;
  minutes: number;
  high: number;
  low: number;
  /** Time of the last bar inside the range — where the OR lines start. */
  from: number;
  to: number;
  breakout: { direction: 'UP' | 'DOWN'; time: number; price: number } | null;
};

export function calculateOpeningRange(candles: Candle[], minutes = 15): OpeningRange | null {
  if (candles.length === 0) return null;

  const lastDate = etParts(candles[candles.length - 1].time).date;
  const session = candles.filter((candle) => {
    const parts = etParts(candle.time);
    return parts.date === lastDate && parts.minutesOfDay >= MARKET_OPEN_MINUTES;
  });

  if (session.length === 0) return null;

  const openMinutes = etParts(session[0].time).minutesOfDay;
  // The first regular bar must actually be the open: on a coarse timeframe, or
  // on data that starts mid-session, there is no opening range to speak of.
  if (openMinutes > MARKET_OPEN_MINUTES + minutes) return null;

  const inRange = session.filter((candle) => etParts(candle.time).minutesOfDay < MARKET_OPEN_MINUTES + minutes);
  if (inRange.length === 0) return null;

  const high = Math.max(...inRange.map((candle) => candle.high));
  const low = Math.min(...inRange.map((candle) => candle.low));

  let breakout: OpeningRange['breakout'] = null;
  for (const candle of session) {
    if (candle.time <= inRange[inRange.length - 1].time) continue;
    if (candle.close > high) {
      breakout = { direction: 'UP', time: candle.time, price: candle.close };
      break;
    }
    if (candle.close < low) {
      breakout = { direction: 'DOWN', time: candle.time, price: candle.close };
      break;
    }
  }

  return {
    sessionDate: lastDate,
    minutes,
    high: +high.toFixed(4),
    low: +low.toFixed(4),
    from: inRange[0].time,
    to: session[session.length - 1].time,
    breakout,
  };
}
