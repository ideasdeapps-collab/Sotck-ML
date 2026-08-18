'use client';

import { useEffect, useState } from 'react';
import { Candle } from '@/types/trading';

export function useMarketData(symbol: string) {
  const [candles, setCandles] = useState<Candle[]>([]);

  useEffect(() => {
    // subscribe to market data stream
    setCandles([]);
  }, [symbol]);

  return { candles };
}
