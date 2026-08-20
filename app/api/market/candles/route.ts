import { NextResponse } from 'next/server';
import { getCandles } from '@/lib/trading/marketData';

export const dynamic = 'force-dynamic';

async function respond(ticker: string, timeframe: string) {
  try {
    return NextResponse.json(await getCandles(ticker, timeframe));
  } catch (error: any) {
    return NextResponse.json(
      { ticker, timeframe, candles: [], source: 'demo', error: error?.message || 'Failed to load candles' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return respond(body.ticker || 'NVDA', body.timeframe || '1m');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return respond(searchParams.get('ticker') || 'NVDA', searchParams.get('timeframe') || '1m');
}
