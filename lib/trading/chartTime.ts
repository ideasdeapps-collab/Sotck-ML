/**
 * Time normalisation for the Trading Lab chart.
 *
 * lightweight-charts requires every series on a chart to share one time type.
 * The three sources we mix do NOT agree:
 *
 *   - `lib/trading/marketData.ts`  -> epoch seconds (Polygon `t` / 1000)
 *   - `/predict`, `/technical`     -> "YYYY-MM-DD" (daily, no time, no zone)
 *   - `/intraday`, `/predict-intraday` -> ISO with an ET offset ("...-04:00")
 *
 * Everything is converted to epoch SECONDS here, and nowhere else. Daily dates
 * are anchored to ET midnight because that is the convention Polygon uses for
 * its daily aggregates — anchoring them anywhere else shifts prediction curves
 * off the candles they are supposed to continue.
 */

import type { UTCTimestamp } from 'lightweight-charts';

const ET = 'America/New_York';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Offset of `timeZone` from UTC, in ms, at the given instant.
 * Positive east of Greenwich, so ET returns a negative number.
 */
function zoneOffsetMs(utcMs: number, timeZone = ET): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));

  const field = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const hour = field('hour') === 24 ? 0 : field('hour');

  const asIfUtc = Date.UTC(field('year'), field('month') - 1, field('day'), hour, field('minute'), field('second'));
  return asIfUtc - utcMs;
}

/**
 * Epoch seconds for a wall-clock time in New York. Two passes so the result
 * stays correct across a DST transition: the first offset is measured at the
 * wrong instant, the second at (almost always) the right one.
 */
export function etWallClockToEpoch(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let utcMs = naive - zoneOffsetMs(naive);
  utcMs = naive - zoneOffsetMs(utcMs);
  return Math.floor(utcMs / 1000);
}

/** "YYYY-MM-DD" -> epoch seconds at ET midnight (Polygon's daily convention). */
export function dailyDateToEpoch(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return etWallClockToEpoch(year, month, day);
}

/**
 * The single entry point. Accepts anything the API or Polygon hands us and
 * returns a chart-ready timestamp.
 */
export function toChartTime(value: string | number): UTCTimestamp {
  if (typeof value === 'number') {
    // Heuristic: anything past ~1973 in ms is a millisecond timestamp.
    return (value >= 1e11 ? Math.floor(value / 1000) : Math.floor(value)) as UTCTimestamp;
  }

  if (DATE_ONLY.test(value)) return dailyDateToEpoch(value) as UTCTimestamp;

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`Unparseable chart time: ${value}`);

  return Math.floor(parsed / 1000) as UTCTimestamp;
}

/**
 * Índice de la vela que contiene `value`, o null si cae antes de la primera.
 *
 * La API de ML pide sus propias barras a Polygon, así que un marcador intradía
 * puede caer unos segundos fuera del límite de la vela del gráfico — y
 * lightweight-charts descarta en silencio cualquier tiempo que no esté en su
 * escala. Ajustar a la última barra en o antes del valor es lo que hace que los
 * overlays de estructura aparezcan.
 *
 * `times` tiene que venir ordenado ascendente, como llegan las velas.
 */
export function snapIndex(times: number[], value: string | number): number | null {
  let target: number;
  try {
    target = Number(toChartTime(value));
  } catch {
    return null;
  }

  if (times.length === 0 || target < times[0]) return null;

  let low = 0;
  let high = times.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= target) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found === -1 ? null : found;
}

type EtParts = { date: string; hour: number; minute: number; minutesOfDay: number };

/** Calendar date and wall-clock time in New York for an epoch-seconds value. */
export function etParts(epochSeconds: number): EtParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(epochSeconds * 1000));

  const field = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = Number(field('hour')) === 24 ? 0 : Number(field('hour'));
  const minute = Number(field('minute'));

  return {
    date: `${field('year')}-${field('month')}-${field('day')}`,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

export const MARKET_OPEN_MINUTES = 9 * 60 + 30; // 09:30 ET
export const MARKET_CLOSE_MINUTES = 16 * 60; // 16:00 ET

export type SessionName = 'premarket' | 'regular' | 'afterhours';

export function sessionOf(epochSeconds: number): SessionName {
  const { minutesOfDay } = etParts(epochSeconds);
  if (minutesOfDay < MARKET_OPEN_MINUTES) return 'premarket';
  if (minutesOfDay >= MARKET_CLOSE_MINUTES) return 'afterhours';
  return 'regular';
}
