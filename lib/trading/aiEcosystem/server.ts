import { AI_TICKERS } from './chain';
import { summarizeBars, type TickerMove } from './moves';
import { minuteBars } from '../polygonMinutes';

/**
 * Movimiento de cada ticker de la cadena de la IA, de barras de 1 min de Polygon.
 *
 * Una petición por ticker (≈40, en paralelo) vía `lib/trading/polygonMinutes`,
 * que cachea las barras 60 s y las comparte con la carrera. El plan Starter no
 * limita el número de llamadas, pero sí da los datos con ~15 min de retraso.
 * Caché de 60 s del informe: el panel refresca cada minuto y varias pestañas no
 * multiplican las llamadas.
 */

const CACHE_TTL_MS = 60_000;

export type EcosystemResponse = {
  generatedAt: number;
  moves: Record<string, TickerMove | null>;
  failures: string[];
};

let cached: EcosystemResponse | null = null;
let pending: Promise<EcosystemResponse> | null = null;

async function loadTicker(ticker: string, apiKey: string, now: number): Promise<TickerMove | string> {
  const bars = await minuteBars(ticker, apiKey, now);
  if (typeof bars === 'string') return bars;
  return summarizeBars(bars) ?? `${ticker}: sin barras`;
}

async function build(apiKey: string): Promise<EcosystemResponse> {
  const now = Date.now();
  const results = await Promise.all(AI_TICKERS.map((ticker) => loadTicker(ticker, apiKey, now)));

  const moves: Record<string, TickerMove | null> = {};
  const failures: string[] = [];

  AI_TICKERS.forEach((ticker, i) => {
    const result = results[i];
    if (typeof result === 'string') {
      failures.push(result);
      // Un fallo puntual no borra el último dato bueno de ese ticker.
      moves[ticker] = cached?.moves[ticker] ?? null;
    } else {
      moves[ticker] = result;
    }
  });

  return { generatedAt: now, moves, failures };
}

/** Informe del ecosistema desde la caché de 60 s, o uno nuevo. */
export async function getEcosystem(apiKey: string): Promise<{ report: EcosystemResponse; cache: 'hit' | 'miss' }> {
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) return { report: cached, cache: 'hit' };

  if (!pending) {
    pending = build(apiKey).finally(() => {
      pending = null;
    });
  }

  cached = await pending;
  return { report: cached, cache: 'miss' };
}
