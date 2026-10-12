import { etWallClockToEpoch } from '../chartTime';

/**
 * Lectores de cotización en vivo de fuentes web públicas, sin clave y sin IA.
 *
 * Son endpoints no oficiales: pueden cambiar de forma sin aviso. Por eso cada
 * parser devuelve null ante cualquier cosa que no reconozca en lugar de lanzar,
 * y la ruta prueba la siguiente fuente. Puros a propósito: los tests no tocan la
 * red y la ruta solo hace fetch.
 */

export type QuoteSource = 'yahoo' | 'nasdaq';

export type LiveQuote = {
  price: number;
  /** Epoch en segundos de la operación según la fuente, no del servidor. */
  time: number;
  source: QuoteSource;
};

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** El ticker acaba dentro de una URL externa: solo pasa lo que tiene forma de símbolo. */
export function isValidTicker(ticker: string): boolean {
  return TICKER.test(ticker);
}

/** Yahoo escribe las clases de acción con guion (BRK-B), Polygon y Nasdaq con punto. */
export function yahooSymbol(ticker: string): string {
  return ticker.replace(/\./g, '-');
}

export function yahooUrl(ticker: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(ticker))}?interval=1m&range=1d&includePrePost=true`;
}

export function nasdaqUrl(ticker: string, assetClass: 'stocks' | 'etf'): string {
  return `https://api.nasdaq.com/api/quote/${encodeURIComponent(ticker)}/info?assetclass=${assetClass}`;
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Yahoo v8 chart con `includePrePost`.
 *
 * `meta.regularMarketPrice` es solo de la sesión regular: en premarket devuelve
 * el cierre de ayer. La última barra de 1 min con cierre sí cubre pre y
 * post-market, así que manda ella y `meta` queda de respaldo.
 */
export function parseYahooChart(json: any): LiveQuote | null {
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const times: unknown[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes: unknown[] = Array.isArray(result.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];

  for (let i = Math.min(times.length, closes.length) - 1; i >= 0; i--) {
    const time = times[i];
    const close = closes[i];
    if (positive(close) && positive(time)) return { price: close, time, source: 'yahoo' };
  }

  const meta = result.meta;
  if (positive(meta?.regularMarketPrice) && positive(meta?.regularMarketTime)) {
    return { price: meta.regularMarketPrice, time: meta.regularMarketTime, source: 'yahoo' };
  }

  return null;
}

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

/** "Oct 12, 2026 8:15 AM ET" o "Closed at Oct 9, 2026 4:00 PM ET" -> epoch en segundos. */
export function parseNasdaqTimestamp(text: string): number | null {
  const match = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (AM|PM) ET/.exec(text);
  if (!match) return null;

  const [, monthName, day, year, hour, minute, meridiem] = match;
  const month = MONTHS[monthName];
  if (!month) return null;

  const hour12 = Number(hour) % 12;
  return etWallClockToEpoch(Number(year), month, Number(day), meridiem === 'PM' ? hour12 + 12 : hour12, Number(minute));
}

/**
 * Nasdaq `quote/{ticker}/info`. `primaryData` es la última venta, también en
 * pre y post-market; la hora solo trae minutos, por eso Yahoo va primero.
 */
export function parseNasdaqQuote(json: any): LiveQuote | null {
  const primary = json?.data?.primaryData;
  if (!primary) return null;

  const price = Number(String(primary.lastSalePrice ?? '').replace(/[$,]/g, ''));
  const time = parseNasdaqTimestamp(String(primary.lastTradeTimestamp ?? ''));

  if (!positive(price) || time === null) return null;
  return { price, time, source: 'nasdaq' };
}
