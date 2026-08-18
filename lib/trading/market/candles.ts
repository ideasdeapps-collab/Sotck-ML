import { Candle } from '@/types/trading';

export async function getCandles(symbol: string): Promise<Candle[]> {
  // Polygon API integration will be connected here
  console.log(`Loading candles for ${symbol}`);

  return [];
}
