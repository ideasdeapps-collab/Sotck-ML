import { dailyDateToEpoch, etParts, etWallClockToEpoch } from '../chartTime';

/**
 * Cuánto se mueve cada eslabón, a partir de barras de 1 minuto de Polygon.
 *
 * Una sola petición por ticker trae los dos últimos días: de ahí salen el
 * cierre regular anterior (para el % del día), las barras de hace 5 y 15 min y
 * la minilínea de la sesión. Puro: la ruta solo descarga.
 */

export type Bar = { t: number; c: number };

export type TickerMove = {
  price: number;
  /** Epoch ms de la última barra (con el retraso de 15 min del plan Starter). */
  time: number;
  prevClose: number | null;
  change1d: number | null;
  change5m: number | null;
  change15m: number | null;
  sparkline: number[];
};

export type MoveMetric = 'change1d' | 'change15m' | 'change5m';

const SPARK_POINTS = 60;
const MINUTE = 60_000;

export function parseMinuteAggs(json: any): Bar[] | null {
  const results = json?.results;
  if (!Array.isArray(results)) return null;

  const bars = results
    .filter((bar: any) => Number.isFinite(bar?.t) && Number.isFinite(bar?.c) && bar.c > 0)
    .map((bar: any) => ({ t: bar.t, c: bar.c }));

  return bars.length > 0 ? bars : null;
}

const pct = (now: number, before: number | null | undefined) => (before ? (now / before - 1) * 100 : null);

/** Cierre de la última barra con `t <= limit`, o null. `bars` ordenado ascendente. */
function closeAtOrBefore(bars: Bar[], limit: number): number | null {
  for (let i = bars.length - 1; i >= 0; i--) if (bars[i].t <= limit) return bars[i].c;
  return null;
}

export function summarizeBars(input: Bar[]): TickerMove | null {
  const bars = input.filter((bar) => Number.isFinite(bar.t) && bar.c > 0).sort((a, b) => a.t - b.t);
  if (bars.length === 0) return null;

  const last = bars[bars.length - 1];

  // Límites del día ET con dos llamadas a Intl, no una por barra.
  const sessionStart = dailyDateToEpoch(etParts(last.t / 1000).date) * 1000;
  const today = bars.filter((bar) => bar.t >= sessionStart);
  const before = bars.filter((bar) => bar.t < sessionStart);

  // Cierre regular anterior: la última barra antes de las 16:00 ET de ese día;
  // el after-hours no cuenta, igual que en cualquier «% del día».
  let prevClose: number | null = null;
  if (before.length > 0) {
    const [year, month, day] = etParts(before[before.length - 1].t / 1000).date.split('-').map(Number);
    prevClose = closeAtOrBefore(before, etWallClockToEpoch(year, month, day, 16, 0) * 1000 - 1);
  }

  const step = Math.ceil(today.length / SPARK_POINTS);
  const sparkline = today.filter((_, i) => i % step === 0).map((bar) => bar.c);
  // El muestreo puede saltarse la última barra; la línea tiene que acabar en el precio actual.
  if ((today.length - 1) % step !== 0) sparkline.push(last.c);

  return {
    price: last.c,
    time: last.t,
    prevClose,
    change1d: pct(last.c, prevClose),
    change5m: pct(last.c, closeAtOrBefore(today, last.t - 5 * MINUTE)),
    change15m: pct(last.c, closeAtOrBefore(today, last.t - 15 * MINUTE)),
    sparkline,
  };
}

export function linkAverage(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) / present.length : null;
}

/** Fondo de una casilla: verde o rojo, con intensidad proporcional al movimiento hasta `scale` %. */
export function moveColor(change: number | null, scale: number): string {
  if (change === null) return 'rgba(148, 163, 184, 0.08)';
  if (change === 0) return 'rgba(148, 163, 184, 0.15)';

  const alpha = Number((0.15 + 0.7 * Math.min(1, Math.abs(change) / scale)).toFixed(2));
  return change > 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
}
