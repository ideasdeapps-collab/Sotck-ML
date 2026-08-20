import { NextResponse } from 'next/server';
import { getCandles } from '@/lib/trading/marketData';

export async function POST(request: Request) {
  const { ticker, timeframe } = await request.json();
  return NextResponse.json(await getCandles(ticker, timeframe));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker') || 'NVDA';
  const timeframe = searchParams.get('timeframe') || '1m';
  return NextResponse.json(await getCandles(ticker, timeframe));
}
