import { parseMinuteAggs, type Bar } from './aiEcosystem/moves';

/**
 * Barras de 1 min de Polygon de los últimos días, solo en el servidor.
 *
 * El diagrama del ecosistema y la carrera piden muchas veces los mismos tickers
 * (la carrera por defecto es la columna de memoria): una caché de 60 s por
 * ticker, más la deduplicación de peticiones en vuelo, hace que cada ticker
 * cueste una llamada por minuto aunque lo pidan los dos paneles y varias pestañas.
 */

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 8000;
const LOOKBACK_DAYS = 5;

const cache = new Map<string, { bars: Bar[]; at: number }>();
const pending = new Map<string, Promise<Bar[] | string>>();

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function download(ticker: string, apiKey: string, now: number): Promise<Bar[] | string> {
  // Descendente con límite: 2 500 barras cubren la sesión de hoy y la anterior entera, con pre y post-market.
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/` +
    `${isoDate(now - LOOKBACK_DAYS * 86_400_000)}/${isoDate(now)}` +
    `?adjusted=true&sort=desc&limit=2500&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const json: any = await response.json().catch(() => null);
    const bars = parseMinuteAggs(json);

    if (!bars) {
      const reason = response.status === 429 ? 'límite de Polygon' : json?.error || json?.message || `sin barras (HTTP ${response.status})`;
      return `${ticker}: ${reason}`;
    }

    cache.set(ticker, { bars, at: Date.now() });
    return bars;
  } catch (error: any) {
    return `${ticker}: ${error?.name === 'TimeoutError' ? 'sin respuesta' : error?.message || 'error'}`;
  }
}

/** Barras del ticker, o el motivo del fallo como texto. */
export function minuteBars(ticker: string, apiKey: string, now = Date.now()): Promise<Bar[] | string> {
  const hit = cache.get(ticker);
  if (hit && now - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.bars);

  let request = pending.get(ticker);
  if (!request) {
    request = download(ticker, apiKey, now).finally(() => pending.delete(ticker));
    pending.set(ticker, request);
  }
  return request;
}
