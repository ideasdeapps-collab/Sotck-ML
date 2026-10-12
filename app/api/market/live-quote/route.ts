import { NextResponse } from 'next/server';
import {
  BROWSER_USER_AGENT,
  isValidTicker,
  nasdaqUrl,
  parseNasdaqQuote,
  parseYahooChart,
  yahooUrl,
  type LiveQuote,
} from '@/lib/trading/liveQuote/sources';

export const dynamic = 'force-dynamic';

/**
 * Precio en vivo leído de la web, sin IA y sin clave.
 *
 * Las velas de Polygon (plan Starter) llegan con ~15 min de retraso; esto da el
 * último precio real para dibujarlo por delante de ellas. Prueba Yahoo y, si
 * falla, Nasdaq (primero como acción, luego como ETF). Son endpoints no
 * oficiales: si todos fallan responde `{ unavailable, reason }`, la misma forma
 * que `/api/copilot`, y el overlay se apaga con el motivo sin tumbar el gráfico.
 */

const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 10_000;

/** Varias pestañas abiertas consultan el mismo ticker: una petición a la fuente cada 10 s basta. */
const cache = new Map<string, { quote: LiveQuote; expiresAt: number }>();

const HEADERS = { 'User-Agent': BROWSER_USER_AGENT, Accept: 'application/json' };

type Attempt = { name: string; url: string; parse: (json: unknown) => LiveQuote | null };

async function tryAttempt(attempt: Attempt): Promise<LiveQuote | string> {
  try {
    const response = await fetch(attempt.url, {
      headers: HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await response.json().catch(() => null);
    return attempt.parse(json) ?? `${attempt.name}: sin precio (HTTP ${response.status})`;
  } catch (error: any) {
    return `${attempt.name}: ${error?.name === 'TimeoutError' ? 'sin respuesta' : error?.message || 'error'}`;
  }
}

export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get('ticker') || '').trim().toUpperCase();

  if (!isValidTicker(ticker)) {
    return NextResponse.json({ unavailable: true, reason: 'Ticker no válido' }, { status: 400 });
  }

  const cached = cache.get(ticker);
  if (cached && cached.expiresAt > Date.now()) return NextResponse.json({ ticker, ...cached.quote });

  const attempts: Attempt[] = [
    { name: 'Yahoo', url: yahooUrl(ticker), parse: parseYahooChart },
    { name: 'Nasdaq', url: nasdaqUrl(ticker, 'stocks'), parse: parseNasdaqQuote },
    { name: 'Nasdaq ETF', url: nasdaqUrl(ticker, 'etf'), parse: parseNasdaqQuote },
  ];

  const failures: string[] = [];

  for (const attempt of attempts) {
    const result = await tryAttempt(attempt);

    if (typeof result !== 'string') {
      cache.set(ticker, { quote: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return NextResponse.json({ ticker, ...result });
    }

    failures.push(result);
  }

  return NextResponse.json({ unavailable: true, reason: `Sin precio web — ${failures.join(' · ')}` });
}
