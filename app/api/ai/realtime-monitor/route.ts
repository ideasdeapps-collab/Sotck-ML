import { NextResponse } from 'next/server';
import { getCandles } from '@/lib/trading/marketData';
import { generateAISignal } from '@/lib/trading/aiSignalEngine';

export const dynamic = 'force-dynamic';

async function analyze(ticker: string, timeframe: string) {
  try {
    const market = await getCandles(ticker, timeframe);
    const signal = generateAISignal(market.candles);

    return NextResponse.json({
      ticker: market.ticker,
      timeframe: market.timeframe,
      source: market.source,
      candles: market.candles.length,
      ...signal,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'AI engine failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return analyze(body.ticker || 'NVDA', body.timeframe || '1m');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return analyze(searchParams.get('ticker') || 'NVDA', searchParams.get('timeframe') || '1m');
}
