import { NextResponse } from 'next/server';
import { isValidTicker } from '@/lib/trading/liveQuote/sources';
import { getLiveQuote } from '@/lib/trading/liveQuote/server';

export const dynamic = 'force-dynamic';

/** Precio en vivo leído de la web; las fuentes y la caché viven en `lib/trading/liveQuote/server.ts`. */
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get('ticker') || '').trim().toUpperCase();

  if (!isValidTicker(ticker)) {
    return NextResponse.json({ unavailable: true, reason: 'Ticker no válido' }, { status: 400 });
  }

  const result = await getLiveQuote(ticker);
  if (typeof result === 'string') return NextResponse.json({ unavailable: true, reason: result });
  return NextResponse.json({ ticker, ...result });
}
