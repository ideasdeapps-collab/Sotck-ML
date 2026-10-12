import { barStart } from '../overlays/liveTrail';
import type { TrailSlot } from '../overlays/liveTrail';

/**
 * Lleva los puntos de una predicción al eje del gráfico.
 *
 * lightweight-charts coloca por índice: un punto cuya hora no es una vela
 * metería una ranura nueva en mitad del eje. Dentro del rango de velas cada
 * punto se lleva a su barra (y se descarta si esa barra no existe); por delante
 * de la última vela se reserva una ranura por barra (whitespace) para que el
 * tiempo futuro se vea con su escala real. En diario no se dibuja: toda la
 * sesión cabe en una vela.
 */

const BAR_SECONDS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1H': 3600 };
/** Una predicción más allá de esto por delante de la última vela es de otra sesión: no se rellena el hueco. */
const MAX_AHEAD_SECONDS = 12 * 3600;

export function predictionSlots(
  points: { time: number; value: number }[],
  candleTimes: number[],
  timeframe: string
): TrailSlot[] {
  const step = BAR_SECONDS[timeframe];
  if (!step || points.length === 0 || candleTimes.length === 0) return [];

  const lastCandle = candleTimes[candleTimes.length - 1];
  const candles = new Set(candleTimes);
  const byBar = new Map<number, number>();

  for (const point of points) {
    const bar = barStart(point.time, timeframe);
    if (bar <= lastCandle && !candles.has(bar)) continue;
    if (bar - lastCandle > MAX_AHEAD_SECONDS) continue;
    byBar.set(bar, point.value);
  }

  const bars = Array.from(byBar.keys()).sort((a, b) => a - b);
  if (bars.length === 0) return [];

  const slots: TrailSlot[] = bars.filter((bar) => bar <= lastCandle).map((bar) => ({ time: bar, value: byBar.get(bar)! }));
  const lastBar = bars[bars.length - 1];

  for (let time = lastCandle + step; time <= lastBar; time += step) {
    const value = byBar.get(time);
    slots.push(value === undefined ? { time } : { time, value });
  }

  return slots;
}
