import { NextResponse } from 'next/server';
import { isValidTicker } from '@/lib/trading/liveQuote/sources';
import { getNewsReport } from '@/lib/trading/newsAgent/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Agente de noticias del Trading Lab; la red y la caché viven en `lib/trading/newsAgent/server.ts`. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = (params.get('ticker') || '').trim().toUpperCase();

  if (!isValidTicker(ticker)) {
    return NextResponse.json({ unavailable: true, reason: 'Ticker no válido' }, { status: 400 });
  }

  const { report, cache } = await getNewsReport(ticker, params.get('force') === '1');
  return NextResponse.json(report, { headers: { 'x-news-agent-cache': cache } });
}
