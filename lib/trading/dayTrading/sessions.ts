import type { Candle } from '../marketData';
import { etParts, sessionOf, type SessionName } from '../chartTime';

/** Previous-day high / low / close — the reference levels most day traders mark first. */
export type PreviousDayLevels = { date: string; high: number; low: number; close: number };

export function previousDayLevels(candles: Candle[]): PreviousDayLevels | null {
  if (candles.length === 0) return null;

  const today = etParts(candles[candles.length - 1].time).date;

  // Walk backwards to the most recent date that is not today.
  let previous = '';
  for (let i = candles.length - 1; i >= 0; i--) {
    const date = etParts(candles[i].time).date;
    if (date !== today) {
      previous = date;
      break;
    }
  }
  if (!previous) return null;

  const bars = candles.filter((candle) => etParts(candle.time).date === previous);
  if (bars.length === 0) return null;

  return {
    date: previous,
    high: +Math.max(...bars.map((b) => b.high)).toFixed(4),
    low: +Math.min(...bars.map((b) => b.low)).toFixed(4),
    close: bars[bars.length - 1].close,
  };
}

export type SessionSegment = { session: SessionName; date: string; from: number; to: number };

/**
 * Contiguous premarket / regular / after-hours runs, for shading the chart.
 * The date is part of the identity: two consecutive regular sessions are two
 * segments, not one block spanning the overnight gap.
 */
export function sessionSegments(candles: Candle[]): SessionSegment[] {
  const segments: SessionSegment[] = [];

  for (const candle of candles) {
    const session = sessionOf(candle.time);
    const date = etParts(candle.time).date;
    const current = segments[segments.length - 1];

    if (current && current.session === session && current.date === date) {
      current.to = candle.time;
    } else {
      segments.push({ session, date, from: candle.time, to: candle.time });
    }
  }

  return segments;
}
