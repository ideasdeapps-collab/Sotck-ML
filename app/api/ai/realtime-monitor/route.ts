import { NextResponse } from 'next/server';
import { getCandles } from '@/lib/trading/marketData';
import { generateAISignal } from '@/lib/trading/aiSignalEngine';

export async function POST(request: Request) {
  const { ticker = 'NVDA', timeframe = '1m' } = await request.json();

  const market = await getCandles(ticker, timeframe);
  const candles = market.candles || market;
  const signal = generateAISignal(candles);

  return NextResponse.json({
    ticker,
    ...signal
  });
}
