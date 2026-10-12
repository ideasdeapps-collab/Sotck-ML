import { NextResponse } from 'next/server';
import { AI_TICKERS } from '@/lib/trading/aiEcosystem/chain';
import { parseMinuteAggs, summarizeBars, type TickerMove } from '@/lib/trading/aiEcosystem/moves';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Movimiento de cada ticker de la cadena de la IA, de barras de 1 min de Polygon.
 *
 * Una petición por ticker (≈40, en paralelo) con los últimos días en orden
 * descendente: 2 500 barras cubren la sesión de hoy y la anterior entera, con
 * pre y post-market. El plan Starter no limita el número de llamadas, pero sí
 * da los datos con ~15 min de retraso. Caché de 60 s compartida: el panel
 * refresca cada minuto y varias pestañas no multiplican las llamadas.
 */

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 8000;
const LOOKBACK_DAYS = 5;

type EcosystemResponse = {
  generatedAt: number;
  moves: Record<string, TickerMove | null>;
  failures: string[];
};

let cached: EcosystemResponse | null = null;
let pending: Promise<EcosystemResponse> | null = null;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function loadTicker(ticker: string, apiKey: string, now: number): Promise<TickerMove | string> {
  const url =
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/minute/` +
    `${isoDate(now - LOOKBACK_DAYS * 86_400_000)}/${isoDate(now)}` +
    `?adjusted=true&sort=desc&limit=2500&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const json = await response.json().catch(() => null);
    const bars = parseMinuteAggs(json);

    if (!bars) {
      const reason = response.status === 429 ? 'límite de Polygon' : json?.error || json?.message || `sin barras (HTTP ${response.status})`;
      return `${ticker}: ${reason}`;
    }

    return summarizeBars(bars) ?? `${ticker}: sin barras`;
  } catch (error: any) {
    return `${ticker}: ${error?.name === 'TimeoutError' ? 'sin respuesta' : error?.message || 'error'}`;
  }
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

export async function GET() {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ unavailable: true, reason: 'POLYGON_API_KEY no está configurada' });
  }

  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return NextResponse.json(cached, { headers: { 'x-ai-ecosystem-cache': 'hit' } });
  }

  if (!pending) {
    pending = build(apiKey).finally(() => {
      pending = null;
    });
  }

  cached = await pending;
  return NextResponse.json(cached, { headers: { 'x-ai-ecosystem-cache': 'miss' } });
}
