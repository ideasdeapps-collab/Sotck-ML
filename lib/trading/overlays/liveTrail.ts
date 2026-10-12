import { dailyDateToEpoch, etParts } from '../chartTime';
import type { LiveQuote } from '../liveQuote/sources';

export type { LiveQuote };

/**
 * Rastro del precio web en vivo sobre el gráfico.
 *
 * Las velas de Polygon llegan con ~15 min de retraso; cada consulta a la web
 * deja un punto por delante de ellas. Los puntos se llevan al inicio de su
 * barra: lightweight-charts trata cada marca de tiempo nueva como una ranura
 * del eje, y puntos cada 15 s entre velas de 1 min deformarían todo el eje.
 */

export const MAX_TRAIL = 300;

const BAR_SECONDS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1H': 3600 };

/** Inicio de la barra que contiene `epoch`, con la misma convención que Polygon. */
export function barStart(epoch: number, timeframe: string): number {
  const step = BAR_SECONDS[timeframe];
  // Las diarias de Polygon están ancladas a la medianoche ET, no a la UTC.
  if (!step) return dailyDateToEpoch(etParts(epoch).date);
  return epoch - (epoch % step);
}

/** Añade una cotización manteniendo orden, sin duplicados y con tope. */
export function appendQuote(trail: LiveQuote[], quote: LiveQuote, max = MAX_TRAIL): LiveQuote[] {
  if (trail.some((item) => item.time === quote.time && item.price === quote.price)) return trail;

  const next = [...trail, quote].sort((a, b) => a.time - b.time);
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Un punto por barra con el último precio visto en ella, en orden. */
export function trailPoints(trail: LiveQuote[], timeframe: string): { time: number; value: number }[] {
  const byBar = new Map<number, number>();
  for (const quote of trail) byBar.set(barStart(quote.time, timeframe), quote.price);

  return Array.from(byBar, ([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time);
}

const SOURCE_LABEL: Record<LiveQuote['source'], string> = { yahoo: 'Yahoo', nasdaq: 'Nasdaq' };

/** Leyenda bajo el gráfico: el desvío es lo que se movió el precio durante el retraso. */
export function liveLegend(quote: LiveQuote, lastCandleClose: number | null): string {
  const hora = new Date(quote.time * 1000).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/New_York',
  });

  let text = `Precio web · $${quote.price.toFixed(2)} · ${hora} ET · ${SOURCE_LABEL[quote.source]}`;

  if (lastCandleClose !== null && lastCandleClose > 0) {
    const drift = ((quote.price - lastCandleClose) / lastCandleClose) * 100;
    text += ` · ${drift >= 0 ? '+' : ''}${drift.toFixed(2)}% vs última vela Polygon`;
  }

  return text;
}

/**
 * Más allá de esto el hueco no es el retraso de Polygon sino un cierre (noche,
 * fin de semana): rellenarlo metería cientos de ranuras vacías en el eje.
 */
const MAX_GAP_SECONDS = 2 * 3600;

export type TrailSlot = { time: number; value: number } | { time: number };

/**
 * Los puntos del rastro más las ranuras vacías que los separan de la última vela.
 *
 * lightweight-charts coloca por índice, no por tiempo: un punto 15 min después
 * de la última vela aparecería pegado a ella. Una ranura vacía por barra (dato
 * sin `value`, que la librería acepta como whitespace) reserva el hueco real,
 * así que el retraso de Polygon se ve como lo que es.
 */
export function trailSlots(points: { time: number; value: number }[], lastCandleTime: number, timeframe: string): TrailSlot[] {
  const step = BAR_SECONDS[timeframe];
  if (!step || points.length === 0) return points;

  const slots: TrailSlot[] = [];
  let previous = lastCandleTime;

  for (const point of points) {
    const gap = point.time - previous;
    if (previous >= lastCandleTime && gap > step && gap <= MAX_GAP_SECONDS) {
      for (let time = previous + step; time < point.time; time += step) slots.push({ time });
    }
    slots.push(point);
    previous = Math.max(previous, point.time);
  }

  return slots;
}
